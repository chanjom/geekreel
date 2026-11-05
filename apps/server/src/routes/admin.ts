/**
 * 管理员接口：建号、停用、改角色、发重置链接、看总量。
 * 只挂 requireAdmin，且严格校验「别把最后一个管理员弄没」。
 */
import { Hono } from "hono";
import { db } from "../db";
import { err, ok } from "../lib/resp";
import {
  actor,
  createAuthToken,
  destroyUserSessions,
  hashPassword,
  requireAdmin,
  type AuthUser,
} from "../lib/auth";
import { mailConfigured, resetMail, sendMail } from "../lib/mail";
import { publicUrl, siteName, version } from "../config";
import { checkPassword } from "./auth";

export const adminRoutes = new Hono();

adminRoutes.use("/*", requireAdmin);

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  createdAt: number;
  lastLoginAt: number | null;
  emailVerified: number;
}

function count(sql: string, ...params: (string | number)[]): number {
  const row = db.query(sql).get(...params) as { n: number } | null;
  return row?.n ?? 0;
}

function adminCount(): number {
  return count("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id <> 'local-admin'");
}

adminRoutes.get("/overview", (c) => {
  return ok(c, {
    version,
    siteName,
    mailConfigured: mailConfigured(),
    users: count("SELECT COUNT(*) AS n FROM users WHERE id <> 'local-admin'"),
    activeUsers: count("SELECT COUNT(*) AS n FROM users WHERE id <> 'local-admin' AND status = 'active'"),
    projects: count("SELECT COUNT(*) AS n FROM projects"),
    jobs: count("SELECT COUNT(*) AS n FROM jobs"),
    jobsRunning: count("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')"),
    assets: count("SELECT COUNT(*) AS n FROM assets"),
    endpoints: count("SELECT COUNT(*) AS n FROM model_endpoints"),
  });
});

adminRoutes.get("/users", (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const rows = (
    q
      ? db
          .query(
            `SELECT id, email, name, role, status, createdAt, lastLoginAt, emailVerified
               FROM users WHERE id <> 'local-admin' AND (lower(email) LIKE ? OR lower(name) LIKE ?)
              ORDER BY createdAt DESC LIMIT 200`,
          )
          .all(`%${q}%`, `%${q}%`)
      : db
          .query(
            `SELECT id, email, name, role, status, createdAt, lastLoginAt, emailVerified
               FROM users WHERE id <> 'local-admin' ORDER BY createdAt DESC LIMIT 200`,
          )
          .all()
  ) as UserRow[];

  return ok(c, {
    users: rows.map((u) => ({
      ...u,
      emailVerified: Boolean(u.emailVerified),
      projects: count("SELECT COUNT(*) AS n FROM projects WHERE ownerId = ?", u.id),
    })),
  });
});

adminRoutes.post("/users", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
    role?: string;
  };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 40);
  const role = body.role === "admin" ? "admin" : "user";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err(c, "邮箱格式不对");
  const pwErr = checkPassword(password);
  if (pwErr) return err(c, pwErr);
  const dup = db.query("SELECT id FROM users WHERE lower(email) = ?").get(email);
  if (dup) return err(c, "这个邮箱已经存在", 409);

  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO users (id, email, name, passwordHash, role, status, createdAt, emailVerified) VALUES (?, ?, ?, ?, ?, 'active', ?, 1)",
    [id, email, name || email.split("@")[0]!, await hashPassword(password), role, Date.now()],
  );
  return ok(c, { id });
});

adminRoutes.patch("/users/:id", async (c) => {
  const me = actor(c);
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; role?: string; status?: string };

  const row = db.query("SELECT id, email, name, role, status FROM users WHERE id = ?").get(id) as
    | { id: string; email: string; name: string; role: string; status: string }
    | null;
  if (!row) return err(c, "账号不存在", 404);
  if (id === "local-admin") return err(c, "系统账号不能改", 403);

  const nextRole = body.role === "admin" ? "admin" : body.role === "user" ? "user" : row.role;
  const nextStatus = body.status === "active" || body.status === "disabled" ? body.status : row.status;

  // 自锁保护：不能把自己降级或停用，也不能让站里一个管理员都不剩
  if (id === me.id && (nextRole !== "admin" || nextStatus !== "active")) {
    return err(c, "不能停用或降级自己的账号", 403);
  }
  if (row.role === "admin" && row.status === "active" && (nextRole !== "admin" || nextStatus !== "active")) {
    if (adminCount() <= 1) return err(c, "站里至少要留一个管理员", 409);
  }

  db.run("UPDATE users SET name = ?, role = ?, status = ? WHERE id = ?", [
    body.name !== undefined ? String(body.name).trim().slice(0, 40) || row.name : row.name,
    nextRole,
    nextStatus,
    id,
  ]);
  if (nextStatus === "disabled") destroyUserSessions(id);
  return ok(c, { ok: true });
});

adminRoutes.delete("/users/:id", (c) => {
  const me = actor(c);
  const id = c.req.param("id");
  if (id === me.id) return err(c, "不能删自己", 403);
  const row = db.query("SELECT role, status FROM users WHERE id = ?").get(id) as
    | { role: string; status: string }
    | null;
  if (!row) return err(c, "账号不存在", 404);
  if (row.role === "admin" && row.status === "active" && adminCount() <= 1) {
    return err(c, "站里至少要留一个管理员", 409);
  }
  const projects = count("SELECT COUNT(*) AS n FROM projects WHERE ownerId = ?", id);
  if (projects > 0) return err(c, `这个账号还有 ${projects} 个项目，先让他自己删或转交，避免误删素材`, 409);
  db.run("DELETE FROM sessions WHERE userId = ?", [id]);
  db.run("DELETE FROM model_endpoints WHERE ownerId = ?", [id]);
  db.run("DELETE FROM users WHERE id = ?", [id]);
  return ok(c, { ok: true });
});

/** 管理员代发重置链接：站里没配 SMTP 时，这是唯一能救回账号的路 */
adminRoutes.post("/users/:id/reset-link", async (c) => {
  const id = c.req.param("id");
  const row = db.query("SELECT id, email FROM users WHERE id = ?").get(id) as { id: string; email: string } | null;
  if (!row) return err(c, "账号不存在", 404);

  const token = createAuthToken(row.id, "reset", 60 * 60 * 1000);
  const origin = publicUrl || c.req.header("origin") || `http://${c.req.header("host") ?? "127.0.0.1:4780"}`;
  const link = `${origin.replace(/\/+$/, "")}/reset?token=${encodeURIComponent(token)}`;

  let mailed = false;
  if (mailConfigured()) {
    const mail = resetMail(link, 60);
    const r = await sendMail({ to: row.email, ...mail });
    mailed = r.via === "smtp";
  }
  // 这条链接就是管理员自己发出去的，所以可以回给管理员本人
  return ok(c, { link, mailed });
});

adminRoutes.get("/usage", (c) => {
  const rows = db
    .query(
      `SELECT u.id, u.email, u.name,
              COUNT(m.id) AS calls,
              COALESCE(SUM(m.cost), 0) AS cost
         FROM users u LEFT JOIN model_usage m ON m.userId = u.id
        WHERE u.id <> 'local-admin'
        GROUP BY u.id ORDER BY cost DESC LIMIT 50`,
    )
    .all() as { id: string; email: string; name: string; calls: number; cost: number }[];
  return ok(c, { usage: rows });
});

export type AdminUser = AuthUser;
