import 'express-async-errors';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { ZodError } from 'zod';
import { env } from './env.js';
import { initOracle } from './db.js';
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
api.use(authRouter);
api.use('/admin', adminRouter);
api.use(formsRouter);
api.use(raspeRouter);
api.use(portfolioRouter);
api.use(catalogRouter);
api.use(reportsRouter);
api.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use(env.API_VERSION, api);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ message: 'Solicitud invalida' });
  console.error('API error:', error);
  return res.status(500).json({ message: 'Error interno del servidor' });
});

initOracle().then(() => {
  app.listen(env.API_PORT, '0.0.0.0', () => console.log(`API escuchando en puerto ${env.API_PORT}`));
}).catch((error: unknown) => {
  console.error('No se pudo inicializar Oracle:', error);
  process.exit(1);
});