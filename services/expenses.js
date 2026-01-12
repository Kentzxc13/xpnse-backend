const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const authenticateToken = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// HELPER: Get or create category_id
// ============================================
async function getOrCreateCategoryId(categoryName) {
  try {
    if (!categoryName) return null;

    // Check if exists
    const { data: existing } = await supabase
      .from('dim_category')
      .select('category_id')
      .eq('category_name', categoryName)
      .single();

    if (existing) return existing.category_id;

    // Create if doesn't exist
    const { data: newCategory, error } = await supabase
      .from('dim_category')
      .insert([{ category_name: categoryName }])
      .select('category_id')
      .single();

    if (error) throw error;
    return newCategory.category_id;
  } catch (error) {
    console.error('Category error:', error);
    return null;
  }
}

// ============================================
// HELPER: Get or create date_id
// ============================================
async function getOrCreateDateId(dateString) {
  try {
    const date = new Date(dateString);
    
    // Check if exists
    const { data: existing } = await supabase
      .from('dim_date')
      .select('date_id')
      .eq('date_id', dateString)
      .single();

    if (existing) return dateString;

    // Create if doesn't exist
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
    console.error('Date error:', error);
    return null;
  }
}

// ============================================
// 🔥 FIXED: Get all expenses (ONLY from fact_expenses)
// ============================================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { category, startDate, endDate, limit = 100 } = req.query;

    console.log('📊 Fetching expenses for user:', userId);

    // 🔥 FIX: Query ONLY fact_expenses (receipts are linked via receipt_id)
    let query = supabase
      .from('fact_expenses')
      .select(`
        expense_id,
        user_id,
        amount,
        description,
        payment_method,
        tags,
        receipt_id,
        store_id,
        created_at,
        updated_at,
        dim_category!fact_expenses_category_id_fkey(category_name),
        dim_date!fact_expenses_date_id_fkey(date_id)
      `)
      .eq('user_id', userId)
      .order('date_id', { ascending: false })
      .limit(parseInt(limit));

    if (category) {
      // Find category_id first
      const categoryId = await getOrCreateCategoryId(category);
      if (categoryId) {
        query = query.eq('category_id', categoryId);
      }
    }
    
    if (startDate) query = query.gte('date_id', startDate);
    if (endDate) query = query.lte('date_id', endDate);

    const { data: expenses, error } = await query;

    if (error) {
      console.error('❌ Query error:', error);
      throw error;
    }

    console.log(`✅ Fetched ${expenses.length} expenses from fact_expenses only`);

    // 🔥 Map to consistent format with proper field names
    const mappedExpenses = expenses.map(exp => ({
      id: exp.expense_id,
      expense_id: exp.expense_id,
      user_id: exp.user_id,
      amount: exp.amount,
      category: exp.dim_category?.category_name || 'Other',
      dim_category: exp.dim_category,
      description: exp.description,
      date: exp.dim_date?.date_id,
      date_id: exp.dim_date?.date_id,
      dim_date: exp.dim_date,
      payment_method: exp.payment_method,
      tags: exp.tags,
      receipt_id: exp.receipt_id,
      store_id: exp.store_id,
      created_at: exp.created_at,
      updated_at: exp.updated_at
    }));

    res.json({ 
      success: true, 
      expenses: mappedExpenses, 
      count: mappedExpenses.length 
    });
  } catch (error) {
    console.error('❌ Get expenses error:', error);
    res.status(500).json({ error: 'Failed to fetch expenses', message: error.message });
  }
});

