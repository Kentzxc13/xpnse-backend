const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { createClient } = require('@supabase/supabase-js');
const authenticateToken = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ============================================
// HELPER: Get or create dimension IDs
// ============================================

async function getOrCreateCategoryId(categoryName) {
  try {
    if (!categoryName) return null;

    const { data: existing } = await supabase
      .from('dim_category')
      .select('category_id')
      .eq('category_name', categoryName)
      .single();

    if (existing) return existing.category_id;

    const { data: newCategory, error } = await supabase
      .from('dim_category')
      .insert([{ category_name: categoryName }])
      .select('category_id')
      .single();

    if (error) throw error;
    return newCategory.category_id;
  } catch (error) {
    console.error('Error with category dimension:', error);
    return null;
  }
}

async function getOrCreateDateId(dateString) {
  try {
    const date = new Date(dateString);
    
    const { data: existing } = await supabase
      .from('dim_date')
      .select('date_id')
      .eq('date_id', dateString)
      .single();

    if (existing) return dateString;

    const { error } = await supabase
      .from('dim_date')
      .insert([{
        date_id: dateString,
        day_of_month: date.getDate(),
        month: date.getMonth() + 1,
        year: date.getFullYear(),
        day_of_week: date.getDay() + 1,
        day_name: date.toLocaleDateString('en-US', { weekday: 'long' }),
        month_name: date.toLocaleDateString('en-US', { month: 'long' }),
        quarter: Math.floor(date.getMonth() / 3) + 1,
        week: Math.ceil(date.getDate() / 7),
        is_weekend: date.getDay() === 0 || date.getDay() === 6,
        is_holiday: false
      }]);

    if (error) throw error;
    return dateString;
  } catch (error) {
    console.error('Error with date dimension:', error);
    return null;
  }
}

async function getOrCreateStoreId(storeName) {
  if (!storeName) return null;
  
  try {
    const { data: existing } = await supabase
      .from('dim_store')
      .select('store_id')
      .eq('store_name', storeName)
      .single();

    if (existing) return existing.store_id;

    const { data: newStore, error } = await supabase
      .from('dim_store')
      .insert([{ store_name: storeName }])
      .select('store_id')
      .single();

    if (error) throw error;
    return newStore.store_id;
  } catch (error) {
    console.error('Error with store dimension:', error);
    return null;
  }
}

