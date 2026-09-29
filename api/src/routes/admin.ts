import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authDb } from '../db.js';
import { requirePermission } from '../middleware/session.js';
import type { AuthenticatedRequest, ProfileRow } from '../types.js';

export const adminRouter = Router();
const manageUsers = requirePermission('users:manage');
const manageProfiles = requirePermission('profiles:manage');
const userSchema = z.object({
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(160),
  password: z.string().min(8).max(200).optional(),
  profileId: z.number().int().positive(),
  active: z.boolean().default(true),
});
const protectedPermissions = new Set(['users:manage', 'profiles:manage']);

async function audit(actor: number, action: string, entity: string, id: string, details: object = {}) {
  await authDb.execute(
    'INSERT INTO app_audit_log (actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [actor, action, entity, id, JSON.stringify(details)],
  );
}

adminRouter.get('/users', manageUsers, async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  const active = req.query.active === undefined ? null : Number(req.query.active === 'true' || req.query.active === '1');
  const terms: unknown[] = [];
  let where = '1 = 1';
  if (query) {
    where += ' AND (u.username LIKE ? OR u.display_name LIKE ? OR p.name LIKE ?)';
    terms.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (active !== null) {
    where += ' AND u.active = ?';
    terms.push(active);
  }
  const [rows] = await authDb.execute(
        `SELECT u.id, u.username, u.display_name AS displayName, u.profile_id AS profileId,
          u.active, u.legacy_id AS legacyId, u.legacy_login AS legacyLogin, p.name AS profile
     FROM app_users u JOIN app_profiles p ON p.id = u.profile_id
     WHERE ${where} ORDER BY u.display_name LIMIT 500`,
    terms,
  );
  return res.json(rows);
});

adminRouter.post('/users', manageUsers, async (req: AuthenticatedRequest, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.password) return res.status(400).json({ message: 'Completa usuario, nombre, perfil y contrasena de al menos 8 caracteres' });
  const [profileRows] = await authDb.execute('SELECT id FROM app_profiles WHERE id = ?', [parsed.data.profileId]);
  if ((profileRows as unknown[]).length === 0) return res.status(400).json({ message: 'El perfil seleccionado no existe' });
  const hash = await bcrypt.hash(parsed.data.password, 12);
  try {
    const [result] = await authDb.execute(
      'INSERT INTO app_users (username, display_name, password_hash, profile_id, active) VALUES (?, ?, ?, ?, ?)',
      [parsed.data.username, parsed.data.displayName, hash, parsed.data.profileId, parsed.data.active ? 1 : 0],
    );
    const id = (result as { insertId: number }).insertId;
    await audit(req.user!.id, 'user.create', 'user', String(id), { username: parsed.data.username, profileId: parsed.data.profileId });
    return res.status(201).json({ id, message: 'Usuario creado' });
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Ese usuario ya existe' });
    throw error;
  }
});

adminRouter.patch('/users/:id', manageUsers, async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: 'Usuario invalido' });
  const parsed = z.object({
    username: z.string().trim().min(1).max(80).optional(),
    displayName: z.string().trim().min(1).max(160).optional(),
    profileId: z.number().int().positive().optional(),
    active: z.boolean().optional(),
    password: z.string().min(8).max(200).optional(),
  }).safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return res.status(400).json({ message: 'No hay cambios validos' });
  if (req.user!.id === id && (parsed.data.active === false || parsed.data.profileId !== undefined)) {
    return res.status(400).json({ message: 'No puedes desactivar ni cambiar tu propio perfil' });
  }
  if (parsed.data.active === false || parsed.data.profileId !== undefined) {
    const [currentRows] = await authDb.execute(
      `SELECT u.active, p.name AS profile FROM app_users u JOIN app_profiles p ON p.id=u.profile_id WHERE u.id=?`,
      [id],
    );
    const current = (currentRows as Array<{ active: number; profile: string }>)[0];
    if (current?.active === 1 && current.profile === 'APLICACIONES' && (parsed.data.active === false || parsed.data.profileId !== undefined)) {
      const [adminRows] = await authDb.execute(
        `SELECT COUNT(*) AS total FROM app_users u JOIN app_profiles p ON p.id=u.profile_id WHERE p.name='APLICACIONES' AND u.active=1`,
      );
      if (Number((adminRows as Array<{ total: number }>)[0]?.total ?? 0) <= 1) return res.status(409).json({ message: 'No puedes retirar el ultimo usuario activo de APLICACIONES' });
    }
  }
  if (parsed.data.profileId) {
    const [profiles] = await authDb.execute('SELECT id FROM app_profiles WHERE id = ?', [parsed.data.profileId]);
    if ((profiles as unknown[]).length === 0) return res.status(400).json({ message: 'El perfil seleccionado no existe' });
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (parsed.data.username !== undefined) { fields.push('username = ?'); values.push(parsed.data.username); }
  if (parsed.data.displayName !== undefined) { fields.push('display_name = ?'); values.push(parsed.data.displayName); }
  if (parsed.data.profileId !== undefined) { fields.push('profile_id = ?'); values.push(parsed.data.profileId); }
  if (parsed.data.active !== undefined) { fields.push('active = ?'); values.push(parsed.data.active ? 1 : 0); }
  if (parsed.data.password) { fields.push('password_hash = ?'); values.push(await bcrypt.hash(parsed.data.password, 12)); }
  values.push(id);
  let result;
  try {
    [result] = await authDb.execute(`UPDATE app_users SET ${fields.join(', ')} WHERE id = ?`, values);
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Ese usuario ya existe; desactiva primero la cuenta duplicada' });
    throw error;
  }
  if ((result as { affectedRows: number }).affectedRows === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
  await audit(req.user!.id, 'user.update', 'user', String(id), Object.keys(parsed.data));
  return res.json({ message: 'Usuario actualizado' });
});

