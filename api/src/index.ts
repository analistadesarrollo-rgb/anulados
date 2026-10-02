import 'express-async-errors';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { ZodError } from 'zod';
import { env } from './env.js';
import { closePools, OracleConfigurationError } from './db.js';
import { requireSession } from './middleware/session.js';
import { ensureSystemProfiles } from './system-profiles.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { formsRouter } from './routes/forms.js';
import { raspeRouter } from './routes/raspe.js';
import { portfolioRouter } from './routes/portfolio.js';
import { catalogRouter } from './routes/catalog.js';
import { reportsRouter } from './routes/reports.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: env.API_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const api = express.Router();
api.get('/health', (_req, res) => res.json({ status: 'ok' }));
api.use(authRouter);
api.use(requireSession);
api.use('/admin', adminRouter);
api.use(formsRouter);
api.use(raspeRouter);
api.use(portfolioRouter);
api.use(catalogRouter);
api.use(reportsRouter);
api.use((_req, res) => { res.status(404).json({ message: 'Ruta no encontrada' }); });
app.use(env.API_VERSION, api);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ message: 'Solicitud invalida' });
  if (error instanceof OracleConfigurationError) return res.status(503).json({ message: error.message });
  console.error('API error:', error);
  return res.status(500).json({ message: 'Error interno del servidor' });
});

const server = app.listen(env.API_PORT, '0.0.0.0', () => console.log(`API escuchando en puerto ${env.API_PORT}`));

void ensureSystemProfiles()
  .then((created) => { if (created > 0) console.log(`Perfiles de sistema verificados: ${created} creados.`); })
  .catch((error: Error) => { console.warn(`No se pudieron verificar los perfiles de sistema: ${error.message}`); });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => { void closePools().finally(() => process.exit(0)); });
  });
}