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
    const { startDate, endDate } = req.query;

    // ✅ FIXED: Use fact_expenses with dimension joins
    const { data: expenses, error } = await supabase
      .from('fact_expenses')
      .select(`
        amount,
        dim_category!fact_expenses_category_id_fkey(category_name)
      `)
      .eq('user_id', req.user.userId)
      .gte('date_id', startDate || getDateRange('month').startDate)
      .lte('date_id', endDate || getDateRange('month').endDate);

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    const totalAmount = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
    const expenseCount = expenses.length;
    const averageAmount = expenseCount > 0 ? totalAmount / expenseCount : 0;

    res.json({
      success: true,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      averageAmount: parseFloat(averageAmount.toFixed(2)),
      expenseCount,
      total_expenses: expenseCount,
      period: {
        startDate: startDate || getDateRange('month').startDate,
        endDate: endDate || getDateRange('month').endDate
      }
    });
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ error: 'Failed to fetch summary', message: error.message });
  }
});

// By category
router.get('/by-category', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // ✅ FIXED: Use fact_expenses with dimension joins
    const { data: expenses, error } = await supabase
      .from('fact_expenses')
      .select(`
        amount,
        dim_category!fact_expenses_category_id_fkey(category_name)
      `)
      .eq('user_id', req.user.userId)
      .gte('date_id', startDate || getDateRange('month').startDate)
      .lte('date_id', endDate || getDateRange('month').endDate);

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    const categoryData = {};
    let totalSpent = 0;

    expenses.forEach(exp => {
      const amount = parseFloat(exp.amount);
      const categoryName = exp.dim_category?.category_name || 'Other';
      categoryData[categoryName] = (categoryData[categoryName] || 0) + amount;
      totalSpent += amount;
    });

    const categories = Object.entries(categoryData)
      .map(([category, total_amount]) => ({
        category,
        totalAmount: parseFloat(total_amount.toFixed(2)),
        total_amount: parseFloat(total_amount.toFixed(2)),
        count: expenses.filter(e => (e.dim_category?.category_name || 'Other') === category).length,
        percentage: totalSpent > 0 ? parseFloat(((total_amount / totalSpent) * 100).toFixed(2)) : 0
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    res.json({ 
      success: true, 
      categories, 
      totalAmount: parseFloat(totalSpent.toFixed(2)),
      totalSpent: parseFloat(totalSpent.toFixed(2))
    });
  } catch (error) {
    console.error('Category error:', error);
    res.status(500).json({ error: 'Failed to fetch categories', message: error.message });
  }
});

// Trends
router.get('/trends', authenticateToken, async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const { startDate, endDate } = getDateRange(period);

    const { data: expenses, error } = await supabase
      .from('fact_expenses')
      .select('amount, date_id')
      .eq('user_id', req.user.userId)
      .gte('date_id', startDate)
      .lte('date_id', endDate)
      .order('date_id', { ascending: true });

    if (error) throw error;

    const trendData = {};
    expenses.forEach(exp => {
      if (!trendData[exp.date_id]) {
        trendData[exp.date_id] = { date: exp.date_id, total: 0, count: 0 };
      }
      trendData[exp.date_id].total += parseFloat(exp.amount);
      trendData[exp.date_id].count += 1;
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
        .from('fact_expenses')
        .select('amount')
        .eq('user_id', req.user.userId)
        .gte('date_id', monthStart.toISOString().split('T')[0])
        .lte('date_id', monthEnd.toISOString().split('T')[0]);

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
      .from('fact_expenses')
      .select('*')
      .eq('user_id', req.user.userId)
      .gte('date_id', thirtyDaysAgo.toISOString().split('T')[0]);

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