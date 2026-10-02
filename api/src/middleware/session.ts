import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authDb } from '../db.js';
import { env, sessionTtlMinutes, sessionTtlMs, sessionTtlSeconds } from '../env.js';
import type { AppUserRow, AuthenticatedRequest, ProfileRow } from '../types.js';

interface SessionToken { sub: string; jti: string }

export async function requireSession(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.user) return next();
  const token = req.cookies?.[env.JWT_COOKIE_NAME] as string | undefined;
  if (!token) return res.status(401).json({ message: 'Sesion no iniciada' });

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as SessionToken;
    const [rows] = await authDb.execute(
      `SELECT u.id, u.username, u.display_name, u.profile_id, u.active, p.name AS profile, p.permissions
       FROM app_users u JOIN app_profiles p ON p.id = u.profile_id
       JOIN app_sessions s ON s.user_id=u.id
       WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL AND s.expires_at > NOW()
         AND s.last_activity >= DATE_SUB(NOW(), INTERVAL ? MINUTE) AND u.active = 1 LIMIT 1`,
      [decoded.sub, decoded.jti, sessionTtlMinutes],
    );
    const user = (rows as Array<AppUserRow & { profile: string; permissions: string[] | string }>)[0];
    if (!user) return res.status(401).json({ message: 'Cuenta inactiva o inexistente' });
    const permissions = typeof user.permissions === 'string' ? JSON.parse(user.permissions) as string[] : user.permissions;
    req.user = { id: user.id, login: user.username, displayName: user.display_name, profile: user.profile, permissions };
    await authDb.execute('UPDATE app_sessions SET last_activity=NOW(), expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id=?', [sessionTtlMinutes, decoded.jti]);
    const refreshedToken = jwt.sign({ sub: decoded.sub, jti: decoded.jti }, env.JWT_SECRET, { expiresIn: sessionTtlSeconds });
    res.cookie(env.JWT_COOKIE_NAME, refreshedToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: sessionTtlMs,
      path: '/',
    });
    return next();
  } catch {
    return res.status(401).json({ message: 'Sesion invalida o vencida' });
  }
}

export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user?.permissions.includes(permission)) return res.status(403).json({ message: 'No tienes permiso para esta operacion' });
    next();
  };
}

export function asProfile(row: ProfileRow) {
  return { id: row.id, name: row.name, permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions, isSystem: Boolean(row.is_system) };
}

export async function revokeSession(token: string | undefined) {
  if (!token) return;
  const decoded = jwt.decode(token) as SessionToken | null;
  if (decoded?.jti) await authDb.execute('UPDATE app_sessions SET revoked_at=NOW() WHERE id=? AND revoked_at IS NULL', [decoded.jti]);
}