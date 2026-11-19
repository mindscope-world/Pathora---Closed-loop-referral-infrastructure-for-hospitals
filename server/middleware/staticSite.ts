import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type RequestHandler, Router } from 'express';

/**
 * Serves the built frontend (single deployable). Hashed files under /assets are cached for a year; index.html is never
 * cached so a new release is picked up at once. Unknown paths that look like pages fall back to index.html (client-side
 * routing), but anything under /api, any path with a file extension or a dot-segment, and any non-GET request stays a real 404:
 * a missing script must not come back as an HTML page.
 */
export function staticSite(dir: string): Router | null {
  const root = path.resolve(dir);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) return null;

  const r = Router();
  r.use(
    express.static(root, {
      index: false,
      dotfiles: 'ignore',
      setHeaders: (res, file) => {
        const hashed = file.startsWith(path.join(root, 'assets') + path.sep);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600');
      },
    }),
  );
  const fallback: RequestHandler = (req, res, next) => {
    const wantsPage = (req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api') && path.extname(req.path) === '' && !req.path.split('/').some((seg) => seg.startsWith('.')) && req.accepts('html');
    if (!wantsPage) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  };
  r.use(fallback);
  return r;
}
