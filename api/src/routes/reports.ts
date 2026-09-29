import { Router } from 'express';
import { gambleDb } from '../db.js';
import { requirePermission } from '../middleware/session.js';
import type { AuthenticatedRequest } from '../types.js';

export const reportsRouter = Router();

const reportDefinitions: Record<string, { permission: string; table: string; where: string }> = {
  'central-servired': { permission: 'reports:central', table: 'ANULADOS_NEW_JAMUNDI', where: "FECHA=DATE_FORMAT(CURDATE(),'%d/%m/%Y')" },
  'central-multired': { permission: 'reports:central', table: 'ANULADOS_NEW_YUMBO', where: "FECHA=DATE_FORMAT(CURDATE(),'%d/%m/%Y')" },
  ti: { permission: 'reports:ti', table: 'ANULADOS_NEW_JAMUNDI', where: "FECHA=DATE_FORMAT(CURDATE(),'%d/%m/%Y')" },
  'commercial-yesterday': { permission: 'reports:commercial', table: 'ANULADOS_NEW_JAMUNDI', where: "FECHA=DATE_FORMAT(CURDATE()-INTERVAL 1 DAY,'%d/%m/%Y')" },
  'commercial-missing': { permission: 'reports:commercial', table: 'ANULADOS_NEW_JAMUNDI', where: "FECHA=DATE_FORMAT(CURDATE()-INTERVAL 1 DAY,'%d/%m/%Y') AND ESTADO_ENTREGA='P' AND MOTIVO<>'NO IMPRESO'" },
  accounting: { permission: 'reports:accounting', table: 'ANULADOS_NEW_JAMUNDI', where: "ESTADO='AUTORIZADO' AND MOTIVO<>'NO IMPRESO'" },
  'accounting-no-print': { permission: 'reports:accounting', table: 'ANULADOS_NEW_JAMUNDI', where: "ESTADO='AUTORIZADO' AND MOTIVO='NO IMPRESO'" },
  audit: { permission: 'reports:audit', table: 'ANULADOS_NEW_JAMUNDI', where: "ESTADO='PENDIENTE' AND MOTIVO<>'NO IMPRESO' AND ESTADO_ENTREGA='S'" },
  'audit-no-print': { permission: 'reports:audit-operations', table: 'ANULADOS_NEW_JAMUNDI', where: "ESTADO='PENDIENTE' AND MOTIVO='NO IMPRESO'" },
};

reportsRouter.get('/reports/:report', async (req: AuthenticatedRequest, res) => {
  const definition = reportDefinitions[req.params.report];
  if (!definition) return res.status(404).json({ message: 'Informe no encontrado' });
  if (!req.user!.permissions.includes(definition.permission)) return res.status(403).json({ message: 'No tienes permiso para este informe' });
  const [rows] = await gambleDb.execute(`SELECT * FROM ${definition.table} WHERE ${definition.where} ORDER BY CODIGO DESC LIMIT 2000`);
  return res.json({ rows });
});

reportsRouter.get('/raspe/history', requirePermission('raspe:search'), async (req, res) => {
  const rawCode = String(req.query.code ?? '').trim().replaceAll('-', '');
  const prefix = rawCode.slice(0, 5);
  const zone = prefix === '39627' ? { sale: '39627', payment: '132' } : prefix === '39628' ? { sale: '39628', payment: '103' } : null;
  const queryCode = zone ? rawCode.slice(5) : rawCode;
  if (!queryCode) return res.json({ sales: [], payments: [] });
  const codePattern = `%${queryCode}%`;
  const saleFilter = zone ? ' AND EMPRESA LIKE ? AND ZONA=?' : '';
  const saleParams: unknown[] = zone ? [codePattern, `%${zone.sale === '39627' ? 'MULTIRED' : 'SERVIRED'}%`, zone.sale] : [codePattern];
  const [sales] = await gambleDb.execute(
    `SELECT 'VENTA' AS TIPO, ID, NOMBRE, CODIGOVENTA, FECHAVENTA AS FECHA, HORAVENTA AS HORA,
            VALOR AS VALOR, VENDEDOR AS RESPONSABLE, EMPRESA AS ZONA, ESTADO, HORACO
     FROM VENTA_RASPA WHERE REPLACE(CODIGOVENTA,'-','') LIKE ?${saleFilter} ORDER BY HORACO DESC LIMIT 1000`,
    saleParams,
  );
  const paymentFilter = zone ? ' AND ZONA=?' : '';
  const paymentParams: unknown[] = zone ? [codePattern, zone.payment] : [codePattern];
  const [payments] = await gambleDb.execute(
    `SELECT 'PAGO' AS TIPO, ID, NOMBRE, CODIGOVENTA, FECHAPAGO AS FECHA, HORAPAGO AS HORA,
            TOTALPREMIO AS VALOR, CAJERO AS RESPONSABLE, NOMBRE_ZONA AS ZONA, ESTADO, HORACO
     FROM PAGO_RASPA WHERE REPLACE(CODIGOVENTA,'-','') LIKE ?${paymentFilter} ORDER BY HORACO DESC LIMIT 1000`,
    paymentParams,
  );
  return res.json({
    sales: sales as Array<Record<string, unknown>>,
    payments: payments as Array<Record<string, unknown>>,
  });
});