import { Router } from 'express';
import oracledb from 'oracledb';
import { z } from 'zod';
import { gambleDb, getOracleConnection } from '../db.js';
import { requirePermission } from '../middleware/session.js';
import type { AuthenticatedRequest } from '../types.js';

export const formsRouter = Router();

const oracleFormSql = `
  SELECT CST.FECHA, CST.HORA, CST.SERIE_KARDEX, CST.CONSECUTIVO, LO.NOMBRECORTO,
         CST.HORAFINALVENTA, CST.TOTALPAGADO, CST.UTILIDAD, CST.DOCUMENTO_VENDEDOR,
         UPPER(CST.VENDEDOR) VENDEDOR, CST.HORA_CONSULTA
  FROM (
    SELECT F.FECHA, F.HORA,
           F.SERIE || F.NUMERO SERIE_KARDEX,
           F.SERIE_CONSTVO || F.NUMERO_CONSTVO CONSECUTIVO,
           MIN(LO.CODIGO) LOTERY,
           MIN(LO.HORAFINALVENTA) HORAFINALVENTA,
           F.TOTALPAGADO,
           ROUND((F.TOTALPAGADO * (GAMBLE.FUNPORCENTAJEUTILIDAD(F.PRS_DOCUMENTO, CODIGO_TIPOJUEGO) / 100)) / 1.19, 2) UTILIDAD,
           F.PRS_DOCUMENTO DOCUMENTO_VENDEDOR,
           PE.NOMBRES || ' ' || PE.APELLIDO1 || ' ' || PE.APELLIDO2 VENDEDOR,
           TO_CHAR(SYSDATE, 'HH24:MI:SS') HORA_CONSULTA
    FROM formularios F, detalleformularios DE, loteries LO, personas PE
    WHERE F.SERIE = DE.FRM_SERIE AND F.NUMERO = DE.FRM_NUMERO
      AND LO.CODIGO = DE.PRDLOT_LTRY_CODIGO AND PE.DOCUMENTO = F.PRS_DOCUMENTO
      AND F.DAT_DTO_CODLA_ELABORACION_PARA = '17'
      AND F.ZONA = :zona AND F.FECHA = TRUNC(SYSDATE)
      AND F.SERIE = :serie AND F.NUMERO = :numero AND F.TOTALPAGADO > 0
    GROUP BY F.FECHA, F.HORA, F.SERIE || F.NUMERO, F.SERIE_CONSTVO || F.NUMERO_CONSTVO,
             F.TOTALPAGADO, F.PRS_DOCUMENTO,
             GAMBLE.FUNPORCENTAJEUTILIDAD(F.PRS_DOCUMENTO, CODIGO_TIPOJUEGO),
             PE.NOMBRES || ' ' || PE.APELLIDO1 || ' ' || PE.APELLIDO2,
             F.DAT_DTO_CODLA_ELABORACION_PARA
  ) CST, LOTERIES LO
  WHERE LO.CODIGO = CST.LOTERY`;

const searchSchema = z.object({ serie: z.string().trim().min(1).max(10), numero: z.string().trim().regex(/^\d{1,10}$/), zona: z.coerce.number().int().optional() });
const registerSchema = searchSchema.extend({ motivo: z.enum(['EN BLANCO', 'BIEN IMPRESO', 'MAL IMPRESO', 'NO IMPRESO']), nota: z.string().trim().min(1).max(200), observacionesRegistro: z.string().max(4000).optional().default('') });
const allowedReasons = new Set(['EN BLANCO', 'BIEN IMPRESO', 'MAL IMPRESO', 'NO IMPRESO']);

function allowedZones(profile: string) {
  if (['CENTRAL_DE_SERVICIOS', 'TECNICO-SERVIRED', 'TECNICO-MULTIRED'].includes(profile)) return [39628, 39627];
  return [39628];
}