// ============================================
// HELPER: Parse receipt text
// ============================================
function parseReceiptText(text) {
  const lines = text.split('\n').filter(line => line.trim());
  
  // Extract merchant (first few meaningful lines)
  let merchant = 'Unknown Merchant';
  const potentialMerchantLines = [];
  
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();
    // Skip lines that are just numbers, dates, or very short
    if (line.length > 3 && !/^\d+$/.test(line) && !/^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(line)) {
      potentialMerchantLines.push(line);
      if (potentialMerchantLines.length >= 2) break;
    }
  }
  
  if (potentialMerchantLines.length > 0) {
    merchant = potentialMerchantLines.join(' ').substring(0, 100);
  }
  
  // Extract date (common formats)
  let date = new Date().toISOString().split('T')[0];
  const datePatterns = [
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/,
    /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/,
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i,
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/i,
    /(\d{2}[-\/]\d{2}[-\/]\d{2})/
  ];
  
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        let dateStr = match[0];
        if (/^\d{2}[-\/]\d{2}[-\/]\d{2}$/.test(dateStr)) {
          const parts = dateStr.split(/[-\/]/);
          const year = parseInt(parts[2]);
          const fullYear = year < 50 ? 2000 + year : 1900 + year;
          dateStr = `${parts[0]}-${parts[1]}-${fullYear}`;
        }
        
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > 2000 && parsedDate.getFullYear() <= new Date().getFullYear()) {
          date = parsedDate.toISOString().split('T')[0];
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  // Extract total
  let total = 0;
  const totalPatterns = [
    /(?:TOTAL|AMOUNT DUE|GRAND TOTAL|BALANCE|NET AMOUNT)[:\s]*(?:PHP|₱|\$|Rs\.?|PHP\s|₱\s|\$\s)?\s*([\d,]+\.?\d*)/i,
    /(?:AMOUNT|PAYMENT)[:\s]*(?:PHP|₱|\$|Rs\.?|PHP\s|₱\s|\$\s)?\s*([\d,]+\.?\d*)/i
  ];
  
  for (const pattern of totalPatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount > 0 && amount < 1000000) {
        total = amount;
        break;
      }
    }
  }
  
  // Fallback: find largest number in last 10 lines
  if (total === 0) {
    const lastLines = lines.slice(-10).join('\n');
    const allNumbers = lastLines.match(/(?:PHP|₱|\$|Rs\.?)?\s*([\d,]+\.\d{2})/g);
    if (allNumbers && allNumbers.length > 0) {
      const amounts = allNumbers
        .map(n => parseFloat(n.replace(/[^\d.]/g, '')))
        .filter(n => n > 0 && n < 1000000);
      if (amounts.length > 0) {
        total = Math.max(...amounts);
      }
    }
  }
  
  // Extract items
  const items = [];
  const itemPattern = /^(.+?)\s+(?:PHP|₱|\$|Rs\.?)?\s*([\d,]+\.\d{2})$/;
  
  for (const line of lines) {
    const match = line.match(itemPattern);
    if (match) {
      const name = match[1].trim();
      const price = parseFloat(match[2].replace(/,/g, ''));
      
      if (!/(TOTAL|AMOUNT|SUBTOTAL|TAX|BALANCE|CHANGE|DISCOUNT)/i.test(name) && 
          price > 0 && price < total * 0.9) {
        items.push({ name, price });
      }
    }
  }
  
  // Categorize
  let category = 'Uncategorized';
  const categoryKeywords = {
    'Food & Dining': ['restaurant', 'cafe', 'coffee', 'food', 'pizza', 'burger', 'diner', 'kitchen', 'grill', 'bistro', 'mcdonald', 'jollibee', 'kfc'],
    'Groceries': ['grocery', 'supermarket', 'market', 'store', 'mart', 'sari', 'puregold', 'sm', 'savemore'],
    'Utilities': ['electric', 'water', 'internet', 'telco', 'utility', 'meralco', 'pldt', 'globe', 'smart', 'converge'],
    'Transportation': ['gas', 'fuel', 'taxi', 'transport', 'parking', 'grab', 'angkas', 'shell', 'petron', 'caltex'],
    'Shopping': ['mall', 'shop', 'retail', 'boutique', 'department', 'robinson', 'ayala', 'lazada', 'shopee'],
    'Healthcare': ['pharmacy', 'hospital', 'clinic', 'medical', 'drug', 'mercury', 'watsons', 'south star']
  };
  
  const merchantLower = merchant.toLowerCase();
  const textLower = text.toLowerCase();
  
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => merchantLower.includes(keyword) || textLower.includes(keyword))) {
      category = cat;
      break;
    }
  }
  
  return {
    merchant,
    date,
    total,
    items,
    category,
    rawText: text
  };
}

