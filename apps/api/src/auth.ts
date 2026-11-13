import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config";
import { prisma } from "@jobinfo/database";

export type SessionUser = { id: string; role: string; sessionVersion?: number };
const COOKIE = "ji_session";

export function setSession(res: Response, user: SessionUser) {
  const token = jwt.sign({ ...user, sessionVersion: user.sessionVersion ?? 0 }, config.jwtSecret, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: 7 * 24 * 3600 * 1000,
    path: "/",
  });
}
export const clearSession = (res: Response) => res.clearCookie(COOKIE, { path: "/" });

export function readSession(req: Request): SessionUser | null {
  const t = req.cookies?.[COOKIE];
  if (!t) return null;
  try {
    const p = jwt.verify(t, config.jwtSecret) as SessionUser;
    return { id: p.id, role: p.role, sessionVersion: Number(p.sessionVersion || 0) };
  } catch {
    return null;
  }
}

export function signPasswordResetToken(user: { id: string; sessionVersion: number }) {
  return jwt.sign({ sub: user.id, purpose: "password-reset", sessionVersion: user.sessionVersion }, config.jwtSecret, { expiresIn: "30m" });
}

export function readPasswordResetToken(token: string): { id: string; sessionVersion: number } | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload & { purpose?: string; sessionVersion?: number };
    if (payload.purpose !== "password-reset" || typeof payload.sub !== "string" || typeof payload.sessionVersion !== "number" || !Number.isInteger(payload.sessionVersion)) return null;
    return { id: payload.sub, sessionVersion: payload.sessionVersion };
  } catch {
    return null;
  }
}

export function requireAuth(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const u = readSession(req);
    if (!u) return res.status(401).json({ error: "Not signed in" });
    const current = await prisma.user.findUnique({ where: { id: u.id }, select: { role: true, isActive: true, deletedAt:true, sessionVersion: true, lastActiveAt: true } });
    if (!current?.isActive || current.deletedAt || current.sessionVersion !== u.sessionVersion) return res.status(401).json({ error: "Session expired. Sign in again." });
    if (current.role !== u.role || (roles.length && !roles.includes(current.role))) return res.status(403).json({ error: "Forbidden" });
    if (current.role === "CANDIDATE" && (!current.lastActiveAt || Date.now() - current.lastActiveAt.getTime() > 15 * 60_000)) void prisma.user.update({ where: { id: u.id }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
    (req as Request & { user: SessionUser }).user = u;
    next();
  };
}
export const userOf = (req: Request) => (req as Request & { user: SessionUser }).user;
