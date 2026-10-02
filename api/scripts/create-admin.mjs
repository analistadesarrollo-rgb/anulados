import { resolve } from 'node:path';
import policy from '../access-policy.json' with { type: 'json' };

const options = new Map();
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  if (!match) continue;
  options.set(match[1], match[2] ?? 'true');
}

const username = (options.get('username') ?? process.env.BOOTSTRAP_USERNAME ?? '').trim();
const password = options.get('password') ?? process.env.BOOTSTRAP_PASSWORD;
const displayName = (options.get('name') ?? process.env.BOOTSTRAP_DISPLAY_NAME ?? 'Administrador V2').trim();
const profileName = (options.get('profile') ?? 'APLICACIONES').trim();

if (!username || !password) {
  console.error('Uso: npm run create-admin -- --username <usuario> --password <contrasena> [--name "Nombre"] [--profile APLICACIONES]');
  console.error('Tambien acepta BOOTSTRAP_USERNAME y BOOTSTRAP_PASSWORD para no exponer la contrasena en la linea de comandos.');
  process.exit(2);
}
if (password.length < 8) {
  console.error('La contrasena debe tener al menos 8 caracteres.');
  process.exit(2);
}
if (!Object.hasOwn(policy, profileName)) {
  console.error(`El perfil ${profileName} no existe en access-policy.json. Perfiles disponibles: ${Object.keys(policy).join(', ')}`);
  process.exit(2);
}

const { config } = await import('dotenv');
config({ path: resolve(process.cwd(), '../.env') });
config();
const [{ default: mysql }, { default: bcrypt }] = await Promise.all([
  import('mysql2/promise'),
  import('bcryptjs'),
]);

const db = await mysql.createConnection({
  host: process.env.AUTH_DB_HOST,
  port: Number(process.env.AUTH_DB_PORT || 3306),
  database: process.env.AUTH_DB_DATABASE,
  user: process.env.AUTH_DB_USER,
  password: process.env.AUTH_DB_PASSWORD,
});

try {
  const [profiles] = await db.execute('SELECT id, permissions FROM app_profiles WHERE name = ? LIMIT 1', [profileName]);
  let profileId = profiles[0]?.id;
  if (!profileId) {
    await db.execute(
      'INSERT INTO app_profiles (name, permissions, is_system) VALUES (?, ?, 1)',
      [profileName, JSON.stringify(policy[profileName])],
    );
    console.log(`Perfil ${profileName} creado con permisos: ${policy[profileName].join(', ')}`);
  } else if (JSON.parse(profiles[0].permissions ?? '[]').length === 0) {
    /* Un perfil importado sin permisos deja la cuenta inutilizable porque el
       login exige al menos uno, asi que el bootstrap lo deja operativo. */
    await db.execute('UPDATE app_profiles SET permissions = ? WHERE id = ?', [JSON.stringify(policy[profileName]), profileId]);
    console.log(`Perfil ${profileName} estaba vacio: se le asignaron los permisos de access-policy.json.`);
  }
  const [resolved] = await db.execute('SELECT id FROM app_profiles WHERE name = ? LIMIT 1', [profileName]);
  profileId = resolved[0].id;

  const passwordHash = await bcrypt.hash(password, 12);
  const [existing] = await db.execute('SELECT id, active FROM app_users WHERE username = ? LIMIT 1', [username]);
  await db.execute(
    `INSERT INTO app_users (username, display_name, password_hash, profile_id, active)
     VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), password_hash = VALUES(password_hash),
       profile_id = VALUES(profile_id), active = 1`,
    [username, displayName, passwordHash, profileId],
  );

  const [rows] = await db.execute('SELECT id, username, display_name, active FROM app_users WHERE username = ? LIMIT 1', [username]);
  await db.execute('UPDATE app_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [rows[0].id]);
  const action = existing.length ? 'actualizado' : 'creado';
  console.log(`Usuario ${action}: ${rows[0].username} (${rows[0].display_name}) perfil ${profileName}, activo=${rows[0].active}.`);
  console.log('Las sesiones abiertas de esa cuenta quedaron revocadas; la contrasena se cambia tambien desde la interfaz.');
} finally {
  await db.end();
}