import { Hono } from "hono";
import type { JobStatus } from "@vw/core";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import { actor } from "../lib/auth";
import { db } from "../db";

export const jobsRoutes = new Hono();

/** 任务归属：自己的任务，或自己项目下的任务 */
function mine(jobId: string, userId: string) {
  const row = db.query("SELECT ownerId, projectId FROM jobs WHERE id = ?").get(jobId) as
    | { ownerId: string | null; projectId: string | null }
    | null;
  if (!row) return false;
  if (row.ownerId) return row.ownerId === userId;
  if (!row.projectId) return false;
  const p = db.query("SELECT ownerId FROM projects WHERE id = ?").get(row.projectId) as { ownerId: string | null } | null;
  return p?.ownerId === userId;
}

jobsRoutes.get("/", (c) => {
  const raw = c.req.query("status");
  const page = Math.max(Number(c.req.query("page") ?? 1) || 1, 1);
  const pageSize = Math.min(Math.max(Number(c.req.query("pageSize") ?? 20) || 20, 1), 100);
  const q = c.req.query("q")?.trim();
  const type = c.req.query("type")?.trim();
  const projectRaw = c.req.query("projectId");
  const projectId =
    projectRaw === undefined
      ? undefined
      : projectRaw === "" || projectRaw === "none"
        ? null
        : projectRaw.trim();
  let status: JobStatus | JobStatus[] | undefined;
  if (raw === "active") status = ["queued", "running"];
  else if (raw === "queued" || raw === "running" || raw === "done" || raw === "failed" || raw === "canceled") status = raw;
  const { items, total } = jobQueue.queryJobs({
    status,
    q,
    type,
    projectId,
    ownerId: actor(c).id,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return ok(c, { items, total, page, pageSize });
});

jobsRoutes.get("/:id", (c) => {
  if (!mine(c.req.param("id"), actor(c).id)) return err(c, "任务不存在", 404);
  const job = jobQueue.get(c.req.param("id"));
  if (!job) return err(c, "任务不存在", 404);
  return ok(c, job);
});

jobsRoutes.post("/:id/cancel", (c) => {
  if (!mine(c.req.param("id"), actor(c).id)) return err(c, "任务不存在", 404);
  const job = jobQueue.cancel(c.req.param("id"));
  if (!job) return err(c, "任务不存在", 404);
  return ok(c, job);
});

jobsRoutes.post("/:id/retry", (c) => {
  if (!mine(c.req.param("id"), actor(c).id)) return err(c, "任务不存在", 404);
  const job = jobQueue.retry(c.req.param("id"));
  if (!job) return err(c, "任务不存在", 404);
  return ok(c, job);
});
