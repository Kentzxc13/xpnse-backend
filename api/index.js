require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Xpnse Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me'
      },
      expenses: {
        list: 'GET /api/expenses',
        create: 'POST /api/expenses',
        get: 'GET /api/expenses/:id',
        update: 'PUT /api/expenses/:id',
        delete: 'DELETE /api/expenses/:id'
      },
      analytics: {
        summary: 'GET /api/analytics/summary',
        byCategory: 'GET /api/analytics/by-category',
        trends: 'GET /api/analytics/trends',
        monthlyComparison: 'GET /api/analytics/monthly-comparison',
        insights: 'GET /api/analytics/insights'
      },
      ocr: {
        scan: 'POST /api/ocr/scan',
        test: 'GET /api/ocr/test'
      }
    }
  });
});

// Import routes
const authRoutes = require('../services/auth');
const expenseRoutes = require('../services/expenses');
const analyticsRoutes = require('../services/analytics');
const ocrRoutes = require('../services/ocr');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ocr', ocrRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found', 
    path: req.path
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Export for Vercel
module.exports = app;

// Local development
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}