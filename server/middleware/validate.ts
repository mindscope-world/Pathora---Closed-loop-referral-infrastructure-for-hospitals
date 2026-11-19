import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/** Parses req.body with a zod schema and replaces it with the parsed (stripped, normalised) value. */
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    try {
      req.body = schema.parse(req.body ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };
