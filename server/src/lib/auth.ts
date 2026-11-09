import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db/pool.js';
import { forbidden, unauthorized } from './errors.js';

export type Role = 'patient' | 'pharmacy' | 'hospital' | 'specialist' | 'admin';

export interface AuthUser {
  id: string;
  role: Role;
  name: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: { id: string; role: Role }): string {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtTtl as jwt.SignOptions['expiresIn'],
  });
}

export async function userFromToken(token: string): Promise<AuthUser | null> {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    const user = await one<AuthUser & { suspended: boolean }>(
      'SELECT id, role, name, suspended FROM users WHERE id = $1',
      [payload.sub],
    );
    if (!user || user.suspended) return null;
    return { id: user.id, role: user.role, name: user.name };
  } catch {
    return null;
  }
}

/** Attaches req.user when a valid bearer token is present; guests pass through (US-01). */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    req.user = (await userFromToken(header.slice(7))) ?? undefined;
  }
  next();
}

export function requireAuth(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (roles.length && !roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}
