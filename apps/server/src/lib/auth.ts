import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db";
import { multiUser, secureCookie, sessionDays } from "../config";
import { runAs } from "./ctx";
import { err } from "./resp";

export const SESSION_COOKIE = "vw_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
}

interface UserRow extends AuthUser {
  passwordHash: string;
  status: string;
}

const SESSION_MS = sessionDays * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 密码
// ---------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash || hash === "!") return false;
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}

export function createSession(userId: string, ua?: string | null, ip?: string | null): { token: string; expiresAt: number } {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + SESSION_MS;
  db.run("INSERT INTO sessions (id, userId, createdAt, expiresAt, ua, ip) VALUES (?, ?, ?, ?, ?, ?)", [
    token,
    userId,
    now,
    expiresAt,
    ua?.slice(0, 300) ?? null,
    ip ?? null,
  ]);
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  db.run("DELETE FROM sessions WHERE id = ?", [token]);
}

export function destroyUserSessions(userId: string): void {
  db.run("DELETE FROM sessions WHERE userId = ?", [userId]);
}

export function purgeExpiredSessions(): void {
  db.run("DELETE FROM sessions WHERE expiresAt < ?", [Date.now()]);
}

function userByToken(token: string | undefined): AuthUser | null {
  if (!token) return null;
  const row = db
    .query(
      `SELECT u.id, u.email, u.name, u.role, u.status, s.expiresAt
         FROM sessions s JOIN users u ON u.id = s.userId
        WHERE s.id = ?`,
    )
    .get(token) as (AuthUser & { status: string; expiresAt: number }) | null;
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    destroySession(token);
    return null;
  }
  if (row.status !== "active") return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function currentUser(c: Context): AuthUser | null {
  return userByToken(getCookie(c, SESSION_COOKIE));
}

export function setSessionCookie(c: Context, token: string, expiresAt: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookie,
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

// ---------------------------------------------------------------------------
// 本机管理员：单机模式下的隐式身份，不需要登录
// ---------------------------------------------------------------------------

const LOCAL_ADMIN_ID = "local-admin";

export function ensureLocalAdmin(): AuthUser {
  const row = db.query("SELECT id, email, name, role FROM users WHERE id = ?").get(LOCAL_ADMIN_ID) as AuthUser | null;
  if (row) return row;
  db.run("INSERT INTO users (id, email, name, passwordHash, role, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    LOCAL_ADMIN_ID,
    "local@localhost",
    "本机管理员",
    "!",
    "admin",
    "active",
    Date.now(),
  ]);
  return { id: LOCAL_ADMIN_ID, email: "local@localhost", name: "本机管理员", role: "admin" };
}

/**
 * 把没有归属的历史数据收给指定用户。
 * 只在"第一次有主人"时跑：单机升级，或多人部署里第一个注册者。
 */
export function adoptOrphans(ownerId: string): number {
  const tables = ["projects", "model_endpoints", "series", "analysis_reports"];
  let moved = 0;
  for (const t of tables) {
    const r = db.run(`UPDATE ${t} SET ownerId = ? WHERE ownerId IS NULL`, [ownerId]);
    moved += r.changes ?? 0;
  }
  if (moved > 0) db.run("UPDATE model_usage SET userId = ? WHERE userId IS NULL", [ownerId]);
  return moved;
}

export function hasAnyRealUser(): boolean {
  const row = db.query("SELECT COUNT(*) AS n FROM users WHERE id <> ?").get(LOCAL_ADMIN_ID) as { n: number };
  return row.n > 0;
}

// ---------------------------------------------------------------------------
// 一次性令牌：重置密码 / 验证邮箱
// ---------------------------------------------------------------------------

export type TokenKind = "reset" | "verify";

function sha256(s: string): string {
  return new Bun.CryptoHasher("sha256").update(s).digest("hex");
}

/** 发一个新令牌，返回原文（只在这一个时刻能看到）。旧令牌自动作废。 */
export function createAuthToken(userId: string, kind: TokenKind, ttlMs: number): string {
  const raw = randomToken();
  const now = Date.now();
  db.run("UPDATE auth_tokens SET usedAt = ? WHERE userId = ? AND kind = ? AND usedAt IS NULL", [now, userId, kind]);
  db.run("INSERT INTO auth_tokens (id, userId, kind, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)", [
    sha256(raw),
    userId,
    kind,
    now,
    now + ttlMs,
  ]);
  return raw;
}