// ============================================
// Get single expense (with dimension joins)
// ============================================
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { data: expense, error } = await supabase
      .from('fact_expenses')
      .select(`
        *,
        dim_category!fact_expenses_category_id_fkey(category_name),
        dim_date!fact_expenses_date_id_fkey(date_id)
      `)
      .eq('expense_id', req.params.id)
      .eq('user_id', req.user.userId)
      .single();

    if (error || !expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ success: true, expense });
  } catch (error) {
    console.error('Get expense error:', error);
    res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

// ============================================
// 🔥 FIXED: Create expense (check for duplicate receipt_id)
// ============================================
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { amount, category, description, date, payment_method, tags, receiptImage, receipt_id } = req.body;

    if (!amount || !category || !date) {
      return res.status(400).json({ error: 'Amount, category, and date are required' });
    }

    console.log('📝 Creating expense:', { amount, category, date, receipt_id });

    // 🔥 CHECK: If receipt_id provided, check if expense already exists for this receipt
    if (receipt_id) {
      const { data: existingExpense } = await supabase
        .from('fact_expenses')
        .select('expense_id')
        .eq('receipt_id', receipt_id)
        .eq('user_id', req.user.userId)
        .single();

      if (existingExpense) {
        console.log('⚠️ Expense already exists for this receipt:', existingExpense.expense_id);
        return res.status(409).json({ 
          error: 'Expense already exists for this receipt',
          expense_id: existingExpense.expense_id
        });
      }
    }

    // Get/create dimension IDs
    const categoryId = await getOrCreateCategoryId(category);
    const dateId = await getOrCreateDateId(date);

    if (!categoryId || !dateId) {
      return res.status(500).json({ error: 'Failed to create dimension references' });
    }

    console.log('✅ Dimension IDs:', { categoryId, dateId });

    // Insert into fact_expenses
    const { data: expense, error } = await supabase
      .from('fact_expenses')
      .insert([{
        user_id: req.user.userId,
        amount: parseFloat(amount),
        category_id: categoryId,
        date_id: dateId,
        description: description || null,
        payment_method: payment_method || null,
        tags: tags || null,
        receipt_id: receipt_id || null  // 🔥 Link to receipt if provided
      }])
      .select(`
        *,
        dim_category!fact_expenses_category_id_fkey(category_name),
        dim_date!fact_expenses_date_id_fkey(date_id)
      `)
      .single();

    if (error) {
      console.error('❌ Insert error:', error);
      throw error;
    }

    console.log('✅ Expense created:', expense.expense_id);

    res.status(201).json({ success: true, expense });
  } catch (error) {
    console.error('❌ Create expense error:', error);
    res.status(500).json({ error: 'Failed to create expense', message: error.message });
  }
});

// ============================================
// Update expense
// ============================================
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { amount, category, description, date, payment_method, tags } = req.body;

    const updateData = {};
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (description !== undefined) updateData.description = description;
    if (payment_method !== undefined) updateData.payment_method = payment_method;
    if (tags !== undefined) updateData.tags = tags;
    
    // Handle category update
    if (category !== undefined) {
      const categoryId = await getOrCreateCategoryId(category);
      if (categoryId) updateData.category_id = categoryId;
    }
    
    // Handle date update
    if (date !== undefined) {
      const dateId = await getOrCreateDateId(date);
      if (dateId) updateData.date_id = dateId;
    }

    const { data: expense, error } = await supabase
      .from('fact_expenses')
      .update(updateData)
      .eq('expense_id', req.params.id)
      .eq('user_id', req.user.userId)
      .select(`
        *,
        dim_category!fact_expenses_category_id_fkey(category_name),
        dim_date!fact_expenses_date_id_fkey(date_id)
      `)
      .single();

    if (error || !expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ success: true, expense });
  } catch (error) {
    console.error('Update expense error:', error);
    res.status(500).json({ error: 'Failed to update expense', message: error.message });
  }
});

// ============================================
// Delete expense
// ============================================
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('fact_expenses')
      .delete()
      .eq('expense_id', req.params.id)
      .eq('user_id', req.user.userId);

    if (error) throw error;

    res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    res.status(500).json({ error: 'Failed to delete expense', message: error.message });
  }
});

// ============================================
// 🔥 NEW: Get expenses with receipts
// ============================================
router.get('/with-receipts', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    // Get expenses that have receipts
    const { data: expenses, error } = await supabase
      .from('fact_expenses')
      .select(`
        *,
        dim_category!fact_expenses_category_id_fkey(category_name),
        dim_date!fact_expenses_date_id_fkey(date_id),
        fact_receipts!fact_expenses_receipt_id_fkey(receipt_id, image_url)
      `)
      .eq('user_id', req.user.userId)
      .not('receipt_id', 'is', null)
      .order('date_id', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    res.json({ success: true, expenses, count: expenses.length });
  } catch (error) {
    console.error('Get expenses with receipts error:', error);
    res.status(500).json({ error: 'Failed to fetch expenses with receipts' });
  }
});

module.exports = router;