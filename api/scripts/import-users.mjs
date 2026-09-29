import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import policy from '../access-policy.json' with { type: 'json' };

function splitTuples(input) {
  const tuples = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let start = -1;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === "'") {
        if (input[index + 1] === "'") index += 1;
        else quoted = false;
      }
      continue;
    }
    if (char === "'") quoted = true;
    else if (char === '(') {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) tuples.push(input.slice(start, index));
    }
  }
  return tuples;
}

function parseTuple(tuple) {
  const fields = [];
  let value = '';
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < tuple.length; index += 1) {
    const char = tuple[index];
    if (quoted) {
      if (escaped) {
        const escapes = { n: '\n', r: '\r', t: '\t', '0': '\0', b: '\b', Z: '\u001a' };
        value += escapes[char] ?? char;
        escaped = false;
      } else if (char === '\\') escaped = true;
      else if (char === "'") {
        if (tuple[index + 1] === "'") {
          value += "'";
          index += 1;
        } else quoted = false;
      } else value += char;
    } else if (char === "'") quoted = true;
    else if (char === ',') {
      fields.push(value.trim());
      value = '';
    } else value += char;
  }
  fields.push(value.trim());
  return fields;
}

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Uso: npm run import-users -- <ruta-a-tbusuario.sql> [--dry-run]');
  process.exit(2);
}

const dump = await readFile(resolve(sourcePath), 'utf8');
const inserts = [...dump.matchAll(/INSERT\s+INTO\s+`?tbusuario`?\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*?);/gi)];
if (inserts.length === 0) throw new Error('No se encontro INSERT para tbusuario en el SQL.');

const columns = inserts.flatMap((match) => match[1].split(',').map((column) => column.replaceAll('`', '').trim()));
const tuples = inserts.flatMap((match) => splitTuples(match[2]).map(parseTuple));
const columnIndex = Object.fromEntries([...new Set(columns)].map((column) => [column.toLowerCase(), columns.indexOf(column)]));
for (const required of ['login', 'pass', 'nombre', 'perfil', 'activo']) {
  if (columnIndex[required] === undefined) throw new Error(`Falta la columna requerida: ${required}`);
}

const rows = tuples.map((values) => Object.fromEntries(Object.entries(columnIndex).map(([key, index]) => [key, values[index]])));
const profileNames = [...new Set(rows.map((row) => row.perfil))];
const normalizeLogin = (login) => String(login ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es');
const orderedRows = [...rows].sort((left, right) => Number(left.id ?? 0) - Number(right.id ?? 0));
const loginGroups = new Map();
for (const row of orderedRows) {
  const key = normalizeLogin(row.login);
  if (!key) throw new Error('El SQL contiene un login vacio.');
  loginGroups.set(key, [...(loginGroups.get(key) ?? []), row]);
}

const collisionGroups = [...loginGroups.values()].filter((group) => group.length > 1);
const suppressedActive = collisionGroups.reduce((total, group) => total + Math.max(0, group.filter((row) => row.activo !== '0').length - 1), 0);
const occupied = new Set();
const importedRows = [];
for (const group of loginGroups.values()) {
  const primary = group.find((row) => row.activo !== '0') ?? group[0];
  for (const row of group) {
    const isPrimary = row === primary;
    let username = String(row.login).trim();
    if (!isPrimary) {
      username = `${username}~legacy-${row.id ?? importedRows.length + 1}`;
      let suffix = 1;
      while (occupied.has(normalizeLogin(username))) username = `${row.login}~legacy-${row.id ?? importedRows.length + 1}-${suffix++}`;
    }
    occupied.add(normalizeLogin(username));
    importedRows.push({ ...row, importUsername: username, importActive: isPrimary && row.activo !== '0' ? 1 : 0 });
  }
}

const activeUsers = importedRows.filter((row) => row.importActive === 1).length;
console.log(`SQL validado: ${rows.length} cuentas (${activeUsers} activas en V2), ${profileNames.length} perfiles, ${collisionGroups.length} logins ambiguos; ${suppressedActive} duplicados activos quedan inactivos.`);
for (const name of profileNames.sort((left, right) => left.localeCompare(right))) {
  const users = importedRows.filter((row) => row.perfil === name);
  const active = users.filter((row) => row.importActive === 1).length;
  console.log(`  ${name}: ${users.length} cuentas, ${active} activas`);
}
if (process.argv.includes('--dry-run')) process.exit(0);

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
  const [existingUsers] = await db.execute('SELECT COUNT(*) AS total FROM app_users');
  const existingCount = Number(existingUsers[0]?.total ?? 0);
  if (existingCount > 0 && !process.argv.includes('--replace')) {
    throw new Error('La base V2 ya tiene usuarios. La importacion se cancelo para conservar cambios; usa --replace solo para restablecerlos deliberadamente.');
  }

  await db.beginTransaction();
  for (const name of profileNames) {
    const permissions = policy[name] ?? [];
    await db.execute(
      `INSERT INTO app_profiles (name, permissions, is_system)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE permissions = VALUES(permissions)`,
      [name, JSON.stringify(permissions), Object.hasOwn(policy, name) ? 1 : 0],
    );
  }

  const [profiles] = await db.query('SELECT id, name FROM app_profiles');
  const profileIds = new Map(profiles.map((profile) => [profile.name, profile.id]));
  for (const row of importedRows) {
    const passwordHash = await bcrypt.hash(row.pass, 12);
    await db.execute(
      `INSERT INTO app_users (username, display_name, password_hash, profile_id, active, legacy_id, legacy_login, legacy_imei)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), password_hash = VALUES(password_hash),
         profile_id = VALUES(profile_id), active = VALUES(active), legacy_id = VALUES(legacy_id),
         legacy_login = VALUES(legacy_login), legacy_imei = VALUES(legacy_imei)`,
      [row.importUsername, row.nombre, passwordHash, profileIds.get(row.perfil), row.importActive, row.id || null, String(row.login).trim(), row.imei || null],
    );
  }
  await db.commit();
  console.log('Importacion completada. Los hashes reemplazan las contrasenas heredadas en la base V2.');
} catch (error) {
  await db.rollback();
  throw error;
} finally {
  await db.end();
}