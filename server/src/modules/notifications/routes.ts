import { Router } from 'express';
import { one, query } from '../../db/pool.js';
import { requireAuth } from '../../lib/auth.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth());

notificationsRouter.get('/', async (req, res) => {
  const items = await query(
    'SELECT id, kind, title, body, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.user!.id],
  );
  const unread = await one<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user!.id]);
  res.json({ items, unread: unread?.n ?? 0 });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user!.id]);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
  res.json({ ok: true });
});
