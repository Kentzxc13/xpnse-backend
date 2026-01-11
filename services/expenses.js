const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const authenticateToken = require('../middleware/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Get all expenses
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { category, startDate, endDate, limit = 100 } = req.query;

    let query = supabase
      .from('expenses')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(parseInt(limit));

    if (category) query = query.eq('category', category);
    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);

    const { data: expenses, error } = await query;

    if (error) throw error;

    res.json({ success: true, expenses, count: expenses.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch expenses', message: error.message });
  }
});

// Get single expense
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { data: expense, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.userId)
      .single();

    if (error || !expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch expense' });
  }
});

// Create expense
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { amount, category, description, date, payment_method, tags } = req.body;

    if (!amount || !category || !date) {
      return res.status(400).json({ error: 'Amount, category, and date are required' });
    }

    const { data: expense, error } = await supabase
      .from('expenses')
      .insert([{
        user_id: req.user.userId,
        amount: parseFloat(amount),
        category,
        description: description || null,
        date,
        payment_method: payment_method || null,
        tags: tags || null
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create expense', message: error.message });
  }
});

// Update expense
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { amount, category, description, date, payment_method, tags } = req.body;

    const updateData = {};
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (date !== undefined) updateData.date = date;
    if (payment_method !== undefined) updateData.payment_method = payment_method;
    if (tags !== undefined) updateData.tags = tags;

    const { data: expense, error } = await supabase
      .from('expenses')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('user_id', req.user.userId)
      .select()
      .single();

    if (error || !expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update expense', message: error.message });
  }
});

// Delete expense
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.userId);

    if (error) throw error;

    res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete expense', message: error.message });
  }
});

module.exports = router;