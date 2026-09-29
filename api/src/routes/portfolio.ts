import { Router } from 'express';
import { z } from 'zod';
import { gambleDb } from '../db.js';
import { requirePermission } from '../middleware/session.js';

export const portfolioRouter = Router();

portfolioRouter.get('/portfolio', requirePermission('portfolio:manage'), async (req, res) => {
  const query = String(req.query.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const [rows] = query
    ? await gambleDb.execute(
      `SELECT USUARIO,CARTERA,SALDO,ESTADO,LOGIN,EMPRESA,FECHASYS,VERSION FROM CARTERA
       WHERE USUARIO LIKE ? OR EMPRESA LIKE ? ORDER BY FECHASYS DESC LIMIT ? OFFSET ?`,
      [`%${query}%`, `%${query}%`, limit, offset],
    )
    : await gambleDb.execute(
      `SELECT USUARIO,CARTERA,SALDO,ESTADO,LOGIN,EMPRESA,FECHASYS,VERSION FROM CARTERA
       WHERE FECHASYS >= CURDATE() ORDER BY FECHASYS DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
  return res.json({ rows, page, limit });
});

portfolioRouter.patch('/portfolio/:username', requirePermission('portfolio:manage'), async (req, res) => {
  const parsed = z.object({ active: z.enum(['S', 'N']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Estado invalido' });
  const [result] = await gambleDb.execute('UPDATE CARTERA SET ESTADO=? WHERE USUARIO=?', [parsed.data.active, req.params.username]);
  if ((result as { affectedRows: number }).affectedRows === 0) return res.status(404).json({ message: 'Usuario de cartera no encontrado' });
  return res.json({ message: 'Estado actualizado' });
});