import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, save, UserRecord } from './db.ts';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export function createSession(userId: string): string {
  const now = Date.now();
  db.sessions = db.sessions.filter((s) => s.expiresAt > now);
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({ token, userId, expiresAt: now + SESSION_TTL_MS });
  save();
  return token;
}

export function destroySession(token: string) {
  db.sessions = db.sessions.filter((s) => s.token !== token);
  save();
}

export function publicUser(user: UserRecord) {
  return {
    name: user.name,
    role: user.role,
    organization: user.organization,
    email: user.email,
  };
}

function readToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserRecord;
      sessionToken?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  const session = token
    ? db.sessions.find((s) => s.token === token && s.expiresAt > Date.now())
    : undefined;
  const user = session ? db.users.find((u) => u.id === session.userId) : undefined;

  if (!session || !user) {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    return;
  }

  req.user = user;
  req.sessionToken = session.token;
  next();
}
