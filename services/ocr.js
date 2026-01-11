const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const authenticateToken = require('../middleware/auth');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Scan receipt
router.post('/scan', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'OCR service not configured' });
    }

    const base64Image = req.file.buffer.toString('base64');
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract receipt data as JSON: {"merchant":"","date":"YYYY-MM-DD","total":0,"items":[{"name":"","price":0}],"category":""}`
            },
            {
              type: 'image_url',
              image_url: { url: `data:${req.file.mimetype};base64,${base64Image}` }
            }
          ]
        }],
        max_tokens: 1000
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsedData = JSON.parse(jsonMatch ? jsonMatch[0] : content);

    res.json({ success: true, data: parsedData });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process receipt', message: error.message });
  }
});

// Test endpoint
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'OCR service is running',
    openai_configured: !!process.env.OPENAI_API_KEY
  });
});

module.exports = router;