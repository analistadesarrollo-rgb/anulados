import { Router } from 'express';
import { gambleDb } from '../db.js';
import { requirePermission } from '../middleware/session.js';

export const catalogRouter = Router();

catalogRouter.get('/causals', requirePermission('forms:register'), async (_req, res) => {
  const [rows] = await gambleDb.execute('SELECT DESCRIPCION FROM CAUSALES_ANULACION WHERE ACTIVO=1 ORDER BY DESCRIPCION');
  return res.json((rows as Array<{ DESCRIPCION: string }>).map((row) => row.DESCRIPCION));
});