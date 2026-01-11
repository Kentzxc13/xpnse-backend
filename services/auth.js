const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['email', 'password', 'name']
      });
    }

    console.log('📝 Registration attempt:', { email, name });

    // Check if user exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const userExists = existingUsers?.users?.find(u => u.email === email);

    if (userExists) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    });

    if (authError) {
      console.error('❌ Auth creation error:', authError);
      throw authError;
    }

    console.log('✅ User created in Supabase Auth:', authData.user.id);

    // ✅ INSERT INTO DIM_USER
    const { error: dimUserError } = await supabase
      .from('dim_user')
      .insert({
        user_id: authData.user.id,
        email: email,
        full_name: name,
        auth_provider: 'EMAIL',
        is_active: true
      });

    if (dimUserError) {
      console.error('⚠️ dim_user insert error:', dimUserError);
      // Continue anyway - auth user is created
    } else {
      console.log('✅ User added to dim_user');
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: authData.user.id, email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: authData.user.id,
        email,
        name
      }
    });
  } catch (error) {
    console.error('❌ Register error:', error);
    res.status(500).json({ error: 'Registration failed', message: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['email', 'password']
      });
    }

    console.log('🔐 Login attempt:', { email });

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      console.error('❌ Login error:', authError);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('✅ Login successful:', authData.user.id);

    const token = jwt.sign(
      { userId: authData.user.id, email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        name: authData.user.user_metadata?.name
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

// Google Sign-In
router.post('/google', async (req, res) => {
  try {
    const { email, name, googleId, photoUrl } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name are required' });
    }

    console.log('🔐 Google Sign-In attempt:', { email, name });

    // Check if user exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const user = existingUsers?.users?.find(u => u.email === email);

    let userId;

    if (user) {
      console.log('✅ User exists:', user.id);
      userId = user.id;
    } else {
      console.log('🆕 Creating new user...');
      
      // Create new user
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          name: name,
          google_id: googleId,
          photo_url: photoUrl
        }
      });

      if (createError) {
        console.error('❌ Failed to create user:', createError);
        throw createError;
      }

      userId = newUser.user.id;
      console.log('✅ New user created:', userId);

      // ✅ INSERT INTO DIM_USER
      const { error: dimUserError } = await supabase
        .from('dim_user')
        .insert({
          user_id: userId,
          email: email,
          full_name: name,
          auth_provider: 'GOOGLE',
          google_id: googleId,
          is_active: true
        });

      if (dimUserError) {
        console.error('⚠️ dim_user insert error:', dimUserError);
        // Continue anyway - auth user is created
      } else {
        console.log('✅ User added to dim_user');
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId, email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      token,
      user: {
        id: userId,
        email,
        name
      }
    });
  } catch (error) {
    console.error('❌ Google auth error:', error);
    res.status(500).json({ error: 'Google authentication failed', message: error.message });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const verified = jwt.verify(token, JWT_SECRET);
    
    const { data: { user }, error } = await supabase.auth.admin.getUserById(verified.userId);

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name
      }
    });
  } catch (error) {
    console.error('❌ Get user error:', error);
    res.status(403).json({ error: 'Invalid token' });
  }
});

module.exports = router;