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
      return res.status(400).json({ error: 'Email a heslo jsou povinné' });
    }

    // Najdeme uživatele podle emailu
    const rows = await query(
      'SELECT id, first_name, last_name, email, password_hash FROM usr WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
    }

    const user = rows[0];
    
    // Ověříme heslo
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Neplatné přihlašovací údaje' });
    }

    // Vytvoříme JWT token
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
      return res.status(400).json({ error: 'Všechna pole jsou povinná' });
    }

    if (password.length < 1) {
      return res.status(400).json({ error: 'Heslo musí mít alespoň 1 znak' });
    }

    // Zahashujeme heslo
    const passwordHash = await bcrypt.hash(password, 12);

    // Vytvoříme uživatele
    await query(
      'INSERT INTO usr (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)',
      [firstName, lastName, email, passwordHash]
    );

    res.status(201).json({ message: 'Uživatel byl úspěšně zaregistrován' });
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Uživatel s tímto e-mailem již existuje' });
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
      return res.status(401).json({ error: 'Chybí autorizační token' });
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
        return res.status(401).json({ error: 'Neplatný token' });
      }

      const user = rows[0];
      res.json({
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email
      });
    } catch {
      return res.status(401).json({ error: 'Neplatný nebo vypršelý token' });
    }
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/auth/reset-password
 * Žádost o reset hesla - odešle e-mail s reset linkem
 */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    
    if (!email) {
      return res.status(400).json({ error: 'Email je povinný' });
    }

    const rows = await query('SELECT id, email FROM usr WHERE email = ?', [email]);
    
    if (rows.length === 0) {
      // Z bezpečnostních důvodů vždy vrátíme success, aby útočník nemohl zjistit, které emaily existují
      return res.json({ message: 'Pokud e-mail existuje v systému, byly na něj odeslány pokyny pro obnovení hesla' });
    }

    // Vygenerujeme reset token
    const resetToken = jwt.sign(
      { userId: rows[0].id, type: 'reset', email: rows[0].email },
      config.jwtSecret,
      { expiresIn: '1h' }
    );

    // Odešleme e-mail
    const emailSent = await sendPasswordResetEmail(rows[0].email, resetToken);
    
    if (!emailSent) {
      console.error(`Nepodařilo se odeslat reset e-mail na ${rows[0].email}`);
      // I když se email nepodařilo odeslat, vrátíme success pro bezpečnost
      // V produkci můžete logovat do DB nebo monitoring systému
    }
    
    res.json({ message: 'Pokud e-mail existuje v systému, byly na něj odeslány pokyny pro obnovení hesla' });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/auth/reset-password/confirm
 * Potvrzení nového hesla s reset tokenem
 */
router.post('/reset-password/confirm', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body ?? {};
    
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token a nové heslo jsou povinné' });
    }

    if (newPassword.length < 1) {
      return res.status(400).json({ error: 'Heslo musí mít alespoň 1 znak' });
    }

    // Ověříme a dekódujeme token
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwtSecret);
      
      if (decoded.type !== 'reset') {
        return res.status(400).json({ error: 'Neplatný typ tokenu' });
      }
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(400).json({ error: 'Platnost tokenu vypršela. Požádejte o nový reset hesla.' });
      }
      return res.status(400).json({ error: 'Neplatný token' });
    }

    // Najdeme uživatele
    const rows = await query('SELECT id, email FROM usr WHERE id = ?', [decoded.userId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Uživatel nenalezen' });
    }

    // Dodatečná kontrola - email v tokenu musí odpovídat emailu v DB
    if (decoded.email !== rows[0].email) {
      return res.status(400).json({ error: 'Token neodpovídá uživateli' });
    }

    // Zahashujeme nové heslo
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Aktualizujeme heslo
    await query(
      'UPDATE usr SET password_hash = ? WHERE id = ?',
      [passwordHash, decoded.userId]
    );

    console.log(`Heslo bylo úspěšně změněno pro uživatele: ${rows[0].email}`);

    res.json({ message: 'Heslo bylo úspěšně změněno. Nyní se můžete přihlásit s novým heslem.' });
  } catch (e) {
    next(e);
  }
});

export default router;