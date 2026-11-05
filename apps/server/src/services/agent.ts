/**
 * 导演模式：把「一句话」变成「一部片子」，中间停下来等人确认。
 *
 * 它不重写流水线，只是把已有能力按顺序串起来：
 *   plan  一句话 → 结构化方案（集数/时长/风格/预算）→ 等确认
 *   bible pipeline.run（checkpoint）→ 人物 + 分集 → 等确认
 *   cast  advancePipeline → 定妆图 + 分镜 → 等确认
 *   shots pipeline.episode → 第 1 集成片 → 等确认
 *   render timeline.render → 合成导出 → 完成
 *
 * 每一阶段都能带一句修改意见（"女主换成熟点"），不用整条重跑。
 */
import { db } from "../db";
import { jobQueue } from "../jobs/queue";
import { newId, now } from "../lib/resp";
import { extractJsonObject } from "../lib/json";
import { sumSpend, type UsageRow } from "../lib/spend";
import { getAdapter } from "@vw/models";
import { resolveEndpoint } from "./models";
import { listPacks } from "./styles";
import { advancePipeline, revisePipelineBible, revisePipelineCast } from "./pipeline";
import { chatMetered } from "./usage";

export type AgentStage = "plan" | "bible" | "cast" | "shots" | "render" | "done";
export type AgentStatus = "running" | "waiting" | "done" | "failed" | "aborted";

export interface AgentPlan {
  title: string;
  story: string;
  episodeCount: number;
  secondsPerEpisode: number;
  packId: string | null;
  styleHint: string;
  platform: string;
  audience: string;
  estimatedYuan: number;
  /** 信息不够时，要问用户的一句话；够了就是空 */
  ask: string;
}

export interface AgentRun {
  id: string;
  projectId: string | null;
  pipelineId: string | null;
  brief: string;
  status: AgentStatus;
  stage: AgentStage;
  plan: AgentPlan | null;
  detail: Record<string, unknown>;
  budgetCents: number;
  spentCents: number;
  /** 花费里有端点没填单价，是按公开价估的 */
  spentEstimated: boolean;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

interface AgentRow {
  id: string;
  ownerId: string | null;
  projectId: string | null;
  pipelineId: string | null;
  brief: string;
  status: string;
  stage: string;
  planJson: string;
  stageJson: string;
  budgetCents: number;
  spentCents: number;
  /** 花费里有端点没填单价，是按公开价估的 */
  spentEstimated: boolean;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ 读写 */

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function rowToRun(row: AgentRow): AgentRun {
  return {
    id: row.id,
    projectId: row.projectId,
    pipelineId: row.pipelineId,
    brief: row.brief,
    status: row.status as AgentStatus,
    stage: row.stage as AgentStage,
    plan: parseJson<AgentPlan | null>(row.planJson, null),
    detail: parseJson<Record<string, unknown>>(row.stageJson, {}),
    budgetCents: row.budgetCents,
    spentCents: row.spentCents,
    spentEstimated: false,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function loadRow(id: string, ownerId: string): AgentRow {
  const row = db.query("SELECT * FROM agent_runs WHERE id = ? AND ownerId = ?").get(id, ownerId) as AgentRow | null;
  if (!row) throw new Error("这次导演不存在");
  return row;
}

/** 内部推进时用：已经校验过归属，不需要再带 owner */
function loadRowById(id: string): AgentRow {
  const row = db.query("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRow | null;
  if (!row) throw new Error("这次导演不存在");
  return row;
}

function save(id: string, patch: Partial<AgentRow>): void {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => (patch as Record<string, unknown>)[k]);
  db.run(`UPDATE agent_runs SET ${sets}, updatedAt = ? WHERE id = ?`, [...values, now(), id] as never);
}

/**
 * 项目实际花掉的钱。
 *
 * 端点里填了单价就用真实 cost；没填（绝大多数人不会填）就按公开价兜底估。
 * 不估的话 spent 永远是 0，预算护栏等于没有。
 */
function spentInfo(projectId: string | null): { cents: number; estimated: boolean } {
  if (!projectId) return { cents: 0, estimated: false };
  const rows = db
    .query(
      "SELECT capability, promptTokens, completionTokens, images, audioChars, videoSec, cost FROM model_usage WHERE projectId = ?",
    )
    .all(projectId) as UsageRow[];
  return sumSpend(rows);
}

/** 剧本摘要：给前端画卡片用，不返回整份 bible */
function summarizeBible(pipelineId: string): Record<string, unknown> {
  const row = db.query("SELECT stateJson FROM pipelines WHERE id = ?").get(pipelineId) as { stateJson: string } | null;
  const state = parseJson<{ bible?: Record<string, unknown> }>(row?.stateJson, {});
  const bible = state.bible ?? {};
  const cast = (bible.cast as Array<Record<string, unknown>> | undefined) ?? [];
  const episodes = (bible.episodes as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    title: (bible.title as string) ?? "",
    cast: cast.map((c) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? ""),
      identity: String(c.identity ?? ""),
      imageAssetId: (c.imageAssetId as string | null) ?? null,
    })),
    episodes: episodes.map((e, i) => ({
      index: Number(e.index ?? i + 1),
      title: String(e.title ?? ""),
      summary: String(e.summary ?? ""),
      shotCount: Array.isArray(e.shots) ? e.shots.length : 0,
    })),
  };
}

/* ------------------------------------------------------------------ 意图解析 */

const PLAN_SYSTEM = `你是短剧导演。用户会用一句话说他想要什么，你要把它变成能直接开工的制作参数。

只输出一个 JSON 对象，不要 markdown 代码块，不要解释：
{
  "title": "剧名，12 字以内，有钩子",
  "story": "把用户的意思扩写成 150-250 字的完整故事，要有具体人名、明确冲突、结尾留钩子",
  "episodeCount": 3,
  "secondsPerEpisode": 15,
  "packId": null,
  "styleHint": "风格倾向，例如：都市情感、古装悬疑、职场；没有就空字符串",
  "platform": "抖音",
  "audience": "一句话说清给谁看",
  "estimatedYuan": 5,
  "ask": ""
}

规则：
- 用户没说集数就 3 集，没说时长就 15 秒
- story 必须能直接拿去拆剧本：有主角名字、有对手、有一个具体的场景
- estimatedYuan 按每集 1.5 元估算并向上取整
- 如果缺关键信息导致没法开工（比如只说"做个短剧"），把要问的话放 ask，其余字段照样给一个合理猜测
- 用户如果给了修改意见，在上一版基础上改，不要推翻重来`;

async function makePlan(brief: string, previous: AgentPlan | null, note: string | null): Promise<AgentPlan> {
  const endpoint = resolveEndpoint("llm");
  if (!endpoint) throw new Error("导演模式要一个文本模型。到「模型」页加一个再来。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个端点不会聊天，换一个文本模型");

  const available = listPacks().filter((p) => p.ready);
  const packHint = available.map((p) => `${p.id}（${p.name}）`).join("、");

  const prompt = [
    `用户说：${brief}`,
    previous ? `\n上一版方案：${JSON.stringify(previous)}` : "",
    note ? `\n用户看了上一版，提了一句：${note}` : "",
    available.length ? `\n可用风格包：${packHint}。普通真人短剧填 null，只有明显需要这些画风时才填对应 id。` : "\n没有额外风格包，packId 填 null。",
  ]
    .filter(Boolean)
    .join("");

  const text = await chatMetered(
    adapter,
    endpoint,
    { system: PLAN_SYSTEM, prompt },
    { projectId: null, jobType: "agent.plan" },
  );

  const parsed = parseJson<Partial<AgentPlan>>(extractJsonObject(text), {});
  const story = String(parsed.story ?? "").trim();
  if (!story) throw new Error("导演没读懂你的意思，换一种说法再试（比如：做个外卖员逆袭的 3 集短剧）");

  const validPack = parsed.packId ? available.some((p) => p.id === String(parsed.packId)) : false;
  return {
    title: String(parsed.title ?? "未命名短剧").slice(0, 24),
    story,
    episodeCount: Math.min(Math.max(Number(parsed.episodeCount) || 3, 1), 12),
    secondsPerEpisode: Math.min(Math.max(Number(parsed.secondsPerEpisode) || 15, 5), 60),
    packId: validPack ? String(parsed.packId) : null,
    styleHint: String(parsed.styleHint ?? ""),
    platform: String(parsed.platform ?? "抖音"),
    audience: String(parsed.audience ?? ""),
    estimatedYuan: Math.max(Number(parsed.estimatedYuan) || 5, 1),
    ask: String(parsed.ask ?? ""),
  };
}

/* ------------------------------------------------------------------ 启动 */

export async function startAgent(input: { brief: string; budgetYuan?: number; ownerId: string }): Promise<AgentRun> {
  const brief = input.brief.trim();
  if (!brief) throw new Error("先说一句你想做什么样的短剧");
  if (brief.length > 4000) throw new Error("一句话太长了，控制在 4000 字以内");

  const plan = await makePlan(brief, null, null);
  const budgetCents = Math.round((input.budgetYuan ?? Math.max(plan.estimatedYuan * 2, 20)) * 100);
  const id = newId();
  const t = now();
  db.run(
    `INSERT INTO agent_runs (id, ownerId, projectId, pipelineId, brief, status, stage, planJson, stageJson, budgetCents, spentCents, note, createdAt, updatedAt)
     VALUES (?, ?, NULL, NULL, ?, 'waiting', 'plan', ?, '{}', ?, 0, NULL, ?, ?)`,
    [id, input.ownerId, brief, JSON.stringify(plan), budgetCents, t, t],
  );
  return getAgent(id, input.ownerId);
}

/* ------------------------------------------------------------------ 推进 */

const JOB_BY_STAGE: Partial<Record<AgentStage, string>> = {
  bible: "pipeline.run",
  shots: "pipeline.episode",
  render: "timeline.render",
};

/** 任务跑完了就自动往下走一格；没跑完就什么都不做 */
function refresh(row: AgentRow): AgentRow {
  if (row.status !== "running") return row;
  const detail = parseJson<Record<string, unknown>>(row.stageJson, {});
  const jobId = typeof detail.jobId === "string" ? detail.jobId : null;
  if (!jobId) return row;

  const job = db
    .query("SELECT status, progress, message, resultJson, error FROM jobs WHERE id = ?")
    .get(jobId) as { status: string; progress: number; message: string | null; resultJson: string | null; error: string | null } | null;
  if (!job) return row;

  if (job.status === "failed" || job.status === "canceled") {
    save(row.id, { status: "failed", note: job.error || "生成失败了，可以重试这一步" });
    return loadRowById(row.id);
  }
  if (job.status !== "done") {
    // 进度透传给前端，不落库
    return { ...row, stageJson: JSON.stringify({ ...detail, progress: job.progress, message: job.message }) };
  }

  const result = parseJson<Record<string, unknown>>(job.resultJson, {});

  if (row.stage === "bible") {
    const pipelineId = typeof result.pipelineId === "string" ? result.pipelineId : null;
    const projectId = typeof result.projectId === "string" ? result.projectId : row.projectId;
    if (!pipelineId) {
      save(row.id, { status: "failed", note: "剧本没生成出来，重试一次" });
      return loadRowById(row.id);
    }
    const summary = summarizeBible(pipelineId);
    save(row.id, {
      status: "waiting",
      projectId,
      pipelineId,
      stageJson: JSON.stringify(summary),
      note: typeof result.message === "string" ? result.message : null,
      spentCents: spentInfo(projectId).cents,
    });
    return loadRowById(row.id);
  }

  if (row.stage === "shots") {
    save(row.id, {
      status: "waiting",
      stageJson: JSON.stringify({ ...detail, ...result, progress: 1 }),
      spentCents: spentInfo(row.projectId).cents,
    });
    return loadRowById(row.id);
  }

  if (row.stage === "render") {
    save(row.id, {
      status: "done",
      stage: "done",
      stageJson: JSON.stringify({ ...detail, ...result }),
      spentCents: spentInfo(row.projectId).cents,
    });
    return loadRowById(row.id);
  }

  return row;
}

export function getAgent(id: string, ownerId: string): AgentRun {
  const row = refresh(loadRow(id, ownerId));
  // 跑着的任务，每次查询都刷一下花费，前端才能显示实时账单
  // 每次都实时算：库里存的那份只用于列表页，可能已经过时
  const info = spentInfo(row.projectId);
  return { ...rowToRun({ ...row, spentCents: info.cents }), spentEstimated: info.estimated };
}

export function listAgents(ownerId: string, limit = 30): AgentRun[] {
  const rows = db
    .query("SELECT * FROM agent_runs WHERE ownerId = ? ORDER BY createdAt DESC LIMIT ?")
    .all(ownerId, limit) as AgentRow[];
  return rows.map(rowToRun);
}

/* ------------------------------------------------------------------ 确认 / 修改 */

function assertBudget(row: AgentRow) {
  const spent = spentInfo(row.projectId).cents;
  if (row.budgetCents > 0 && spent >= row.budgetCents) {
    throw new Error(
      `已经花到预算上限了（${(spent / 100).toFixed(2)} / ${(row.budgetCents / 100).toFixed(2)} 元）。换个更便宜的视频模型，或者提高预算再继续。`,
    );
  }
}

export async function confirmAgent(input: {
  id: string;
  ownerId: string;
  note?: string;
  targetId?: string;
}): Promise<AgentRun> {
  const row = refresh(loadRow(input.id, input.ownerId));
  if (row.status === "done") throw new Error("这部已经做完了");
  if (row.status === "aborted") throw new Error("已经中止了");
  if (row.status === "failed") throw new Error("这一步失败了，先点重试");
  if (row.status !== "waiting") throw new Error("还在跑，等这一步出来");

  const note = (input.note ?? "").trim();
  const plan = parseJson<AgentPlan | null>(row.planJson, null);
  if (!plan) throw new Error("方案丢了，重新开一部");

  /* plan：没意见就开工 */
  if (row.stage === "plan") {
    if (note) {
      const next = await makePlan(row.brief, plan, note);
      save(row.id, { planJson: JSON.stringify(next), note: null });
      return getAgent(row.id, input.ownerId);
    }
    const job = jobQueue.submit(
      "pipeline.run",
      {
        story: plan.story,
        packId: plan.packId ?? undefined,
        seriesName: plan.title,
        checkpoint: true,
        episodeCount: plan.episodeCount,
      },
      null,
      input.ownerId,
    );
    save(row.id, { stage: "bible", status: "running", stageJson: JSON.stringify({ jobId: job.id }), note: null });
    return getAgent(row.id, input.ownerId);
  }

  /* bible：改剧本，或确认后去定妆 */
  if (row.stage === "bible") {
    if (!row.pipelineId) throw new Error("剧本还没落库，等一下再试");
    if (note) {
      // 点到了具体角色就只改那一个（会重画他的定妆图）；否则改整份，图不动。
      const detail = parseJson<{ cast?: Array<{ id: string; name: string }> }>(row.stageJson, {});
      const cast = detail.cast ?? [];
      const hit = cast.find((c) => note.includes(c.name)) ?? cast.find((c) => c.id === input.targetId);
      if (hit) {
        await revisePipelineCast(row.pipelineId, {
          target: "character",
          targetId: hit.id,
          instruction: note,
        });
      } else {
        await revisePipelineBible(row.pipelineId, note);
      }
      save(row.id, { stageJson: JSON.stringify(summarizeBible(row.pipelineId)), note: null });
      return getAgent(row.id, input.ownerId);
    }
    assertBudget(row);
    await advancePipeline(row.pipelineId);
    save(row.id, {
      stage: "cast",
      status: "waiting",
      stageJson: JSON.stringify(summarizeBible(row.pipelineId)),
      note: null,
      spentCents: spentInfo(row.projectId).cents,
    });
    return getAgent(row.id, input.ownerId);
  }

  /* cast：分镜已锁定，只能出片或去画布手改 */
  if (row.stage === "cast") {
    if (note) {
      throw new Error(
        "分镜排好之后就不能在这里改角色了。要调分镜就去画布手动改（这一集的镜头都在那儿），或者点「停在这里」重新开一部。",
      );
    }
    if (!row.projectId) throw new Error("项目还没建好");
    assertBudget(row);
    const job = jobQueue.submit(
      "pipeline.episode",
      { projectId: row.projectId, episodeIndex: 1 },
      row.projectId,
      input.ownerId,
    );
    save(row.id, { stage: "shots", status: "running", stageJson: JSON.stringify({ jobId: job.id }), note: null });
    return getAgent(row.id, input.ownerId);
  }

  /* shots：看完成片，确认就合成 */
  if (row.stage === "shots") {
    if (note) {
      if (!row.projectId) throw new Error("项目还没建好");
      assertBudget(row);
      const job = jobQueue.submit(
        "pipeline.episode",
        { projectId: row.projectId, episodeIndex: 1 },
        row.projectId,
        input.ownerId,
      );
      save(row.id, { status: "running", stageJson: JSON.stringify({ jobId: job.id }), note: null });
      return getAgent(row.id, input.ownerId);
    }
    if (!row.projectId) throw new Error("项目还没建好");
    const job = jobQueue.submit(
      "timeline.render",
      { projectId: row.projectId, burnSubs: true },
      row.projectId,
      input.ownerId,
    );
    save(row.id, { stage: "render", status: "running", stageJson: JSON.stringify({ jobId: job.id }), note: null });
    return getAgent(row.id, input.ownerId);
  }

  throw new Error("这一步没法确认");
}

/** 失败后重试当前这一步 */
export function retryAgent(id: string, ownerId: string): AgentRun {
  const row = loadRow(id, ownerId);
  if (row.status !== "failed") throw new Error("只有失败的时候才能重试");
  const detail = parseJson<Record<string, unknown>>(row.stageJson, {});
  const jobId = typeof detail.jobId === "string" ? detail.jobId : null;
  if (jobId) {
    const job = jobQueue.retry(jobId);
    if (job) {
      save(row.id, { status: "running", note: null });
      return getAgent(row.id, ownerId);
    }
  }
  // 没有可重试的任务，退回等待态让用户点确认
  save(row.id, { status: "waiting", note: null });
  return getAgent(row.id, ownerId);
}

export function abortAgent(id: string, ownerId: string): AgentRun {
  const row = loadRow(id, ownerId);
  if (row.status === "done") throw new Error("已经做完了，不用中止");
  const detail = parseJson<Record<string, unknown>>(row.stageJson, {});
  const jobId = typeof detail.jobId === "string" ? detail.jobId : null;
  if (jobId) jobQueue.cancel(jobId);
  save(row.id, { status: "aborted", note: "已中止" });
  return getAgent(id, ownerId);
}

/** 已注册的任务类型（供路由自检，防止状态机指向不存在的 job） */
export function agentJobTypes(): string[] {
  return [...new Set(Object.values(JOB_BY_STAGE))].filter(Boolean);
}