/** 校验并消费令牌。返回 userId；无效/过期/用过都返回 null。 */
export function consumeAuthToken(raw: string, kind: TokenKind): string | null {
  if (!raw) return null;
  const id = sha256(raw);
  const row = db
    .query("SELECT userId, expiresAt, usedAt FROM auth_tokens WHERE id = ? AND kind = ?")
    .get(id, kind) as { userId: string; expiresAt: number; usedAt: number | null } | null;
  if (!row || row.usedAt || row.expiresAt < Date.now()) return null;
  db.run("UPDATE auth_tokens SET usedAt = ? WHERE id = ?", [Date.now(), id]);
  return row.userId;
}

/** 只查不消费：页面加载时判断链接还能不能用 */
export function peekAuthToken(raw: string, kind: TokenKind): boolean {
  if (!raw) return false;
  const row = db
    .query("SELECT expiresAt, usedAt FROM auth_tokens WHERE id = ? AND kind = ?")
    .get(sha256(raw), kind) as { expiresAt: number; usedAt: number | null } | null;
  return Boolean(row && !row.usedAt && row.expiresAt >= Date.now());
}

export function purgeExpiredTokens(): void {
  db.run("DELETE FROM auth_tokens WHERE expiresAt < ?", [Date.now() - 24 * 60 * 60 * 1000]);
}

// ---------------------------------------------------------------------------
// 中间件
// ---------------------------------------------------------------------------

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

/**
 * 解析当前用户。
 * 单机模式：永远视为本机管理员，忽略 cookie。
 * 多人模式：无有效会话直接 401。
 */
export const attachUser: MiddlewareHandler = async (c, next) => {
  if (!multiUser) {
    const local = ensureLocalAdmin();
    c.set("user", local);
    return runAs(local.id, () => next());
  }
  const user = currentUser(c);
  if (user) c.set("user", user);
  return runAs(user?.id, () => next());
};

const PUBLIC_API = ["/api/auth", "/api/health"];

export const requireUser: MiddlewareHandler = async (c, next) => {
  const p = c.req.path;
  if (PUBLIC_API.some((x) => p === x || p.startsWith(`${x}/`))) return next();
  if (!c.get("user")) return err(c, "请先登录", 401);
  return next();
};

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const user = c.get("user");
  if (!user) return err(c, "请先登录", 401);
  if (user.role !== "admin") return err(c, "需要管理员权限", 403);
  return next();
};

/** 取得当前用户；理论上 requireUser 之后一定存在 */
export function actor(c: Context): AuthUser {
  return c.get("user");
}

// ---------------------------------------------------------------------------
// 归属判定
// ---------------------------------------------------------------------------

export function ownsProject(userId: string, projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  const row = db.query("SELECT ownerId FROM projects WHERE id = ?").get(projectId) as { ownerId: string | null } | null;
  return Boolean(row && row.ownerId === userId);
}

export function ownsAsset(userId: string, assetId: string | null | undefined): boolean {
  if (!assetId) return false;
  const row = db.query("SELECT projectId, ownerId FROM assets WHERE id = ?").get(assetId) as
    | { projectId: string | null; ownerId: string | null }
    | null;
  if (!row) return false;
  // 挂项目的素材随项目归属；素材库里独立导入的素材看自己的 ownerId
  if (row.projectId) return ownsProject(userId, row.projectId);
  return row.ownerId === userId;
}

export function ownsEndpoint(userId: string, endpointId: string | null | undefined): boolean {
  if (!endpointId) return false;
  const row = db.query("SELECT ownerId FROM model_endpoints WHERE id = ?").get(endpointId) as
    | { ownerId: string | null }
    | null;
  return Boolean(row && row.ownerId === userId);
}

export function ownsSeries(userId: string, seriesId: string | null | undefined): boolean {
  if (!seriesId) return false;
  const row = db.query("SELECT ownerId FROM series WHERE id = ?").get(seriesId) as { ownerId: string | null } | null;
  return Boolean(row && row.ownerId === userId);
}
