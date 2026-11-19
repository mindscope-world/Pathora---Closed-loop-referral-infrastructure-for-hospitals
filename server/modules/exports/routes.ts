import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pipeline } from 'node:stream/promises';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { idempotent } from '../../middleware/idempotency';
import { validateBody } from '../../middleware/validate';
import { getFileStore } from '../../storage/fileStore';
import { authoriseDownload, createExportSchema, getExport, listExports, requestExport } from './service';
import { verifyDownloadToken } from './signedUrl';

const ID = /^[a-z0-9]{20,32}$/; // cuid

export function exportsRouter(opts: { kick: () => void }): Router {
  const r = Router();

  // ── Public: signed download link. The signature is the credential; see signedUrl.ts. ──
  r.get(
    '/:id/download',
    rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false,
      handler: (_q, _s, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.')) }),
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const link = ID.test(id) ? verifyDownloadToken(token, id) : null;
      if (!link) throw new HttpError(403, 'INVALID_LINK', 'This download link is invalid or has expired. Open the export again to get a new one.');

      const job = await authoriseDownload(id, link.orgId); // audits before any bytes are sent
      const store = getFileStore();
      let size: number;
      try {
        size = await store.size(job.fileKey!);
      } catch {
        throw new HttpError(410, 'EXPORT_UNAVAILABLE', 'This export is no longer available. Request a new one.');
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Length', String(size));
      // Patient data: never cache, never sniff, always download rather than render.
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `attachment; filename="${job.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
      await pipeline(store.read(job.fileKey!), res);
    }),
  );

  // ── Authenticated ──
  r.use(authenticate, requirePermission('exports.create'));
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.post('/', validateBody(createExportSchema), idempotent, asyncHandler(async (req, res) => {
    res.status(202).json(await requestExport(req.auth!, req.body, opts.kick));
  }));

  r.get('/', asyncHandler(async (req, res) => {
    res.json({ exports: await listExports(req.auth!) });
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    if (!ID.test(req.params.id)) throw HttpError.notFound('Export not found');
    res.json(await getExport(req.auth!, req.params.id));
  }));

  return r;
}
