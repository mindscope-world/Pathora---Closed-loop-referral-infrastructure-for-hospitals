import { Router } from 'express';
import { db, nextId, save } from '../db.ts';
import { isEmail, str } from '../util.ts';

export const discoveryRouter = Router();

discoveryRouter.post('/', (req, res) => {
  const name = str(req.body?.name);
  const organization = str(req.body?.organization);
  const email = str(req.body?.email);
  const pathway = str(req.body?.pathway);

  if (!name || !organization) {
    res.status(400).json({ error: 'Please enter your name and organization.' });
    return;
  }
  if (!isEmail(email)) {
    res.status(400).json({ error: 'Please provide a valid work email address.' });
    return;
  }

  const request = {
    id: nextId('discovery', (n) => `DISC-${String(n).padStart(4, '0')}`),
    name,
    organization,
    email,
    pathway: pathway || 'Cancer Screening',
    createdAt: new Date().toISOString(),
  };
  db.discoveryRequests.push(request);
  save();

  res.status(201).json({ request });
});
