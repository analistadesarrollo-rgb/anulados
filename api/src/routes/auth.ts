import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authDb } from '../db.js';
import { env } from '../env.js';
import { requireSession, revokeSession } from '../middleware/session.js';
import type { AppUserRow, AuthenticatedRequest } from '../types.js';

export const authRouter = Router();
const credentialsSchema = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) });

authRouter.post('/login', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Usuario y contrasena son obligatorios' });
  const [rows] = await authDb.execute(
    `SELECT u.id, u.username, u.display_name, u.password_hash, u.profile_id, u.active,
            p.name AS profile, p.permissions
     FROM app_users u JOIN app_profiles p ON p.id = u.profile_id
     WHERE u.username = ? LIMIT 1`,
    [parsed.data.username],
  );
  const user = (rows as Array<AppUserRow & { profile: string; permissions: string[] | string }>)[0];
  const permissions = user && (typeof user.permissions === 'string' ? JSON.parse(user.permissions) as string[] : user.permissions);
  const valid = user && user.active === 1 && permissions.length > 0 && await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!valid) return res.status(401).json({ message: 'Usuario o contrasena incorrectos o cuenta inactiva' });

  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await authDb.execute('INSERT INTO app_sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [sessionId, user.id, expiresAt]);
  const token = jwt.sign({ sub: String(user.id), jti: sessionId }, env.JWT_SECRET, { expiresIn: '30m' });
  res.cookie(env.JWT_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 60 * 1000,
    path: '/',
  });
  return res.json({ message: 'Sesion iniciada' });
});

authRouter.get('/session', requireSession, (req: AuthenticatedRequest, res) => res.json({ user: req.user }));

authRouter.post('/logout', async (req, res) => {
  await revokeSession(req.cookies?.[env.JWT_COOKIE_NAME]);
  res.clearCookie(env.JWT_COOKIE_NAME, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  return res.json({ message: 'Sesion cerrada' });
});

authRouter.post('/change-password', requireSession, async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }).safeParse(req.body);
  if (!parsed.success || !req.user) return res.status(400).json({ message: 'La nueva contrasena debe tener al menos 8 caracteres' });
  const [rows] = await authDb.execute('SELECT password_hash FROM app_users WHERE id = ? AND active = 1', [req.user.id]);
  const current = (rows as Array<{ password_hash: string }>)[0];
  if (!current || !await bcrypt.compare(parsed.data.currentPassword, current.password_hash)) {
    return res.status(400).json({ message: 'La contrasena actual no es correcta' });
  }
  const hash = await bcrypt.hash(parsed.data.newPassword, 12);
  await authDb.execute('UPDATE app_users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
  await authDb.execute('UPDATE app_sessions SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL', [req.user.id]);
  res.clearCookie(env.JWT_COOKIE_NAME, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  return res.json({ message: 'Contrasena actualizada' });
});