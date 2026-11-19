import { Router } from 'express';
import { createSession, destroySession, publicUser, requireAuth } from '../auth.ts';
import { db, nextId, save } from '../db.ts';
import { hashPassword, verifyPassword } from '../passwords.ts';
import { isEmail, str } from '../util.ts';

export const authRouter = Router();

const ROLES = [
  'Programme Manager',
  'Programme Coordinator',
  'Partner Clinical Lead',
  'Receiving Facility Focal',
];

authRouter.post('/signup', (req, res) => {
  const name = str(req.body?.name);
  const organization = str(req.body?.organization);
  const email = str(req.body?.email).toLowerCase();
  const password = str(req.body?.password);
  const role = str(req.body?.role);
  const primaryPathway = str(req.body?.primaryPathway);

  if (!name || !organization) {
    res.status(400).json({ error: 'Please enter your full name and organization.' });
    return;
  }
  if (!isEmail(email)) {
    res.status(400).json({ error: 'Please provide a valid work email address.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }
  if (!ROLES.includes(role)) {
    res.status(400).json({ error: 'Please choose a valid workspace role.' });
    return;
  }
  if (db.users.some((u) => u.email === email)) {
    res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    return;
  }

  const user = {
    id: nextId('user', (n) => `ACC-${String(n).padStart(3, '0')}`),
    name,
    email,
    role,
    organization,
    primaryPathway: primaryPathway || undefined,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  save();

  const token = createSession(user.id);
  res.status(201).json({ token, user: publicUser(user) });
});

authRouter.post('/login', (req, res) => {
  const email = str(req.body?.email).toLowerCase();
  const password = str(req.body?.password);
  const user = db.users.find((u) => u.email === email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: 'Incorrect email or password.' });
    return;
  }

  const token = createSession(user.id);
  res.json({ token, user: publicUser(user) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

authRouter.post('/logout', requireAuth, (req, res) => {
  destroySession(req.sessionToken!);
  res.status(204).end();
});