async function findOracleForm(serie: string, numero: string, zona: number) {
  const connection = await getOracleConnection();
  try {
    const result = await connection.execute<Record<string, unknown>>(oracleFormSql, { serie, numero, zona }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return result.rows?.[0] ?? null;
  } finally {
    await connection.close();
  }
}

function tableForZone(zone: number) {
  return zone === 39627 ? 'ANULADOS_NEW_YUMBO' : 'ANULADOS_NEW_JAMUNDI';
}

formsRouter.post('/forms/search', requirePermission('forms:register'), async (req: AuthenticatedRequest, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Serie, numero o zona invalidos' });
  const zones = allowedZones(req.user!.profile);
  const zone = parsed.data.zona && zones.includes(parsed.data.zona) ? parsed.data.zona : zones[0];
  if (parsed.data.zona && !zones.includes(parsed.data.zona)) return res.status(403).json({ message: 'Tu perfil no puede registrar en esa zona' });
  const form = await findOracleForm(parsed.data.serie, parsed.data.numero.padStart(10, '0'), zone);
  if (!form) return res.status(404).json({ message: 'Formulario inexistente, no es de hoy o pertenece a otra zona' });
  return res.json({ ...form, zona: zone, serieQuery: parsed.data.serie, numeroQuery: parsed.data.numero.padStart(10, '0') });
});

formsRouter.post('/forms', requirePermission('forms:register'), async (req: AuthenticatedRequest, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Completa motivo y causal, y verifica serie, numero y zona' });
  const zones = allowedZones(req.user!.profile);
  const zone = parsed.data.zona ?? zones[0];
  if (!zones.includes(zone)) return res.status(403).json({ message: 'Tu perfil no puede registrar en esa zona' });
  const form = await findOracleForm(parsed.data.serie, parsed.data.numero.padStart(10, '0'), zone);
  if (!form) return res.status(404).json({ message: 'Formulario inexistente, no es de hoy o pertenece a otra zona' });

  const value = Number(form.TOTALPAGADO);
  const finalTime = String(form.HORAFINALVENTA);
  const checkTime = String(form.HORA_CONSULTA);
  if (parsed.data.motivo === 'BIEN IMPRESO' && value < 6000) return res.status(400).json({ message: 'BIEN IMPRESO requiere un valor minimo de 6000' });
  if (checkTime >= finalTime) return res.status(400).json({ message: 'La hora de consulta debe ser anterior a la hora final' });

  const table = tableForZone(zone);
  const delivery = parsed.data.motivo === 'NO IMPRESO' ? 'N' : 'P';
  const state = parsed.data.motivo === 'NO IMPRESO' ? 'PENDIENTE' : '';
  const sql = `INSERT INTO ${table}
    (FECHA, HORA, SERIE, CONSECUTIVO, LOTERIA, HORA_FINAL, VALOR, UTILIDAD_C, DOCUMENTO_C, NOMBRE_C,
     MOTIVO, HORA_CONSULTA, LOGIN, ESTADO, CREADOR_R, ESTADO_ENTREGA, NOTA, OBSERVACIONES_REGISTRO)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  try {
    const [result] = await gambleDb.execute(sql, [
      form.FECHA, form.HORA, form.SERIE_KARDEX, form.CONSECUTIVO, form.NOMBRECORTO, form.HORAFINALVENTA,
      form.TOTALPAGADO, form.UTILIDAD, form.DOCUMENTO_VENDEDOR, form.VENDEDOR, parsed.data.motivo,
      form.HORA_CONSULTA, req.user!.login, state, req.user!.displayName, delivery, parsed.data.nota,
      parsed.data.observacionesRegistro,
    ]);
    return res.status(201).json({ message: 'Formulario registrado', id: (result as { insertId: number }).insertId, serie: form.SERIE_KARDEX });
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'El formulario ya esta registrado' });
    throw error;
  }
});

const listPolicies: Record<string, { permission: string; table: string; where: string; searchWhere?: string }> = {
  servired: { permission: 'records:central', table: 'ANULADOS_NEW_JAMUNDI', where: "FECHA=DATE_FORMAT(CURDATE(),'%d/%m/%Y')" },
  multired: { permission: 'records:central', table: 'ANULADOS_NEW_YUMBO', where: "FECHA=DATE_FORMAT(CURDATE(),'%d/%m/%Y')" },
  ti: { permission: 'records:ti', table: 'ANULADOS_NEW_JAMUNDI', where: "FECHA=DATE_FORMAT(CURDATE(),'%d/%m/%Y')" },
  commercial: { permission: 'records:commercial', table: 'ANULADOS_NEW_JAMUNDI', where: "ESTADO_ENTREGA='P' AND MOTIVO<>'NO IMPRESO'", searchWhere: "MOTIVO<>'NO IMPRESO'" },
  accounting: { permission: 'records:accounting', table: 'ANULADOS_NEW_JAMUNDI', where: '1 = 1' },
  audit: { permission: 'records:audit', table: 'ANULADOS_NEW_JAMUNDI', where: "ESTADO='PENDIENTE' AND ESTADO_ENTREGA='S' AND MOTIVO <> 'NO IMPRESO' AND ESTADO <> 'COBRAR'" },
  'audit-operations': { permission: 'records:audit-operations', table: 'ANULADOS_NEW_JAMUNDI', where: "MOTIVO='NO IMPRESO' AND ESTADO='PENDIENTE' AND ESTADO_ENTREGA='N'" },
  portfolio: { permission: 'records:portfolio', table: 'ANULADOS_NEW_JAMUNDI', where: "FECHA=DATE_FORMAT(CURDATE(),'%d/%m/%Y')" },
};

formsRouter.get('/records/:view', async (req: AuthenticatedRequest, res) => {
  const policy = listPolicies[req.params.view];
  if (!policy) return res.status(404).json({ message: 'Vista no encontrada' });
  if (!req.user!.permissions.includes(policy.permission)) return res.status(403).json({ message: 'No tienes permiso para esta vista' });
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const term = String(req.query.q ?? '').trim().slice(0, 100);
  let baseWhere = term
    ? policy.searchWhere ?? (['servired', 'multired', 'ti'].includes(req.params.view) ? '1 = 1' : policy.where)
    : policy.where;
  let filter = term ? ` AND (CODIGO LIKE ? OR FECHA LIKE ? OR SERIE LIKE ? OR DOCUMENTO_C LIKE ? OR ESTADO_ENTREGA LIKE ? OR ESTADO LIKE ? OR MOTIVO LIKE ?)` : '';
  let values: Array<string | number> = term ? Array(7).fill(`%${term}%`) : [];
  const dateFrom = String(req.query.dateFrom ?? '');
  const dateTo = String(req.query.dateTo ?? '');
  if (req.params.view === 'audit' && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    baseWhere = "STR_TO_DATE(FECHA,'%d/%m/%Y') BETWEEN STR_TO_DATE(?,'%Y-%m-%d') AND STR_TO_DATE(?,'%Y-%m-%d')";
    filter = '';
    values = [dateFrom, dateTo];
  }
  const [rows] = await gambleDb.execute(
    `SELECT * FROM ${policy.table} WHERE ${baseWhere}${filter} ORDER BY CODIGO DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  const [countRows] = await gambleDb.execute(`SELECT COUNT(*) AS total FROM ${policy.table} WHERE ${baseWhere}${filter}`, values);
  return res.json({ rows, total: Number((countRows as Array<{ total: number }>)[0]?.total ?? 0), page, limit });
});

const techUpdate = z.object({ motivo: z.enum(['EN BLANCO', 'BIEN IMPRESO', 'MAL IMPRESO', 'NO IMPRESO']), nota: z.string().trim().min(1).max(200) });
formsRouter.patch('/records/:zone/:serie/technical', requirePermission('forms:register'), async (req: AuthenticatedRequest, res) => {
  const zone = Number(req.params.zone);
  if (!allowedZones(req.user!.profile).includes(zone)) return res.status(403).json({ message: 'No puedes editar esta zona' });
  const parsed = techUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Motivo o causal invalidos' });
  const table = tableForZone(zone);
  const connection = await gambleDb.getConnection();
  const delivery = parsed.data.motivo === 'NO IMPRESO' ? 'N' : 'P';
  const state = parsed.data.motivo === 'NO IMPRESO' ? 'PENDIENTE' : '';
  try {
    await connection.beginTransaction();
    const [records] = await connection.execute(`SELECT * FROM ${table} WHERE SERIE=? LIMIT 1 FOR UPDATE`, [req.params.serie]);
    const record = (records as Array<Record<string, unknown>>)[0];
    if (!record) { await connection.rollback(); return res.status(404).json({ message: 'Formulario no encontrado' }); }
    const [dates] = await connection.execute("SELECT DATE_FORMAT(CURDATE(),'%d/%m/%Y') AS today");
    if (record.FECHA !== (dates as Array<{ today: string }>)[0]?.today) { await connection.rollback(); return res.status(403).json({ message: 'Los formularios de dias anteriores son de solo lectura' }); }
    if (parsed.data.motivo === 'BIEN IMPRESO' && Number(record.VALOR) < 6000) { await connection.rollback(); return res.status(400).json({ message: 'BIEN IMPRESO requiere un valor minimo de 6000' }); }
    if (String(record.HORA_CONSULTA) >= String(record.HORA_FINAL)) { await connection.rollback(); return res.status(400).json({ message: 'La hora de consulta debe ser anterior a la hora final' }); }
    await connection.execute(
      `UPDATE ${table} SET MOTIVO=?, ESTADO_ENTREGA=?, ESTADO=?, LOGIN=?, NOTA=?, FECHA_ACTUALIZACION=NOW() WHERE SERIE=?`,
      [parsed.data.motivo, delivery, state, req.user!.login, parsed.data.nota, req.params.serie],
    );
    const historyTable = zone === 39627 ? 'HIST_ANULADOS_NEW_YUMBO' : 'HIST_ANULADOS_NEW_JAMUNDI';
    await connection.execute(
      `INSERT INTO ${historyTable}
       (CODIGO,SERIE,VALOR,UTILIDAD_C,DOCUMENTO_C,NOMBRE_C,MOTIVO,FECHA,ESTADO_ENTREGA,ESTADO,FECHASYS,LOGIN,NOTA,OBSERVACIONES_REGISTRO,OBSERVACIONES_AUDITORIA,FECHA_ACTUALIZACION,USUARIO_AUDITORIA)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,NOW(),?)`,
      [record.CODIGO, record.SERIE, record.VALOR, record.UTILIDAD_C, record.DOCUMENTO_C, record.NOMBRE_C,
        parsed.data.motivo, record.FECHA, delivery, state, req.user!.login, parsed.data.nota,
        record.OBSERVACIONES_REGISTRO ?? null, record.OBSERVACIONES_AUDITORIA ?? null, record.USUARIO_AUDITORIA ?? null],
    );
    await connection.commit();
    return res.json({ message: 'Formulario actualizado' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

const auditUpdate = z.object({ state: z.enum(['AUTORIZADO', 'COBRAR']), observacionesAuditoria: z.string().trim().min(1).max(4000) });
formsRouter.patch('/records/:serie/audit', requirePermission('records:update:audit'), async (req: AuthenticatedRequest, res) => {
  const parsed = auditUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'La decision y observacion de auditoria son obligatorias' });
  const connection = await gambleDb.getConnection();
  try {
    await connection.beginTransaction();
    const [records] = await connection.execute('SELECT * FROM ANULADOS_NEW_JAMUNDI WHERE SERIE=? LIMIT 1 FOR UPDATE', [req.params.serie]);
    const record = (records as Array<Record<string, unknown>>)[0];
    if (!record) { await connection.rollback(); return res.status(404).json({ message: 'Formulario no encontrado' }); }
    if (record.MOTIVO === 'NO IMPRESO') { await connection.rollback(); return res.status(400).json({ message: 'Los formularios NO IMPRESO corresponden a auditoria operativa' }); }
    await connection.execute(
      `UPDATE ANULADOS_NEW_JAMUNDI SET ESTADO=?, LOGIN=?, OBSERVACIONES_AUDITORIA=?,
       FECHA_ACTUALIZACION=NOW(), USUARIO_AUDITORIA=? WHERE SERIE=?`,
      [parsed.data.state, req.user!.login, parsed.data.observacionesAuditoria, req.user!.login, req.params.serie],
    );
    await connection.execute(
      `INSERT INTO HIST_ANULADOS_NEW_JAMUNDI
       (CODIGO,SERIE,VALOR,UTILIDAD_C,DOCUMENTO_C,NOMBRE_C,MOTIVO,FECHA,ESTADO_ENTREGA,ESTADO,FECHASYS,LOGIN,NOTA,OBSERVACIONES_REGISTRO,OBSERVACIONES_AUDITORIA,FECHA_ACTUALIZACION,USUARIO_AUDITORIA)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,NOW(),?)`,
      [record.CODIGO, record.SERIE, record.VALOR, record.UTILIDAD_C, record.DOCUMENTO_C, record.NOMBRE_C, record.MOTIVO,
        record.FECHA, record.ESTADO_ENTREGA, parsed.data.state, req.user!.login, record.NOTA, record.OBSERVACIONES_REGISTRO,
        parsed.data.observacionesAuditoria, req.user!.login],
    );
    if (parsed.data.state === 'COBRAR') {
      await connection.execute(
        `INSERT INTO ANULADOS_COBRO_JAMUNDI
         (CODIGO,FECHA,SERIE,CONSECUTIVO,VALOR,UTILIDAD_C,DOCUMENTO_C,NOMBRE_C,MOTIVO,LOGIN,ESTADO,CREADOR_R,NOTA,OBSERVACIONES_REGISTRO,OBSERVACIONES_AUDITORIA,USUARIO_AUDITORIA,FECHASYS)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [record.CODIGO, record.FECHA, record.SERIE, record.CONSECUTIVO, record.VALOR, record.UTILIDAD_C,
          record.DOCUMENTO_C, record.NOMBRE_C, record.MOTIVO, req.user!.login, parsed.data.state, record.CREADOR_R,
          record.NOTA, record.OBSERVACIONES_REGISTRO, parsed.data.observacionesAuditoria, req.user!.login],
      );
    }
    await connection.commit();
    return res.json({ message: 'Formulario auditado' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

const operationalAuditUpdate = z.object({ state: z.enum(['AUTORIZADO', 'COBRAR']), observacionesAuditoria: z.string().trim().min(1).max(4000) });
formsRouter.patch('/records/:serie/audit-operations', requirePermission('records:update:audit-operations'), async (req: AuthenticatedRequest, res) => {
  const parsed = operationalAuditUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'La decision y observacion de auditoria son obligatorias' });
  const connection = await gambleDb.getConnection();
  try {
    await connection.beginTransaction();
    const [records] = await connection.execute('SELECT * FROM ANULADOS_NEW_JAMUNDI WHERE SERIE=? LIMIT 1 FOR UPDATE', [req.params.serie]);
    const record = (records as Array<Record<string, unknown>>)[0];
    if (!record || record.MOTIVO !== 'NO IMPRESO') { await connection.rollback(); return res.status(404).json({ message: 'Formulario no impreso no encontrado' }); }
    await connection.execute(
      `UPDATE ANULADOS_NEW_JAMUNDI SET ESTADO=?, LOGIN=?, OBSERVACIONES_AUDITORIA=?,
       FECHA_ACTUALIZACION=NOW(), USUARIO_AUDITORIA=? WHERE SERIE=?`,
      [parsed.data.state, req.user!.login, parsed.data.observacionesAuditoria, req.user!.login, req.params.serie],
    );
    await connection.execute(
      `INSERT INTO HIST_ANULADOS_NEW_JAMUNDI
       (CODIGO,SERIE,VALOR,UTILIDAD_C,DOCUMENTO_C,NOMBRE_C,MOTIVO,FECHA,ESTADO_ENTREGA,ESTADO,FECHASYS,LOGIN,NOTA,OBSERVACIONES_REGISTRO,OBSERVACIONES_AUDITORIA,FECHA_ACTUALIZACION,USUARIO_AUDITORIA)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,NOW(),?)`,
      [record.CODIGO, record.SERIE, record.VALOR, record.UTILIDAD_C, record.DOCUMENTO_C, record.NOMBRE_C, record.MOTIVO,
        record.FECHA, record.ESTADO_ENTREGA, parsed.data.state, req.user!.login, record.NOTA, record.OBSERVACIONES_REGISTRO,
        parsed.data.observacionesAuditoria, req.user!.login],
    );
    if (parsed.data.state === 'COBRAR') {
      await connection.execute(
        `INSERT INTO ANULADOS_COBRO_JAMUNDI
         (CODIGO,FECHA,SERIE,CONSECUTIVO,VALOR,UTILIDAD_C,DOCUMENTO_C,NOMBRE_C,MOTIVO,LOGIN,ESTADO,CREADOR_R,NOTA,OBSERVACIONES_REGISTRO,OBSERVACIONES_AUDITORIA,USUARIO_AUDITORIA,FECHASYS)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [record.CODIGO, record.FECHA, record.SERIE, record.CONSECUTIVO, record.VALOR, record.UTILIDAD_C,
          record.DOCUMENTO_C, record.NOMBRE_C, record.MOTIVO, req.user!.login, parsed.data.state, record.CREADOR_R,
          record.NOTA, record.OBSERVACIONES_REGISTRO, parsed.data.observacionesAuditoria, req.user!.login],
      );
    }
    await connection.commit();
    return res.json({ message: 'Formulario operativo auditado' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
});

formsRouter.patch('/records/:serie/commercial', requirePermission('records:update:commercial'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ estadoEntrega: z.enum(['N', 'S']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Estado de entrega invalido' });
  const state = parsed.data.estadoEntrega === 'N' ? 'DENEGADO' : 'PENDIENTE';
  const connection = await gambleDb.getConnection();
  try {
    await connection.beginTransaction();
    const [records] = await connection.execute('SELECT * FROM ANULADOS_NEW_JAMUNDI WHERE SERIE=? LIMIT 1 FOR UPDATE', [req.params.serie]);
    const record = (records as Array<Record<string, unknown>>)[0];
    if (!record) { await connection.rollback(); return res.status(404).json({ message: 'Formulario no encontrado' }); }
    await connection.execute('UPDATE ANULADOS_NEW_JAMUNDI SET ESTADO_ENTREGA=?, ESTADO=?, LOGIN=? WHERE SERIE=?', [parsed.data.estadoEntrega, state, req.user!.login, req.params.serie]);
    await connection.execute(
      `INSERT INTO HIST_ANULADOS_NEW_JAMUNDI
       (CODIGO,SERIE,VALOR,UTILIDAD_C,DOCUMENTO_C,NOMBRE_C,MOTIVO,FECHA,ESTADO_ENTREGA,ESTADO,FECHASYS,LOGIN,NOTA,OBSERVACIONES_REGISTRO,OBSERVACIONES_AUDITORIA,FECHA_ACTUALIZACION,USUARIO_AUDITORIA)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,NOW(),?)`,
      [record.CODIGO, record.SERIE, record.VALOR, record.UTILIDAD_C, record.DOCUMENTO_C, record.NOMBRE_C,
        record.MOTIVO, record.FECHA, parsed.data.estadoEntrega, state, req.user!.login, record.NOTA,
        record.OBSERVACIONES_REGISTRO ?? null, record.OBSERVACIONES_AUDITORIA ?? null, record.USUARIO_AUDITORIA ?? null],
    );
    await connection.commit();
    return res.json({ message: 'Entrega actualizada' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
});

formsRouter.patch('/records/:serie/accounting', requirePermission('records:update:accounting'), async (req: AuthenticatedRequest, res) => {
  const parsed = z.object({ state: z.enum(['ABONADO', 'NO ABONADO']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Estado contable invalido' });
  const connection = await gambleDb.getConnection();
  try {
    await connection.beginTransaction();
    const [records] = await connection.execute('SELECT * FROM ANULADOS_NEW_JAMUNDI WHERE SERIE=? LIMIT 1 FOR UPDATE', [req.params.serie]);
    const record = (records as Array<Record<string, unknown>>)[0];
    if (!record) { await connection.rollback(); return res.status(404).json({ message: 'Formulario no encontrado' }); }
    await connection.execute('UPDATE ANULADOS_NEW_JAMUNDI SET ESTADO=?, LOGIN=? WHERE SERIE=?', [parsed.data.state, req.user!.login, req.params.serie]);
    await connection.execute(
      `INSERT INTO HIST_ANULADOS_NEW_JAMUNDI
       (CODIGO,SERIE,VALOR,UTILIDAD_C,DOCUMENTO_C,NOMBRE_C,MOTIVO,FECHA,ESTADO_ENTREGA,ESTADO,FECHASYS,LOGIN,NOTA,OBSERVACIONES_REGISTRO,OBSERVACIONES_AUDITORIA,FECHA_ACTUALIZACION,USUARIO_AUDITORIA)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,NOW(),?)`,
      [record.CODIGO, record.SERIE, record.VALOR, record.UTILIDAD_C, record.DOCUMENTO_C, record.NOMBRE_C,
        record.MOTIVO, record.FECHA, record.ESTADO_ENTREGA, parsed.data.state, req.user!.login, record.NOTA,
        record.OBSERVACIONES_REGISTRO ?? null, record.OBSERVACIONES_AUDITORIA ?? null, record.USUARIO_AUDITORIA ?? null],
    );
    await connection.commit();
    return res.json({ message: 'Estado contable actualizado' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
});

formsRouter.patch('/records/:usuario/portfolio', requirePermission('portfolio:manage'), async (req, res) => {
  const parsed = z.object({ estado: z.enum(['S', 'N']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Estado de cartera invalido' });
  const [result] = await gambleDb.execute('UPDATE CARTERA SET ESTADO=? WHERE USUARIO=?', [parsed.data.estado, req.params.usuario]);
  if ((result as { affectedRows: number }).affectedRows === 0) return res.status(404).json({ message: 'Usuario de cartera no encontrado' });
  return res.json({ message: 'Cartera actualizada' });
});