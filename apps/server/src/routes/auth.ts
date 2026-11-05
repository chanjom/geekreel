import { Hono } from "hono";
import { db } from "../db";
import { allowRegister, multiUser, registerCode } from "../config";
import { err, ok } from "../lib/resp";
import {
  SESSION_COOKIE,
  adoptOrphans,
  clearSessionCookie,
  createSession,
  currentUser,
  destroySession,
  ensureLocalAdmin,
  hashPassword,
  hasAnyRealUser,
  setSessionCookie,
  verifyPassword,
  type AuthUser,
} from "../lib/auth";
import { getCookie } from "hono/cookie";

export const authRoutes = new Hono();

// ---------------------------------------------------------------------------
// 简易限流：单进程内存计数，按 IP + 动作。多实例部署请换成 Redis。
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "unknown";
}

function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

function sweep(): void {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}
setInterval(sweep, 60_000).unref?.();

// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function publicUser(u: AuthUser) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** 前端启动时读一次，决定要不要显示登录页、注册入口 */
authRoutes.get("/config", (c) => {
  const anyUser = hasAnyRealUser();
  return ok(c, {
    multiUser,
    allowRegister: allowRegister || !anyUser,
    needsFirstAdmin: multiUser && !anyUser,
    requireCode: Boolean(registerCode),
    sessionDays: Number(process.env.VW_SESSION_DAYS ?? 30),
  });
});

authRoutes.get("/me", (c) => {
  const user = currentUser(c);
  if (!user) return ok(c, { user: null });
  return ok(c, { user: publicUser(user) });
});

authRoutes.post("/register", async (c) => {
  // 单机模式本来就不需要账号，别让人从这开个口子
  if (!multiUser) return err(c, "单机模式不需要注册", 403);
  const ip = clientIp(c);
  if (!hit(`reg:${ip}`, 5, 60 * 60 * 1000)) return err(c, "注册太频繁，过一小时再试", 429);

  const firstEver = !hasAnyRealUser();
  if (!allowRegister && !firstEver) return err(c, "本站未开放注册", 403);

  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
    code?: string;
  };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 40);
  const code = String(body.code ?? "").trim();

  if (!EMAIL_RE.test(email)) return err(c, "邮箱格式不对");
  if (password.length < 8) return err(c, "密码至少 8 位");
  if (password.length > 200) return err(c, "密码太长");
  if (registerCode && code !== registerCode) return err(c, "邀请码不对", 403);

  const dup = db.query("SELECT id FROM users WHERE lower(email) = ?").get(email) as { id: string } | null;
  if (dup) return err(c, "这个邮箱已经注册过了");

  const id = crypto.randomUUID();
  const role = firstEver ? "admin" : "user";
  db.run("INSERT INTO users (id, email, name, passwordHash, role, status, createdAt) VALUES (?, ?, ?, ?, ?, 'active', ?)", [
    id,
    email,
    name || email.split("@")[0]!,
    await hashPassword(password),
    role,
    Date.now(),
  ]);

  // 第一个用户接管本机已有数据（单机升级或首次部署）
  if (firstEver) {
    ensureLocalAdmin();
    adoptOrphans(id);
  }

  const { token, expiresAt } = createSession(id, c.req.header("user-agent"), ip);
  setSessionCookie(c, token, expiresAt);
  return ok(c, { user: { id, email, name: name || email.split("@")[0]!, role } });
});

authRoutes.post("/login", async (c) => {
  const ip = clientIp(c);
  if (!hit(`login:${ip}`, 12, 15 * 60 * 1000)) return err(c, "尝试次数过多，15 分钟后再试", 429);

  const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) return err(c, "邮箱和密码都要填");

  const row = db
    .query("SELECT id, email, name, role, status, passwordHash FROM users WHERE lower(email) = ?")
    .get(email) as (AuthUser & { status: string; passwordHash: string }) | null;
  if (!row) return err(c, "邮箱或密码不对", 401);
  if (row.status !== "active") return err(c, "这个账号已被停用", 403);
  if (!(await verifyPassword(password, row.passwordHash))) return err(c, "邮箱或密码不对", 401);

  db.run("UPDATE users SET lastLoginAt = ? WHERE id = ?", [Date.now(), row.id]);
  const { token, expiresAt } = createSession(row.id, c.req.header("user-agent"), ip);
  setSessionCookie(c, token, expiresAt);
  return ok(c, { user: publicUser(row) });
});

authRoutes.post("/logout", (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) destroySession(token);
  clearSessionCookie(c);
  return ok(c, { ok: true });
});

authRoutes.post("/password", async (c) => {
  const user = currentUser(c);
  if (!user) return err(c, "请先登录", 401);
  const body = (await c.req.json().catch(() => ({}))) as { old?: string; next?: string };
  const row = db.query("SELECT passwordHash FROM users WHERE id = ?").get(user.id) as { passwordHash: string } | null;
  if (!row) return err(c, "账号不存在", 404);
  if (!(await verifyPassword(String(body.old ?? ""), row.passwordHash))) return err(c, "原密码不对", 401);
  const next = String(body.next ?? "");
  if (next.length < 8) return err(c, "新密码至少 8 位");
  db.run("UPDATE users SET passwordHash = ? WHERE id = ?", [await hashPassword(next), user.id]);
  return ok(c, { ok: true });
});
