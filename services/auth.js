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

    // ⭐ FIX: Check dim_user first
    const { data: existingDimUser } = await supabase
      .from('dim_user')
      .select('user_id')
      .eq('email', email)
      .single();

    if (existingDimUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Check if user exists in Auth
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

    // ⭐ FIX: Check dim_user first to get correct user_id
    const { data: dimUserData, error: dimUserError } = await supabase
      .from('dim_user')
      .select('user_id, email, full_name, auth_provider')
      .eq('email', email)
      .single();

    if (dimUserData) {
      console.log('✅ User found in dim_user:', dimUserData.user_id);
      
      // If user was created via Google, they can't login with password
      if (dimUserData.auth_provider === 'GOOGLE') {
        return res.status(400).json({ 
          error: 'Please sign in with Google',
          message: 'This account was created with Google Sign-In. Please use Google to login.'
        });
      }
      
      // Try to sign in with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        console.error('❌ Login error:', authError);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      console.log('✅ Login successful:', dimUserData.user_id);

      // ⭐ FIX: Use the user_id from dim_user, not from auth
      const token = jwt.sign(
        { userId: dimUserData.user_id, email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.json({
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: dimUserData.user_id,
          email: dimUserData.email,
          name: dimUserData.full_name
        }
      });
    } else {
      // User doesn't exist in dim_user
      console.log('❌ User not found in dim_user');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

// ⭐ FIXED: Google Sign-In - Check dim_user first!
router.post('/google', async (req, res) => {
  try {
    const { email, name, googleId, photoUrl } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name are required' });
    }

    console.log('🔐 Google Sign-In attempt:', { email, name, googleId });

    // ⭐ FIX: Check dim_user FIRST, not Supabase Auth!
    const { data: dimUserData, error: dimUserError } = await supabase
      .from('dim_user')
      .select('user_id, email, full_name, google_id')
      .eq('email', email)
      .single();

    let userId;
    let userName;

    if (dimUserData) {
      // ✅ User exists in dim_user - use that ID!
      console.log('✅ Existing user found in dim_user:', dimUserData.user_id);
      userId = dimUserData.user_id;
      userName = dimUserData.full_name;
      
      // Update google_id if it's missing
      if (!dimUserData.google_id && googleId) {
        await supabase
          .from('dim_user')
          .update({ google_id: googleId })
          .eq('user_id', userId);
        console.log('✅ Updated google_id for existing user');
      }
    } else {
      // User doesn't exist - create new one
      console.log('🆕 Creating new user...');
      
      // Create new user in Supabase Auth
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
      userName = name;
      console.log('✅ New user created in Auth:', userId);

      // ✅ INSERT INTO DIM_USER
      const { error: insertError } = await supabase
        .from('dim_user')
        .insert({
          user_id: userId,
          email: email,
          full_name: name,
          auth_provider: 'GOOGLE',
          google_id: googleId,
          is_active: true
        });

      if (insertError) {
        console.error('⚠️ dim_user insert error:', insertError);
      } else {
        console.log('✅ User added to dim_user');
      }
    }

    // Generate JWT token with the correct userId
    const token = jwt.sign(
      { userId, email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    console.log('✅ JWT token generated for user:', userId);

    res.json({
      success: true,
      token,
      user: {
        id: userId,
        email,
        name: userName
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
    
    // ⭐ FIX: Get user from dim_user instead of auth
    const { data: dimUser, error: dimError } = await supabase
      .from('dim_user')
      .select('user_id, email, full_name')
      .eq('user_id', verified.userId)
      .single();

    if (dimError || !dimUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: dimUser.user_id,
        email: dimUser.email,
        name: dimUser.full_name
      }
    });
  } catch (error) {
    console.error('❌ Get user error:', error);
    res.status(403).json({ error: 'Invalid token' });
  }
});

module.exports = router;