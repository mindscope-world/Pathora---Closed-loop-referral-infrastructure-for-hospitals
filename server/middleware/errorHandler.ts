import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '../../shared/types';
import { isProd } from '../config/env';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.id },
  };
  res.status(404).json(body);
};

// Express identifies error middleware by its 4-argument arity; `_next` must stay.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong';
  let details: unknown;

  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err?.code === 'P2002' || err?.code === 'P2034') {
    // Unique violation / write conflict from a concurrent request that slipped past our pre-checks.
    status = 409;
    code = 'CONFLICT';
    message = 'This conflicted with another change made at the same time. Please retry.';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body too large';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON body';
  } else if (err?.message === 'CORS_ORIGIN_DENIED') {
    status = 403;
    code = 'CORS_DENIED';
    message = 'Origin not allowed';
  }

  if (status >= 500) {
    logger.error({ err, requestId: req.id }, 'Unhandled error');
    if (isProd) message = 'Something went wrong';
  }

  const body: ApiErrorBody = { error: { code, message, requestId: req.id, ...(details ? { details } : {}) } };
  res.status(status).json(body);
};
