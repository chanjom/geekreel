import { Hono } from "hono";
import { actor } from "../lib/auth";
import { err, ok } from "../lib/resp";
import { abortAgent, confirmAgent, getAgent, listAgents, retryAgent, startAgent } from "../services/agent";

export const agentRoutes = new Hono();

agentRoutes.get("/", (c) => {
  return ok(c, listAgents(actor(c).id));
});

agentRoutes.post("/start", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { brief?: string; budgetYuan?: number };
  try {
    return ok(c, await startAgent({ brief: body.brief ?? "", budgetYuan: body.budgetYuan, ownerId: actor(c).id }));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

agentRoutes.get("/:id", (c) => {
  try {
    return ok(c, getAgent(c.req.param("id"), actor(c).id));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 404);
  }
});

agentRoutes.post("/:id/confirm", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { note?: string; targetId?: string };
  try {
    return ok(
      c,
      await confirmAgent({
        id: c.req.param("id"),
        ownerId: actor(c).id,
        note: body.note,
        targetId: body.targetId,
      }),
    );
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

agentRoutes.post("/:id/retry", (c) => {
  try {
    return ok(c, retryAgent(c.req.param("id"), actor(c).id));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

agentRoutes.post("/:id/abort", (c) => {
  try {
    return ok(c, abortAgent(c.req.param("id"), actor(c).id));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});
