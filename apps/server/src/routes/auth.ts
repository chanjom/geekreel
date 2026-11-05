import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { db } from "../db";
import { allowRegister, multiUser, publicUrl, registerCode, requireVerify, sessionDays, siteName, siteTagline, version } from "../config";
import { err, ok } from "../lib/resp";
import {
  SESSION_COOKIE,
  adoptOrphans,
  clearSessionCookie,
  consumeAuthToken,
  createAuthToken,
  createSession,
  currentUser,
  destroySession,
  destroyUserSessions,
  ensureLocalAdmin,
  hashPassword,
  hasAnyRealUser,
  peekAuthToken,
  setSessionCookie,
  verifyPassword,
  type AuthUser,
} from "../lib/auth";
import { mailConfigured, resetMail, sendMail, verifyMail } from "../lib/mail";

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
const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

const WEAK = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password1",
  "passw0rd",
  "qwertyui",
  "abc12345",
  "admin123",
  "iloveyou",
  "11111111",
  "88888888",
]);

/** 返回错误文案；null 表示通过。前后端共用同一套规则，避免前端放过、后端拒收。 */
export function checkPassword(password: string): string | null {
  if (password.length < 8) return "密码至少 8 位";
  if (password.length > 200) return "密码太长（最多 200 位）";
  if (WEAK.has(password.toLowerCase())) return "这个密码太常见了，换一个";
  if (new Set(password).size === 1) return "别用同一个字符当密码";
  return null;
}

function publicUser(u: AuthUser) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** 邮件里的链接要用绝对地址：优先 VW_PUBLIC_URL，其次按反代请求头推 */
function baseUrl(c: { req: { header: (k: string) => string | undefined } }): string {
  if (publicUrl) return publicUrl;
  const proto = c.req.header("x-forwarded-proto") ?? (c.req.header("x-forwarded-ssl") === "on" ? "https" : "http");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? `127.0.0.1:4780`;
  return `${proto}://${host}`;
}

/** 前端启动时读一次，决定要不要显示登录页、注册入口、忘记密码入口 */
authRoutes.get("/config", (c) => {
  const anyUser = hasAnyRealUser();
  const mail = mailConfigured();
  return ok(c, {
    siteName,
    siteTagline,
    version,
    multiUser,
    allowRegister: allowRegister || !anyUser,
    needsFirstAdmin: multiUser && !anyUser,
    requireCode: Boolean(registerCode),
    sessionDays,
    // 没配 SMTP 就不强推邮箱验证，否则注册完直接卡死
    requireVerify: requireVerify && mail,
    mailConfigured: mail,
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
    acceptTerms?: boolean;
  };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 40);
  const code = String(body.code ?? "").trim();

  if (!body.acceptTerms) return err(c, "请先同意服务条款和隐私说明", 400, "terms");
  if (!EMAIL_RE.test(email)) return err(c, "邮箱格式不对");
  const pwErr = checkPassword(password);
  if (pwErr) return err(c, pwErr);
  if (registerCode && code !== registerCode) return err(c, "邀请码不对", 403, "code");

  const dup = db.query("SELECT id FROM users WHERE lower(email) = ?").get(email) as { id: string } | null;
  if (dup) return err(c, "这个邮箱已经注册过了，直接登录或找回密码", 409, "exists");

  const id = crypto.randomUUID();
  const role = firstEver ? "admin" : "user";
  const needVerify = requireVerify && mailConfigured() && !firstEver;
  db.run(
    "INSERT INTO users (id, email, name, passwordHash, role, status, createdAt, emailVerified) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
    [id, email, name || email.split("@")[0]!, await hashPassword(password), role, Date.now(), needVerify ? 0 : 1],
  );

  // 第一个用户接管本机已有数据（单机升级或首次部署）
  if (firstEver) {
    ensureLocalAdmin();
    adoptOrphans(id);
  }

  const display = name || email.split("@")[0]!;

  if (needVerify) {
    const raw = createAuthToken(id, "verify", VERIFY_TTL_MS);
    const link = `${baseUrl(c)}/verify?token=${encodeURIComponent(raw)}`;
    const mail = verifyMail(link, 24);
    const r = await sendMail({ to: email, ...mail });
    return ok(c, {
      user: null,
      needVerify: true,
      via: r.via,
      message: r.via === "smtp" ? "验证邮件已发出，去邮箱点一下就能登录" : "邮件没发出去，请联系站主要验证链接",
    });
  }

  const { token, expiresAt } = createSession(id, c.req.header("user-agent"), ip);
  setSessionCookie(c, token, expiresAt);
  return ok(c, { user: { id, email, name: display, role } });
});

