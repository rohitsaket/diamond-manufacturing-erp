import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthPayload {
  userId: number;
  email: string;
  role: string;
  name: string;
  /** Set only for self-service logins; links the account to an employee record. */
  employeeId?: number | null;
}

/** Every role that works on company-wide data (i.e. everyone except self-service workers). */
export const STAFF_ROLES = ['admin', 'manager', 'operator', 'accountant', 'hr'] as const;

/** Roles allowed to approve leave, lock payroll and change master data. */
export const APPROVER_ROLES = ['admin', 'manager', 'hr'] as const;

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwt.secret) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Same check as `authenticate`, but also accepts the token as a `token` query
 * parameter.
 *
 * This exists solely for the server-sent events stream: the browser's
 * EventSource cannot set an Authorization header, so there is no other way to
 * authenticate it. It is deliberately a separate middleware rather than a
 * relaxation of `authenticate` -- a token in a query string can end up in
 * access logs and referrers, so only the one endpoint that has no alternative
 * opts into it.
 */
export function authenticateStream(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    req.user = jwt.verify(token, env.jwt.secret) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Blocks self-service ('employee') logins from company-wide endpoints.
 * Staff roles are unaffected, so existing behaviour is unchanged.
 */
export function requireStaff(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !STAFF_ROLES.includes(req.user.role as (typeof STAFF_ROLES)[number])) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }
  next();
}

/** Requires a self-service login that is linked to an employee record. */
export function requireEmployeeSelf(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.employeeId) {
    res.status(403).json({ error: 'This account is not linked to an employee record' });
    return;
  }
  next();
}

/**
 * Allows staff through, and allows a self-service user only when the requested
 * employee id is their own. Reads the id from `req.params[param]`.
 */
export function allowSelfOrStaff(param = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (STAFF_ROLES.includes(req.user.role as (typeof STAFF_ROLES)[number])) {
      next();
      return;
    }
    const requested = parseInt(String(req.params[param]), 10);
    if (req.user.employeeId && requested === req.user.employeeId) {
      next();
      return;
    }
    res.status(403).json({ error: 'You can only access your own records' });
  };
}

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn } as any);
}
