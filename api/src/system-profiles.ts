import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authDb } from './db.js';

type Policy = Record<string, string[]>;

function candidatePaths() {
  return [
    resolve(dirname(fileURLToPath(import.meta.url)), '../access-policy.json'),
    resolve(process.cwd(), 'access-policy.json'),
    resolve(process.cwd(), 'api/access-policy.json'),
  ];
}

async function readPolicy(): Promise<Policy | null> {
  for (const path of candidatePaths()) {
    try {
      const policy = JSON.parse(await readFile(path, 'utf8')) as Policy;
      if (policy && typeof policy === 'object' && Object.keys(policy).length > 0) return policy;
    } catch {
      continue;
    }
  }
  return null;
}

/* Los perfiles de access-policy.json son los unicos que el sistema legado
   autorizaba. Se insertan sin sobrescribir los permisos ya ajustados en la
   interfaz, para que APLICACIONES siempre pueda asignar cualquier perfil del
   sistema al crear o reasignar usuarios, aunque el dump importado no lo traiga. */
export async function ensureSystemProfiles() {
  const policy = await readPolicy();
  if (!policy) return 0;
  let created = 0;
  for (const [name, permissions] of Object.entries(policy)) {
    const [result] = await authDb.execute(
      'INSERT IGNORE INTO app_profiles (name, permissions, is_system) VALUES (?, ?, 1)',
      [name, JSON.stringify(permissions)],
    );
    created += (result as { affectedRows: number }).affectedRows;
  }
  return created;
}