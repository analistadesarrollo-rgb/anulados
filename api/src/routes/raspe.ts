import { Router } from 'express';
import oracledb from 'oracledb';
import { z } from 'zod';
import { gambleDb } from '../db.js';
import { requirePermission } from '../middleware/session.js';
import type { AuthenticatedRequest } from '../types.js';

export const raspeRouter = Router();

raspeRouter.get('/raspe/search', requirePermission('raspe:search'), async (req, res) => {
  const raw = String(req.query.code ?? '').trim();
  const parts = raw.split('-', 2);
  const saleCode = parts[1] ?? '';
  const paymentCode = raw.replace(/\D/g, '');
  if (!saleCode || !paymentCode) return res.status(400).json({ message: 'El codigo no tiene el formato esperado' });

  const connection = await oracledb.getPool().getConnection();
  try {
    const [sales, payments] = await Promise.all([
      connection.execute<Record<string, unknown>>(
        `SELECT CODIGOVENTA, FECHAVENTA, HORAVENTA, VALOR, VENDEDOR, EMPRESA, 'VENDIDO' ESTADO, ZONA
         FROM GAMBLE.VENTARASPEFISREPL@NAOS_HCI WHERE CODIGOVENTA LIKE '%' || :code || '%'`,
        { code: saleCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
      ),
      connection.execute<Record<string, unknown>>(
        `SELECT CODIGOVENTA, FECHAPAGO, HORAPAGO, TOTALPREMIO, CAJERO, NOMBRE_ZONA, 'PAGADO' ESTADO, ZONA
         FROM GAMBLE.PAGOPREMIORASPEFISREPL@NAOS_HCI WHERE CODIGOVENTA LIKE '%' || :code || '%'`,
        { code: paymentCode }, { outFormat: oracledb.OUT_FORMAT_OBJECT },
      ),
    ]);
    return res.json({ sales: sales.rows ?? [], payments: payments.rows ?? [] });
  } finally {
    await connection.close();
  }
});

const raspeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sale'), code: z.string().min(1), date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/), time: z.string().min(1), value: z.coerce.number().nonnegative(), vendor: z.string(), company: z.string(), zone: z.coerce.number().int() }),
  z.object({ type: z.literal('payment'), code: z.string().min(1), date: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/), time: z.string().min(1), prize: z.coerce.number().nonnegative(), cashier: z.string(), zoneName: z.string(), zone: z.coerce.number().int() }),
]);

function toMysqlDate(date: string) {
  const [day, month, year] = date.split('/');
  return `${year}-${month}-${day}`;
}

raspeRouter.post('/raspe', requirePermission('raspe:write'), async (req: AuthenticatedRequest, res) => {
  const parsed = raspeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Datos de registro incompletos o invalidos' });
  const data = parsed.data;
  if (data.type === 'sale' && ![39627, 39628].includes(data.zone)) return res.status(400).json({ message: 'Zona de venta invalida' });
  if (data.type === 'payment' && ![103, 132].includes(data.zone)) return res.status(400).json({ message: 'Zona de pago invalida' });
  const table = data.type === 'sale' ? 'VENTA_RASPA' : 'PAGO_RASPA';
  const [existing] = await gambleDb.execute(`SELECT COUNT(*) AS total FROM ${table} WHERE CODIGOVENTA=?`, [data.code]);
  if (Number((existing as Array<{ total: number }>)[0]?.total ?? 0) > 0) return res.status(409).json({ message: 'Este codigo ya se encuentra registrado' });

  if (data.type === 'sale') {
    await gambleDb.execute(
      `INSERT INTO VENTA_RASPA (ID,NOMBRE,CODIGOVENTA,FECHAVENTA,HORAVENTA,VALOR,VENDEDOR,EMPRESA,ESTADO,ZONA,HORACO)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
      [req.user!.login, req.user!.displayName, data.code, toMysqlDate(data.date), data.time, data.value, data.vendor, data.company, 'VENDIDO', data.zone],
    );
  } else {
    await gambleDb.execute(
      `INSERT INTO PAGO_RASPA (ID,NOMBRE,CODIGOVENTA,FECHAPAGO,HORAPAGO,TOTALPREMIO,CAJERO,NOMBRE_ZONA,ESTADO,ZONA,HORACO)
       VALUES (?,?,?,?,?,?,?,?,?,?,NOW())`,
      [req.user!.login, req.user!.displayName, data.code, toMysqlDate(data.date), data.time, data.prize, data.cashier, data.zoneName, 'PAGADO', data.zone],
    );
  }
  return res.status(201).json({ message: data.type === 'sale' ? 'Venta registrada' : 'Pago registrado' });
});