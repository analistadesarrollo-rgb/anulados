import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

config({ path: resolve(process.cwd(), '../.env') });
config();

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  API_PORT: z.coerce.number().default(8080),
  API_VERSION: z.string().default('/api/v1'),
  API_ORIGIN: z.string().url().default('http://localhost:8086'),
  JWT_SECRET: z.string().min(32),
  JWT_COOKIE_NAME: z.string().default('control_anulados_v2'),
  JWT_TTL: z.string().default('8h'),
  AUTH_DB_HOST: z.string(),
  AUTH_DB_PORT: z.coerce.number().default(3306),
  AUTH_DB_DATABASE: z.string(),
  AUTH_DB_USER: z.string(),
  AUTH_DB_PASSWORD: z.string(),
  GAMBLE_DB_HOST: z.string(),
  GAMBLE_DB_PORT: z.coerce.number().default(3306),
  GAMBLE_DB_DATABASE: z.string().default('GAMBLE'),
  GAMBLE_DB_USER: z.string(),
  GAMBLE_DB_PASSWORD: z.string(),
  PERSONA_DB_HOST: z.string(),
  PERSONA_DB_PORT: z.coerce.number().default(3306),
  PERSONA_DB_DATABASE: z.string().default('bdpersona'),
  PERSONA_DB_USER: z.string(),
  PERSONA_DB_PASSWORD: z.string(),
  ORACLE_USER: z.string(),
  ORACLE_PASSWORD: z.string(),
  ORACLE_CONNECT_STRING: z.string(),
  ORACLE_CONFIG_DIR: z.string().optional(),
  ORACLE_CLIENT_LIB_DIR: z.string().optional(),
  DB_ORACLE_THICK_MODE: z.preprocess((value) => value === true || value === 'true', z.boolean().default(false)),
});

export const env = schema.parse(process.env);

const ttlPattern = /^(\d+)([smhd])$/.exec(env.JWT_TTL);
if (!ttlPattern) throw new Error(`JWT_TTL invalido: ${env.JWT_TTL}. Usa un valor como 30m, 45m o 8h.`);
const ttlUnitMs: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
export const sessionTtlMs = Number(ttlPattern[1]) * ttlUnitMs[ttlPattern[2]];
export const sessionTtlSeconds = sessionTtlMs / 1000;
export const sessionTtlMinutes = Math.max(1, Math.round(sessionTtlMs / 60000));