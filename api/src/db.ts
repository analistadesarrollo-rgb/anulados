import mysql from 'mysql2/promise';
import oracledb from 'oracledb';
import { env } from './env.js';

const mysqlPool = (database: string, host: string, port: number, user: string, password: string) => mysql.createPool({
  host,
  port,
  database,
  user,
  password,
  waitForConnections: true,
  connectionLimit: 12,
  charset: 'utf8mb4',
  timezone: '-05:00',
});

export const authDb = mysqlPool(env.AUTH_DB_DATABASE, env.AUTH_DB_HOST, env.AUTH_DB_PORT, env.AUTH_DB_USER, env.AUTH_DB_PASSWORD);
export const gambleDb = mysqlPool(env.GAMBLE_DB_DATABASE, env.GAMBLE_DB_HOST, env.GAMBLE_DB_PORT, env.GAMBLE_DB_USER, env.GAMBLE_DB_PASSWORD);
export const personaDb = mysqlPool(env.PERSONA_DB_DATABASE, env.PERSONA_DB_HOST, env.PERSONA_DB_PORT, env.PERSONA_DB_USER, env.PERSONA_DB_PASSWORD);

if (env.DB_ORACLE_THICK_MODE) {
  oracledb.initOracleClient({ libDir: env.ORACLE_CLIENT_LIB_DIR, configDir: env.ORACLE_CONFIG_DIR });
}

export class OracleConfigurationError extends Error {
  constructor() {
    super('Oracle requiere ORACLE_USER, ORACLE_PASSWORD y ORACLE_CONNECT_STRING configurados.');
    this.name = 'OracleConfigurationError';
  }
}

let oraclePoolPromise: Promise<oracledb.Pool> | undefined;

async function getOraclePool() {
  if (!env.ORACLE_USER || !env.ORACLE_PASSWORD || !env.ORACLE_CONNECT_STRING) {
    throw new OracleConfigurationError();
  }
  if (!oraclePoolPromise) {
    oraclePoolPromise = oracledb.createPool({
      user: env.ORACLE_USER,
      password: env.ORACLE_PASSWORD,
      connectString: env.ORACLE_CONNECT_STRING,
      configDir: env.ORACLE_CONFIG_DIR,
      poolMin: 1,
      poolMax: 8,
      poolIncrement: 1,
    });
  }
  try {
    return await oraclePoolPromise;
  } catch (error) {
    oraclePoolPromise = undefined;
    throw error;
  }
}

export async function getOracleConnection() {
  const pool = await getOraclePool();
  return pool.getConnection();
}

export async function closePools() {
  const pools = [authDb.end(), gambleDb.end(), personaDb.end()];
  if (oraclePoolPromise) pools.push(oraclePoolPromise.then((pool) => pool.close(10)));
  await Promise.all(pools);
}