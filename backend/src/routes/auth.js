import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { config } from '../config.js';
import { sendPasswordResetEmail } from '../utils/email.js';

const router = Router();

/**
 * POST /api/v1/auth/login
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const rows = await query(
      'SELECT id, first_name, last_name, email, password_hash FROM usr WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    
    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user.id },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email
      }
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/auth/register
 */
router.post('/register', async (req, res, next) => {
  try {
    const { firstName, lastName, email, password } = req.body ?? {};
    
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 1) {
      return res.status(400).json({ error: 'Password must be at least 1 character long' });
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    await query(
      'INSERT INTO usr (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)',
      [firstName, lastName, email, passwordHash]
    );

    res.status(201).json({ message: 'User registered successfully' });
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }
    next(e);
  }
});

/**
 * GET /api/v1/auth/me
 */
router.get('/me', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const token = authHeader.slice(7);
    
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const userId = decoded.userId;

      const rows = await query(
        'SELECT id, first_name, last_name, email FROM usr WHERE id = ?',
        [userId]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      const user = rows[0];
      res.json({
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email
      });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/auth/reset-password
 * Password reset request - sends an email with a reset link
 */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const rows = await query('SELECT id, email FROM usr WHERE email = ?', [email]);
    
    if (rows.length === 0) {
      // For security reasons, always return success so an attacker cannot determine which emails exist
      return res.json({ message: 'If the email exists in the system, password reset instructions have been sent to it' });
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { userId: rows[0].id, type: 'reset', email: rows[0].email },
      config.jwtSecret,
      { expiresIn: '1h' }
    );

    // Send email
    const emailSent = await sendPasswordResetEmail(rows[0].email, resetToken);
    
    if (!emailSent) {
      console.error(`Failed to send reset email to ${rows[0].email}`);
      // Even if the email failed to send, return success for security
      // In production you can log to DB or a monitoring system
    }
    
    res.json({ message: 'If the email exists in the system, password reset instructions have been sent to it' });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/auth/reset-password/confirm
 * Confirm new password with reset token
 */
router.post('/reset-password/confirm', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body ?? {};
    
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 1) {
      return res.status(400).json({ error: 'Password must be at least 1 character long' });
    }

    // Verify and decode token
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwtSecret);
      
      if (decoded.type !== 'reset') {
        return res.status(400).json({ error: 'Invalid token type' });
      }
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(400).json({ error: 'Token has expired. Please request a new password reset.' });
      }
      return res.status(400).json({ error: 'Invalid token' });
    }

    // Find user
    const rows = await query('SELECT id, email FROM usr WHERE id = ?', [decoded.userId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Additional check - email in token must match email in DB
    if (decoded.email !== rows[0].email) {
      return res.status(400).json({ error: 'Token does not match user' });
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await query(
      'UPDATE usr SET password_hash = ? WHERE id = ?',
      [passwordHash, decoded.userId]
    );

    console.log(`Password successfully changed for user: ${rows[0].email}`);

    res.json({ message: 'Password has been successfully changed. You can now log in with your new password.' });
  } catch (e) {
    next(e);
  }
});

export default router;