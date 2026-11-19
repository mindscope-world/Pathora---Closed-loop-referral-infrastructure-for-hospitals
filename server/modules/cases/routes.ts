import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { HttpError } from '../../lib/errors';
import { authenticate, requirePermission } from '../../middleware/auth';
import { idempotent } from '../../middleware/idempotency';
import { validateBody } from '../../middleware/validate';
import { can, type Permission } from '../auth/permissions';
import { importCases } from './csvImport';
import { listQuerySchema } from './queries';
import * as schemas from './schemas';
import * as svc from './service';

/** Case id from the URL; anything that is not a REF-YYYY-NNNN id is simply "not found". */
function refOf(req: Request): string {
  const parsed = schemas.refParam.safeParse(req.params.id);
  if (!parsed.success) throw HttpError.notFound('Referral not found');
  return parsed.data;
}

function requireAny(...permissions: Permission[]) {
  return (req: Request, _res: unknown, next: (e?: unknown) => void) => {
    if (!req.auth) return next(HttpError.unauthorized());
    next(permissions.some((p) => can(req.auth!.role, p)) ? undefined : HttpError.forbidden());
  };
}

export function casesRouter(): Router {
  const r = Router();
  r.use(authenticate);
  const noStore = (_req: Request, res: { setHeader(n: string, v: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store'); // patient data must never be cached by browsers or proxies
    next();
  };
  r.use(noStore);

  // ── collection ──
  r.get('/', requirePermission('cases.read'), asyncHandler(async (req, res) => {
    res.json(await svc.listCases(req.auth!, listQuerySchema.parse(req.query)));
  }));

  r.post('/', requirePermission('cases.create'), validateBody(schemas.createCaseSchema), idempotent,
    asyncHandler(async (req, res) => {
      res.status(201).json(await svc.createCase(req.auth!, req.body));
    }));

  // (Body limit for this route is raised in app.ts, ahead of the global JSON parser.)
  r.post('/import', requirePermission('cases.import'), validateBody(schemas.importSchema), idempotent,
    asyncHandler(async (req, res) => {
      const result = await importCases(req.auth!, req.body);
      res.status(result.dryRun ? 200 : 201).json(result);
    }));

  r.get('/assignees', requireAny('cases.create', 'cases.reassign'), asyncHandler(async (req, res) => {
    res.json({ assignees: await svc.listAssignees(req.auth!) });
  }));

  // ── one case ──
  r.get('/:id', requirePermission('cases.read'), asyncHandler(async (req, res) => {
    res.json(await svc.getCaseDetail(req.auth!, refOf(req)));
  }));

  r.post('/:id/acknowledge', requirePermission('cases.acknowledge'), validateBody(schemas.ackSchema),
    asyncHandler(async (req, res) => res.json(await svc.acknowledgeCase(req.auth!, refOf(req), req.body.expectedVersion))));

  r.post('/:id/attendance', requirePermission('cases.attend'), validateBody(schemas.attendSchema),
    asyncHandler(async (req, res) => res.json(await svc.confirmAttendance(req.auth!, refOf(req), req.body.expectedVersion))));

  r.post('/:id/close', requirePermission('cases.close'), validateBody(schemas.closeSchema),
    asyncHandler(async (req, res) => res.json(await svc.closeCase(req.auth!, refOf(req), req.body, req.body.expectedVersion))));

  r.post('/:id/escalate', requirePermission('cases.escalate'), validateBody(schemas.escalateSchema),
    asyncHandler(async (req, res) => res.json(await svc.escalateCase(req.auth!, refOf(req), req.body, req.body.expectedVersion))));

  r.post('/:id/barrier-resolution', requirePermission('cases.barrier'), validateBody(schemas.barrierSchema),
    asyncHandler(async (req, res) => res.json(await svc.resolveBarrier(req.auth!, refOf(req), req.body, req.body.expectedVersion))));

  r.post('/:id/reassign', requirePermission('cases.reassign'), validateBody(schemas.reassignSchema),
    asyncHandler(async (req, res) => res.json(await svc.reassignCase(req.auth!, refOf(req), req.body, req.body.expectedVersion))));

  r.put('/:id/opt-out', requirePermission('consent.manage'), validateBody(schemas.optOutSchema),
    asyncHandler(async (req, res) => res.json(await svc.setOptOut(req.auth!, refOf(req), req.body.optedOut))));

  return r;
}

export function searchRouter(): Router {
  const r = Router();
  r.get('/', authenticate, requirePermission('cases.read'), asyncHandler(async (req, res) => {
    const q = listQuerySchema.shape.q.unwrap().parse(typeof req.query.q === 'string' ? req.query.q : '');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ results: await svc.searchCases(req.auth!, q) });
  }));
  return r;
}