// ============================================
// SCAN RECEIPT - API Ninjas OCR
// ============================================
router.post('/scan', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    if (!process.env.API_NINJAS_KEY) {
      return res.status(503).json({ 
        error: 'OCR service not configured',
        message: 'Please set API_NINJAS_KEY in .env file. Get free key at https://api-ninjas.com'
      });
    }

    console.log('📸 Processing receipt with API Ninjas OCR...');

    // Step 1: Prepare form data for API Ninjas
    const formData = new FormData();
    formData.append('image', req.file.buffer, {
      filename: 'receipt.jpg',
      contentType: req.file.mimetype
    });

    // Step 2: Call API Ninjas OCR
    const ocrResponse = await axios.post(
      'https://api.api-ninjas.com/v1/imagetotext',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'X-Api-Key': process.env.API_NINJAS_KEY
        },
        timeout: 30000 // 30 second timeout
      }
    );

    console.log('📄 API Ninjas response:', JSON.stringify(ocrResponse.data, null, 2));

    // Check if OCR was successful
    if (!ocrResponse.data || ocrResponse.data.length === 0) {
      return res.status(400).json({ 
        error: 'No text detected in image',
        message: 'Please ensure the receipt is clear and well-lit'
      });
    }

    // Extract text from OCR result (API Ninjas returns array of text blocks)
    const extractedText = ocrResponse.data
      .map(item => item.text)
      .join('\n');

    console.log('📄 Raw OCR text:\n', extractedText);

    if (!extractedText.trim()) {
      return res.status(400).json({ 
        error: 'No text detected in image',
        message: 'Please ensure the receipt is clear and well-lit'
      });
    }

    // Step 3: Parse the extracted text
    const parsedData = parseReceiptText(extractedText);
    console.log('✅ Parsed data:', parsedData);

    // Step 4: Upload image to Supabase Storage
    const fileName = `receipts/${req.user.userId}/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('receipts')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      console.error('❌ Upload failed:', uploadError);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('receipts')
      .getPublicUrl(fileName);

    console.log('✅ Image uploaded:', publicUrl);

    // Step 5: Get dimension IDs
    const categoryId = await getOrCreateCategoryId(parsedData.category || 'Uncategorized');
    const dateId = await getOrCreateDateId(parsedData.date || new Date().toISOString().split('T')[0]);
    const storeId = parsedData.merchant ? await getOrCreateStoreId(parsedData.merchant) : null;

    if (!categoryId || !dateId) {
      return res.status(500).json({ error: 'Failed to create dimension references' });
    }

    // Step 6: Insert into fact_receipts
    const { data: receipt, error: insertError } = await supabase
      .from('fact_receipts')
      .insert([{
        user_id: req.user.userId,
        date_id: dateId,
        category_id: categoryId,
        store_id: storeId,
        amount: parseFloat(parsedData.total || 0),
        image_url: publicUrl
      }])
      .select(`
        *,
        dim_category!fk_category(category_name, category_type, icon_name, color_code),
        dim_date!fk_date(date_id, year, month, day_of_month),
        dim_store!fk_store(store_name, store_type, location)
      `)
      .single();

    if (insertError) {
      console.error('❌ Failed to store receipt:', insertError);
      throw insertError;
    }

    console.log('✅ Receipt stored in fact_receipts');

    res.json({ 
      success: true, 
      data: parsedData,
      receipt: receipt,
      message: 'Receipt processed and stored successfully'
    });
  } catch (error) {
    console.error('❌ OCR error:', error);
    
    // Better error messages
    let errorMessage = error.message;
    if (error.response?.status === 400) {
      errorMessage = 'Invalid image format. Please upload a clear photo of your receipt.';
    } else if (error.response?.status === 401 || error.response?.status === 403) {
      errorMessage = 'Invalid API Ninjas key. Please check your API_NINJAS_KEY in .env file.';
    } else if (error.response?.status === 429) {
      errorMessage = 'Rate limit exceeded. You have used all 100,000 free monthly requests.';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Request timeout. Please try again with a smaller image.';
    } else if (error.response?.data) {
      errorMessage = error.response.data.error || error.response.data.message || errorMessage;
    }
    
    res.status(500).json({ 
      error: 'Failed to process receipt', 
      message: errorMessage 
    });
  }
});

// ============================================
// GET ALL RECEIPTS
// ============================================
router.get('/receipts', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, startDate, endDate } = req.query;

    let query = supabase
      .from('fact_receipts')
      .select(`
        *,
        dim_category!fk_category(category_name, category_type, icon_name, color_code),
        dim_date!fk_date(date_id, year, month, day_of_month),
        dim_store!fk_store(store_name, store_type, location)
      `)
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (startDate) query = query.gte('date_id', startDate);
    if (endDate) query = query.lte('date_id', endDate);

    const { data: receipts, error } = await query;

    if (error) throw error;

    res.json({ success: true, receipts, count: receipts.length });
  } catch (error) {
    console.error('Get receipts error:', error);
    res.status(500).json({ error: 'Failed to fetch receipts', message: error.message });
  }
});

// ============================================
// GET SINGLE RECEIPT
// ============================================
router.get('/receipts/:id', authenticateToken, async (req, res) => {
  try {
    const { data: receipt, error } = await supabase
      .from('fact_receipts')
      .select(`
        *,
        dim_category!fk_category(category_name, category_type, icon_name, color_code),
        dim_date!fk_date(date_id, year, month, day_of_month),
        dim_store!fk_store(store_name, store_type, location)
      `)
      .eq('receipt_id', req.params.id)
      .eq('user_id', req.user.userId)
      .single();

    if (error || !receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    res.json({ success: true, receipt });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch receipt' });
  }
});

// ============================================
// DELETE RECEIPT
// ============================================
router.delete('/receipts/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('fact_receipts')
      .delete()
      .eq('receipt_id', req.params.id)
      .eq('user_id', req.user.userId);

    if (error) throw error;

    res.json({ success: true, message: 'Receipt deleted successfully' });
  } catch (error) {
    console.error('Delete receipt error:', error);
    res.status(500).json({ error: 'Failed to delete receipt', message: error.message });
  }
});

// ============================================
// TEST ENDPOINT
// ============================================
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'OCR service is running with API Ninjas',
    api_ninjas_configured: !!process.env.API_NINJAS_KEY,
    rate_limit: '100,000 requests/month free',
    signup_url: 'https://api-ninjas.com/register'
  });
});

module.exports = router;