adminRouter.get('/profiles', requirePermission('profiles:manage'), async (_req, res) => {
  const [rows] = await authDb.execute('SELECT id, name, permissions, is_system AS isSystem FROM app_profiles ORDER BY name');
  return res.json((rows as Array<ProfileRow & { isSystem: number }>).map((profile) => ({
    ...profile,
    permissions: typeof profile.permissions === 'string' ? JSON.parse(profile.permissions) : profile.permissions,
    isSystem: Boolean(profile.isSystem),
  })));
});

adminRouter.post('/profiles', requirePermission('profiles:manage'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(100), permissions: z.array(z.string().min(1).max(100)).max(50) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Nombre o permisos invalidos' });
  if (parsed.data.name === 'APLICACIONES') return res.status(400).json({ message: 'El perfil APLICACIONES ya esta reservado' });
  if (parsed.data.permissions.some((permission) => protectedPermissions.has(permission))) return res.status(400).json({ message: 'Los permisos de administracion son exclusivos del perfil APLICACIONES' });
  try {
    const [result] = await authDb.execute('INSERT INTO app_profiles (name, permissions) VALUES (?, ?)', [parsed.data.name, JSON.stringify(parsed.data.permissions)]);
    const id = (result as { insertId: number }).insertId;
    await audit(req.user!.id, 'profile.create', 'profile', String(id), { name: parsed.data.name });
    return res.status(201).json({ id, message: 'Perfil creado' });
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'El perfil ya existe' });
    throw error;
  }
});

adminRouter.patch('/profiles/:id', requirePermission('profiles:manage'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ name: z.string().trim().min(2).max(100).optional(), permissions: z.array(z.string().min(1).max(100)).max(50).optional() }).safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success || Object.keys(parsed.data).length === 0) return res.status(400).json({ message: 'Cambios de perfil invalidos' });
  const [currentRows] = await authDb.execute('SELECT name, is_system FROM app_profiles WHERE id = ?', [id]);
  const current = (currentRows as Array<{ name: string; is_system: number }>)[0];
  if (!current) return res.status(404).json({ message: 'Perfil no encontrado' });
  if (current.is_system && parsed.data.name !== undefined) return res.status(400).json({ message: 'Los perfiles de sistema no se pueden renombrar' });
  if (current.name === 'APLICACIONES' && parsed.data.permissions && ![...protectedPermissions].every((permission) => parsed.data.permissions!.includes(permission))) {
    return res.status(400).json({ message: 'APLICACIONES debe conservar sus permisos administrativos' });
  }
  if (current.name !== 'APLICACIONES' && parsed.data.permissions?.some((permission) => protectedPermissions.has(permission))) {
    return res.status(400).json({ message: 'Los permisos de administracion son exclusivos del perfil APLICACIONES' });
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (parsed.data.name !== undefined) { fields.push('name = ?'); values.push(parsed.data.name); }
  if (parsed.data.permissions !== undefined) { fields.push('permissions = ?'); values.push(JSON.stringify(parsed.data.permissions)); }
  values.push(id);
  await authDb.execute(`UPDATE app_profiles SET ${fields.join(', ')} WHERE id = ?`, values);
  await audit(req.user!.id, 'profile.update', 'profile', String(id), Object.keys(parsed.data));
  return res.json({ message: 'Perfil actualizado' });
});

adminRouter.delete('/profiles/:id', requirePermission('profiles:manage'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: 'Perfil invalido' });
  const [rows] = await authDb.execute('SELECT name, is_system FROM app_profiles WHERE id = ?', [id]);
  const profile = (rows as Array<{ name: string; is_system: number }>)[0];
  if (!profile) return res.status(404).json({ message: 'Perfil no encontrado' });
  if (profile.is_system) return res.status(400).json({ message: 'Los perfiles de sistema no se pueden eliminar' });
  const [users] = await authDb.execute('SELECT COUNT(*) AS total FROM app_users WHERE profile_id = ?', [id]);
  if (Number((users as Array<{ total: number }>)[0]?.total ?? 0) > 0) return res.status(409).json({ message: 'Asigna otro perfil a sus usuarios antes de eliminarlo' });
  await authDb.execute('DELETE FROM app_profiles WHERE id = ?', [id]);
  await audit(req.user!.id, 'profile.delete', 'profile', String(id), { name: profile.name });
  return res.json({ message: 'Perfil eliminado' });
});