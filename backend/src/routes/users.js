import { Router } from 'express';
import { getUserStore } from '../users/index.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const userStore = getUserStore();
    const rows = await userStore.list();
    const items = rows.map(r => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
    }));
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

export default router;
