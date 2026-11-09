import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Sign in required') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have access to this') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

/** Parses input with a zod schema, turning failures into a 400 with per-field messages. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      'Invalid input',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.issues });
    return;
  }
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '23505') {
    res.status(409).json({ error: 'That record already exists' });
    return;
  }
  if (pgCode === '22P02') {
    // Malformed id in the URL, e.g. /orders/not-a-uuid.
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (pgCode === '23503') {
    res.status(409).json({ error: 'That record is still in use' });
    return;
  }
  if (pgCode === '23514') {
    res.status(409).json({ error: 'That change would make stock or capacity invalid' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}
