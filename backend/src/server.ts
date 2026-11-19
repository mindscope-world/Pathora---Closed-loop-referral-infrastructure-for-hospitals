import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { authRouter } from './routes/authRoutes.ts';
import { discoveryRouter } from './routes/discoveryRoutes.ts';
import { workspaceRouter } from './routes/workspaceRoutes.ts';

const app = express();
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/discovery-requests', discoveryRouter);
app.use('/api/workspace', workspaceRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// After `npm run build`, serve the built frontend from the same origin (used by `npm start`).
const distDir = path.resolve(import.meta.dirname, '..', '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: 'Request body must be valid JSON.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  console.log(`Pathora API listening on http://localhost:${PORT}`);
});