authRoutes.post("/login", async (c) => {
  const ip = clientIp(c);
  if (!hit(`login:${ip}`, 12, 15 * 60 * 1000)) return err(c, "尝试次数过多，15 分钟后再试", 429);

  const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) return err(c, "邮箱和密码都要填");

  const row = db
    .query("SELECT id, email, name, role, status, passwordHash, emailVerified FROM users WHERE lower(email) = ?")
    .get(email) as (AuthUser & { status: string; passwordHash: string; emailVerified: number }) | null;
  if (!row) return err(c, "邮箱或密码不对", 401);
  if (!(await verifyPassword(password, row.passwordHash))) return err(c, "邮箱或密码不对", 401);
  if (row.status !== "active") return err(c, "这个账号已被停用，联系站主", 403, "disabled");
  if (requireVerify && mailConfigured() && !row.emailVerified) {
    return err(c, "邮箱还没验证，先去邮箱点验证链接", 403, "unverified");
  }

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

// ---------------------------------------------------------------------------
// 忘记密码
// ---------------------------------------------------------------------------

authRoutes.post("/forgot", async (c) => {
  const ip = clientIp(c);
  if (!hit(`forgot:${ip}`, 5, 60 * 60 * 1000)) return err(c, "申请太频繁，过一小时再试", 429);

  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return err(c, "邮箱格式不对");

  const row = db.query("SELECT id, email FROM users WHERE lower(email) = ? AND id <> 'local-admin'").get(email) as
    | { id: string; email: string }
    | null;

  // 不论账号存不存在都返回同样的结果，避免被拿来探测谁注册过
  if (!row) {
    return ok(c, { ok: true, via: mailConfigured() ? "smtp" : "outbox" });
  }

  const raw = createAuthToken(row.id, "reset", RESET_TTL_MS);
  const link = `${baseUrl(c)}/reset?token=${encodeURIComponent(raw)}`;
  const mail = resetMail(link, 60);
  const r = await sendMail({ to: row.email, ...mail });
  if (r.via === "outbox") {
    // 没有 SMTP 时，链接只留在服务器日志和 outbox 里，绝不从接口回传（否则等于谁都能改别人密码）
    console.log(`[vw] 重置密码链接（${row.email}）：${link}`);
  }
  return ok(c, { ok: true, via: r.via, note: r.note });
});

authRoutes.get("/reset/check", (c) => {
  const token = c.req.query("token") ?? "";
  return ok(c, { valid: peekAuthToken(token, "reset") });
});

authRoutes.post("/reset", async (c) => {
  const ip = clientIp(c);
  if (!hit(`reset:${ip}`, 10, 60 * 60 * 1000)) return err(c, "操作太频繁，过一小时再试", 429);

  const body = (await c.req.json().catch(() => ({}))) as { token?: string; password?: string };
  const token = String(body.token ?? "");
  const password = String(body.password ?? "");
  const pwErr = checkPassword(password);
  if (pwErr) return err(c, pwErr);

  const userId = consumeAuthToken(token, "reset");
  if (!userId) return err(c, "链接已失效，重新申请一次", 400, "expired");

  db.run("UPDATE users SET passwordHash = ?, emailVerified = 1 WHERE id = ?", [await hashPassword(password), userId]);
  // 改密码后踢掉所有旧会话：别的设备上的登录态立刻失效
  destroyUserSessions(userId);
  return ok(c, { ok: true });
});

// ---------------------------------------------------------------------------
// 邮箱验证
// ---------------------------------------------------------------------------

authRoutes.get("/verify/check", (c) => {
  const token = c.req.query("token") ?? "";
  return ok(c, { valid: peekAuthToken(token, "verify") });
});

authRoutes.post("/verify", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const userId = consumeAuthToken(String(body.token ?? ""), "verify");
  if (!userId) return err(c, "链接已失效，登录后重新发一封", 400, "expired");
  db.run("UPDATE users SET emailVerified = 1 WHERE id = ?", [userId]);
  return ok(c, { ok: true });
});

/** 登录状态下重发验证邮件 */
authRoutes.post("/verify/send", async (c) => {
  const user = currentUser(c);
  if (!user) return err(c, "请先登录", 401);
  if (!mailConfigured()) return err(c, "站主还没配发信服务，找站主要验证链接", 400, "nomail");
  const raw = createAuthToken(user.id, "verify", VERIFY_TTL_MS);
  const link = `${baseUrl(c)}/verify?token=${encodeURIComponent(raw)}`;
  const mail = verifyMail(link, 24);
  const r = await sendMail({ to: user.email, ...mail });
  if (r.via !== "smtp") return err(c, "邮件没发出去，找站主要链接", 502, "sendfail");
  return ok(c, { ok: true });
});

// ---------------------------------------------------------------------------
// 已登录：改密码 / 改资料
// ---------------------------------------------------------------------------

authRoutes.post("/password", async (c) => {
  const user = currentUser(c);
  if (!user) return err(c, "请先登录", 401);
  const body = (await c.req.json().catch(() => ({}))) as { old?: string; next?: string };
  const row = db.query("SELECT passwordHash FROM users WHERE id = ?").get(user.id) as { passwordHash: string } | null;
  if (!row) return err(c, "账号不存在", 404);
  if (!(await verifyPassword(String(body.old ?? ""), row.passwordHash))) return err(c, "原密码不对", 401);
  const next = String(body.next ?? "");
  const pwErr = checkPassword(next);
  if (pwErr) return err(c, pwErr);
  db.run("UPDATE users SET passwordHash = ? WHERE id = ?", [await hashPassword(next), user.id]);
  return ok(c, { ok: true });
});

authRoutes.post("/profile", async (c) => {
  const user = currentUser(c);
  if (!user) return err(c, "请先登录", 401);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = String(body.name ?? "").trim().slice(0, 40);
  if (!name) return err(c, "昵称不能为空");
  db.run("UPDATE users SET name = ? WHERE id = ?", [name, user.id]);
  return ok(c, { user: { ...publicUser(user), name } });
});
