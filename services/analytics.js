const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const authenticateToken = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const getDateRange = (period) => {
  const now = new Date();
  let startDate, endDate;

  switch (period) {
    case 'week':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      break;
    case 'month':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case 'year':
      startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    default:
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  };
};

// Summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const { startDate, endDate } = getDateRange(period);

    const { data: expenses, error } = await supabase
      .from('expenses')
      .select('amount, category')
      .eq('user_id', req.user.userId)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) throw error;

    const totalSpent = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
    const categoryTotals = {};
    
    expenses.forEach(exp => {
      categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + parseFloat(exp.amount);
    });

    const topCategories = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalSpent > 0 ? (amount / totalSpent) * 100 : 0
      }));

    res.json({
      success: true,
      summary: {
        period,
        totalSpent,
        expenseCount: expenses.length,
        averageExpense: expenses.length > 0 ? totalSpent / expenses.length : 0,
        topCategories
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary', message: error.message });
  }
});

// By category
router.get('/by-category', authenticateToken, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const { startDate, endDate } = getDateRange(period);

    const { data: expenses, error } = await supabase
      .from('expenses')
      .select('amount, category')
      .eq('user_id', req.user.userId)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) throw error;

    const categoryData = {};
    let totalSpent = 0;

    expenses.forEach(exp => {
      const amount = parseFloat(exp.amount);
      categoryData[exp.category] = (categoryData[exp.category] || 0) + amount;
      totalSpent += amount;
    });

    const categories = Object.entries(categoryData)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalSpent > 0 ? (amount / totalSpent) * 100 : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    res.json({ success: true, categories, totalSpent });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories', message: error.message });
  }
});

// Trends
router.get('/trends', authenticateToken, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const { startDate, endDate } = getDateRange(period);

    const { data: expenses, error } = await supabase
      .from('expenses')
      .select('amount, date')
      .eq('user_id', req.user.userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (error) throw error;

    const trendData = {};
    expenses.forEach(exp => {
      if (!trendData[exp.date]) {
        trendData[exp.date] = { date: exp.date, total: 0, count: 0 };
      }
      trendData[exp.date].total += parseFloat(exp.amount);
      trendData[exp.date].count += 1;
    });

    res.json({ success: true, trends: Object.values(trendData) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch trends', message: error.message });
  }
});

// Monthly comparison
router.get('/monthly-comparison', authenticateToken, async (req, res) => {
  try {
    const { months = 6 } = req.query;
    const monthlyData = [];
    const now = new Date();

    for (let i = 0; i < months; i++) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

      const { data: expenses } = await supabase
        .from('expenses')
        .select('amount')
        .eq('user_id', req.user.userId)
        .gte('date', monthStart.toISOString().split('T')[0])
        .lte('date', monthEnd.toISOString().split('T')[0]);

      monthlyData.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        total: expenses?.reduce((sum, exp) => sum + parseFloat(exp.amount), 0) || 0,
        count: expenses?.length || 0
      });
    }

    res.json({ success: true, monthlyData: monthlyData.reverse() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch comparison', message: error.message });
  }
});

// Insights
router.get('/insights', authenticateToken, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: expenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('user_id', req.user.userId)
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0]);

    const insights = [];
    const total = expenses?.reduce((sum, exp) => sum + parseFloat(exp.amount), 0) || 0;

    insights.push({
      type: 'daily_average',
      title: 'Daily Average',
      value: total / 30,
      message: `You spend an average of $${(total / 30).toFixed(2)} per day`
    });

    res.json({ success: true, insights });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate insights', message: error.message });
  }
});

module.exports = router;