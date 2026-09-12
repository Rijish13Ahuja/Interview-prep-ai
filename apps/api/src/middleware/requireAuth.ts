import type { NextFunction, Request, Response } from "express";

/** Sensible handling of a missing/expired session: a structured 401, never a silent pass-through. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } });
    return;
  }
  next();
}
