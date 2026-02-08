import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, first_name, last_name, email FROM usr ORDER BY id'
    );
    const items = rows.map(r => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email
    }));
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

export default router;
