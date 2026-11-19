import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { rulePackKey, updateRulePackSchema } from './rules';
import { listRulePacks, listVersions, updateRulePack } from './service';
import { runSyntheticTest } from './synthetic';

const keyOf = (raw: string) => {
  const parsed = rulePackKey.safeParse(raw);
  if (!parsed.success) throw HttpError.notFound('Rule pack not found');
  return parsed.data;
};

export function rulePacksRouter(): Router {
  const r = Router();
  r.use(authenticate);
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.get('/', requirePermission('rulepacks.read'), asyncHandler(async (req, res) => res.json(await listRulePacks(req.auth!))));

  r.get('/:key/versions', requirePermission('rulepacks.read'), asyncHandler(async (req, res) => {
    res.json({ versions: await listVersions(req.auth!, keyOf(req.params.key)) });
  }));

  r.patch('/:key', requirePermission('rulepacks.edit'), validateBody(updateRulePackSchema), asyncHandler(async (req, res) => {
    res.json(await updateRulePack(req.auth!, keyOf(req.params.key), req.body));
  }));

  r.post('/:key/synthetic-test', requirePermission('rulepacks.edit'), asyncHandler(async (req, res) => {
    res.json(await runSyntheticTest(req.auth!, keyOf(req.params.key)));
  }));

  return r;
}
