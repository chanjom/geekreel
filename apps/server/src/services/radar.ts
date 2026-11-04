import { topicSearchUrl, type RadarItem, type RadarPlatformStat, type RadarSettings, type RadarSource, type RadarSourceKind, type RadarSub } from "@vw/core";
import { getAdapter } from "@vw/models";
import {
  RADAR_STORY_SYSTEM,
  RADAR_SYSTEM,
  boardPlatforms,
  buildFocusTemplate,
  buildPlatformSearchTemplate,
  fallbackStoryFromItem,
  fetchHotlist,
  hasHotlist,
  hotlistPlatforms,
  inQuietHours,
  isDue,
  itemHash,
  matchSubscription,
  parseHttpItems,
  parseRadarResponse,
  parseRss,
  radarStoryPrompt,
  sourceTemplates,
  type ParsedRadarItem,
} from "@vw/radar";
import { host, port } from "../config";
import { db, getSetting, setSetting } from "../db";
import type { JobHandler } from "../jobs/queue";
import { newId, now } from "../lib/resp";
import { wsHub } from "../ws";
import { getEndpoint, listEndpoints, resolveEndpoint } from "./models";
import { deliverToIds } from "./push";
import { chatMetered } from "./usage";

function publicBase(): string {
  return `http://${host}:${port}`;
}

interface SourceRow {
  id: string;
  name: string;
  kind: string;
  platform: string;
  queryTemplate: string;
  intervalMinutes: number;
  endpointId: string | null;
  enabled: number;
  lastRunAt: number | null;
  lastError: string | null;
  createdAt: number;
}

function rowToSource(row: SourceRow): RadarSource {
  return {
    ...row,
    kind: row.kind as RadarSource["kind"],
    enabled: row.enabled === 1,
  };
}

interface ItemRow {
  id: string;
  sourceId: string;
  title: string;
  platform: string;
  url: string | null;
  heat: number;
  heatText: string;
  summary: string;
  hash: string;
  fetchedAt: number;
  lastSeenAt: number | null;
}

function rowToItem(row: ItemRow): RadarItem {
  // 榜单给的真实链接优先（点「原文」能直达那条视频/问答），没有才退回站内搜索
  return {
    ...row,
    url: row.url || topicSearchUrl(row.platform, row.title),
    lastSeenAt: row.lastSeenAt ?? row.fetchedAt,
  };
}

interface SubRow {
  id: string;
  keyword: string;
  platformsJson: string;
  heatThreshold: number;
  quietStart: number | null;
  quietEnd: number | null;
  channelsJson: string;
  enabled: number;
  createdAt: number;
}

function rowToSub(row: SubRow): RadarSub {
  return {
    id: row.id,
    keyword: row.keyword,
    platforms: JSON.parse(row.platformsJson) as string[],
    heatThreshold: row.heatThreshold,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    channelIds: JSON.parse(row.channelsJson) as string[],
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
  };
}

export function seedRadarSources(): void {
  const t = now();
  for (const tpl of sourceTemplates) {
    const exists = db.query("SELECT id FROM radar_sources WHERE id = ?").get(tpl.id);
    if (!exists) {
      db.run(
        `INSERT INTO radar_sources (id, name, kind, platform, queryTemplate, intervalMinutes, enabled, lastRunAt, createdAt)
         VALUES (?, ?, 'ai-query', ?, ?, ?, 1, ?, ?)`,
        [tpl.id, tpl.name, tpl.platform, tpl.queryTemplate, tpl.intervalMinutes, t, t],
      );
    } else {
      // 内置源的提示词跟着代码走：改了模板要能生效，不然老库永远停在第一版提示词上。
      // 用户碰不到这条 SQL——前端没有编辑内置源的入口，只有启用/停用。
      db.run(
        "UPDATE radar_sources SET name = ?, platform = ?, queryTemplate = ?, intervalMinutes = ? WHERE id = ?",
        [tpl.name, tpl.platform, tpl.queryTemplate, tpl.intervalMinutes, tpl.id],
      );
    }
  }
  pruneHiddenSources();
}

/** 榜上只留微博/抖音/B站/知乎/小红书。HN、自定义 AI 等关掉。 */
export function pruneHiddenSources(): void {
  for (const s of listSources()) {
    const official = sourceTemplates.some((t) => t.id === s.id);
    if (!official && s.enabled) {
      db.run("UPDATE radar_sources SET enabled = 0 WHERE id = ?", [s.id]);
    }
  }
}

export function listSources(): RadarSource[] {
  return (db.query("SELECT * FROM radar_sources ORDER BY createdAt ASC").all() as SourceRow[]).map(rowToSource);
}

export function listBoardSources(): RadarSource[] {
  const order = new Map(sourceTemplates.map((t, i) => [t.id, i]));
  return listSources()
    .filter((s) => s.enabled && order.has(s.id))
    .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

export function getSource(id: string): RadarSource | null {
  const row = db.query("SELECT * FROM radar_sources WHERE id = ?").get(id) as SourceRow | null;
  return row ? rowToSource(row) : null;
}

export function createSource(input: {
  name: string;
  kind?: RadarSourceKind;
  platform?: string;
  focus?: string;
  queryTemplate?: string;
  intervalMinutes?: number;
  endpointId?: string | null;
}): RadarSource {
  const id = newId();
  const kind: RadarSourceKind = input.kind === "rss" || input.kind === "http-api" ? input.kind : "ai-query";
  const platform = input.platform?.trim() || input.name.trim();
  const queryTemplate =
    kind === "ai-query"
      ? input.queryTemplate?.trim() || buildFocusTemplate(input.focus || input.name)
      : (input.queryTemplate?.trim() || input.focus?.trim() || "");
  if (kind !== "ai-query") {
    if (!/^https?:\/\//i.test(queryTemplate)) {
      throw new Error(kind === "rss" ? "请填写可访问的 RSS 链接" : "请填写可访问的接口地址");
    }
  }
  db.run(
    `INSERT INTO radar_sources (id, name, kind, platform, queryTemplate, intervalMinutes, endpointId, enabled, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, input.name.trim(), kind, platform, queryTemplate, input.intervalMinutes ?? 360, input.endpointId ?? null, now()],
  );
  return getSource(id)!;
}

export function updateSource(
  id: string,
  patch: Partial<Pick<RadarSource, "name" | "queryTemplate" | "intervalMinutes" | "endpointId" | "enabled">>,
): RadarSource | null {
  const cur = getSource(id);
  if (!cur) return null;
  db.run(
    `UPDATE radar_sources SET name = ?, queryTemplate = ?, intervalMinutes = ?, endpointId = ?, enabled = ? WHERE id = ?`,
    [
      patch.name ?? cur.name,
      patch.queryTemplate ?? cur.queryTemplate,
      patch.intervalMinutes ?? cur.intervalMinutes,
      patch.endpointId === undefined ? cur.endpointId : patch.endpointId,
      (patch.enabled ?? cur.enabled) ? 1 : 0,
      id,
    ],
  );
  return getSource(id);
}

export function deleteSource(id: string): boolean {
  if (id.startsWith("tpl_")) {
    db.run("UPDATE radar_sources SET enabled = 0 WHERE id = ?", [id]);
    return true;
  }
  return db.run("DELETE FROM radar_sources WHERE id = ?", [id]).changes > 0;
}

export function listItems(
  opts: {
    platform?: string;
    q?: string;
    limit?: number;
    boardOnly?: boolean;
    sort?: "heat" | "time";
    /** 只看这个时间点之后抓到的 */
    since?: number;
  } = {},
): RadarItem[] {
  const limit = opts.limit ?? 60;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.boardOnly) {
    where.push(`platform IN (${boardPlatforms.map(() => "?").join(",")})`);
    params.push(...boardPlatforms);
  }
  if (opts.platform) {
    where.push("platform = ?");
    params.push(opts.platform);
  }
  if (opts.since) {
    where.push("COALESCE(lastSeenAt, fetchedAt) >= ?");
    params.push(opts.since);
  }
  if (opts.q?.trim()) {
    where.push("(title LIKE ? OR summary LIKE ?)");
    params.push(`%${opts.q.trim()}%`, `%${opts.q.trim()}%`);
  }
  const order =
    opts.sort === "time"
      ? "COALESCE(lastSeenAt, fetchedAt) DESC, heat DESC"
      : "heat DESC, COALESCE(lastSeenAt, fetchedAt) DESC";
  const sql = `SELECT * FROM radar_items ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ?`;
  params.push(limit);
  return (db.query(sql).all(...params) as ItemRow[]).map(rowToItem);
}

/** 每个平台的条数 / 最后抓取时间 / 错误，给页签用 */
export function platformStats(): RadarPlatformStat[] {
  const counts = db
    .query(
      `SELECT platform, COUNT(*) AS count, MAX(COALESCE(lastSeenAt, fetchedAt)) AS latestAt
       FROM radar_items GROUP BY platform`,
    )
    .all() as Array<{ platform: string; count: number; latestAt: number | null }>;
  const byPlatform = new Map(counts.map((c) => [c.platform, c]));
  return listBoardSources().map((s) => {
    const hit = byPlatform.get(s.platform);
    return {
      platform: s.platform,
      sourceId: s.id,
      sourceName: s.name,
      lastRunAt: s.lastRunAt,
      lastError: s.lastError,
      count: hit?.count ?? 0,
      latestAt: hit?.latestAt ?? null,
      via: s.kind === "ai-query" ? (hasHotlist(s.platform) ? "hotlist" : "ai") : "feed",
    } satisfies RadarPlatformStat;
  });
}

export function deleteItem(id: string): boolean {
  return db.run("DELETE FROM radar_items WHERE id = ?", [id]).changes > 0;
}

/** 清空热点。给平台就只清这个平台，不给就清全部 */
export function clearItems(platform?: string): number {
  if (platform) return db.run("DELETE FROM radar_items WHERE platform = ?", [platform]).changes;
  return db.run("DELETE FROM radar_items").changes;
}

export function radarTrend(days = 14): Array<{ date: string; count: number }> {
  const since = Date.now() - Math.max(1, days) * 86400_000;
  const rows = db
    .query(
      `SELECT strftime('%Y-%m-%d', fetchedAt / 1000, 'unixepoch', 'localtime') AS date, COUNT(*) AS count
       FROM radar_items WHERE fetchedAt >= ? GROUP BY date ORDER BY date ASC`,
    )
    .all(since) as Array<{ date: string; count: number }>;
  return rows;
}

export function getItem(id: string): RadarItem | null {
  const row = db.query("SELECT * FROM radar_items WHERE id = ?").get(id) as ItemRow | null;
  return row ? rowToItem(row) : null;
}

export function listSubs(): RadarSub[] {
  return (db.query("SELECT * FROM radar_subs ORDER BY createdAt DESC").all() as SubRow[]).map(rowToSub);
}

export function createSub(input: {
  keyword: string;
  platforms?: string[];
  heatThreshold?: number;
  quietStart?: number | null;
  quietEnd?: number | null;
  channelIds?: string[];
}): RadarSub {
  const id = newId();
  db.run(
    `INSERT INTO radar_subs (id, keyword, platformsJson, heatThreshold, quietStart, quietEnd, channelsJson, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.keyword.trim(),
      JSON.stringify(input.platforms ?? []),
      input.heatThreshold ?? 60,
      input.quietStart ?? null,
      input.quietEnd ?? null,
      JSON.stringify(input.channelIds ?? []),
      now(),
    ],
  );
  return listSubs().find((s) => s.id === id)!;
}

export function updateSub(id: string, patch: Partial<RadarSub>): RadarSub | null {
  const cur = listSubs().find((s) => s.id === id);
  if (!cur) return null;
  db.run(
    `UPDATE radar_subs SET keyword = ?, platformsJson = ?, heatThreshold = ?, quietStart = ?, quietEnd = ?, channelsJson = ?, enabled = ? WHERE id = ?`,
    [
      patch.keyword ?? cur.keyword,
      JSON.stringify(patch.platforms ?? cur.platforms),
      patch.heatThreshold ?? cur.heatThreshold,
      patch.quietStart === undefined ? cur.quietStart : patch.quietStart,
      patch.quietEnd === undefined ? cur.quietEnd : patch.quietEnd,
      JSON.stringify(patch.channelIds ?? cur.channelIds),
      (patch.enabled ?? cur.enabled) ? 1 : 0,
      id,
    ],
  );
  return listSubs().find((s) => s.id === id) ?? null;
}

export function deleteSub(id: string): boolean {
  return db.run("DELETE FROM radar_subs WHERE id = ?", [id]).changes > 0;
}

export function getRadarSettings(): RadarSettings {
  return getSetting<RadarSettings>("radar.settings", {
    digestEnabled: false,
    digestHour: 8,
    lastDigestDate: null,
  });
}

export function saveRadarSettings(patch: Partial<RadarSettings>): RadarSettings {
  const next = { ...getRadarSettings(), ...patch };
  setSetting("radar.settings", next);
  return next;
}

export function hasWebSearchLlm(): boolean {
  return listEndpoints("llm").some((e) => e.enabled && e.webSearch);
}

export function hasFeedSources(): boolean {
  return listSources().some((s) => s.enabled && s.kind !== "ai-query");
}

async function insertParsedItems(
  source: RadarSource,
  parsed: ParsedRadarItem[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const p of parsed) {
    const hash = itemHash(p.title, p.platform, p.url);
    const exists = db.query("SELECT id FROM radar_items WHERE hash = ?").get(hash) as { id: string } | null;
    // 同一话题再次抓到：刷新热度与摘要，让「刷新」看得见变化
    if (exists) {
      db.run("UPDATE radar_items SET heat = ?, heatText = ?, summary = ?, lastSeenAt = ? WHERE id = ?", [
        p.heat,
        p.heatText,
        p.summary,
        now(),
        exists.id,
      ]);
      updated++;
      continue;
    }
    const item: RadarItem = {
      id: newId(),
      sourceId: source.id,
      title: p.title,
      platform: p.platform,
      url: p.url,
      heat: p.heat,
      heatText: p.heatText,
      summary: p.summary,
      hash,
      fetchedAt: now(),
      lastSeenAt: now(),
    };
    db.run(
      `INSERT INTO radar_items (id, sourceId, title, platform, url, heat, heatText, summary, hash, fetchedAt, lastSeenAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.sourceId,
        item.title,
        item.platform,
        item.url,
        item.heat,
        item.heatText,
        item.summary,
        item.hash,
        item.fetchedAt,
        item.lastSeenAt ?? item.fetchedAt,
      ],
    );
    wsHub.broadcast({ type: "radar.upsert", item });
    inserted++;
    await notifyHits(item);
  }
  return { inserted, updated };
}

async function fetchFeedItems(source: RadarSource): Promise<ParsedRadarItem[]> {
  const url = source.queryTemplate.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("这个源没有有效的链接");
  const res = await fetch(url, { headers: { Accept: source.kind === "rss" ? "application/rss+xml, application/atom+xml, text/xml, */*" : "application/json" } });
  if (!res.ok) throw new Error(`拉取失败（${res.status}）。换一条公开链接再试。`);
  if (source.kind === "rss") {
    const xml = await res.text();
    const items = parseRss(xml, source.platform);
    if (items.length === 0) throw new Error("这个 RSS 里没有条目");
    return items;
  }
  const json = await res.json();
  return parseHttpItems(json, source.platform);
}

/**
 * 能拿来查热点的文本模型，按「优先尝试」排序。
 * 只认勾了「支持联网搜索」的：不勾的模型没有检索能力，问它等于让它编。
 */
export function radarLlmCandidates(preferredId?: string | null) {
  if (preferredId) {
    const ep = resolveEndpoint("llm", preferredId);
    if (!ep) throw new Error("指定的文本模型不存在");
    if (!ep.webSearch) {
      throw new Error(
        `端点「${ep.name}」还没勾选「支持联网搜索」。雷达要靠模型去网上查热点，请到「模型」页打开这个开关。`,
      );
    }
    return [ep];
  }
  const web = listEndpoints("llm").filter((e) => e.enabled && e.webSearch);
  if (web.length === 0) {
    throw new Error("还没有会联网的文本模型。到「模型」页添加一个文本模型，并勾选「支持联网搜索」。");
  }
  // 默认端点优先；其余按入库时间倒序——后加的一般是刚配好 key 的那个
  const ordered = [...web].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
  return ordered.map((e) => getEndpoint(e.id, true)!);
}

export function resolveRadarLlm(preferredId?: string | null) {
  return radarLlmCandidates(preferredId)[0]!;
}

export function dueSources(nowTs = Date.now()): RadarSource[] {
  return listSources().filter((s) => s.enabled && isDue(s.lastRunAt, s.intervalMinutes, nowTs));
}

async function notifyHits(item: RadarItem): Promise<void> {
  for (const sub of listSubs()) {
    if (!matchSubscription(item, sub)) continue;
    if (inQuietHours(sub)) continue;
    await deliverToIds(
      sub.channelIds,
      {
        title: `热点命中「${sub.keyword}」`,
        body: `[${item.platform} · ${item.heatText || "AI 估计 " + item.heat}]\n${item.title}\n${item.summary}`,
        url: `${publicBase()}/radar?item=${item.id}`,
      },
      sub,
    );
  }
}

export const fetchRadarHandler: JobHandler = async (job, ctx) => {
  const { sourceId } = JSON.parse(job.payloadJson) as { sourceId: string };
  try {
    return await runFetch(job, ctx);
  } catch (e) {
    markSourceError(sourceId, e instanceof Error ? e.message : String(e));
    throw e;
  }
};

const runFetch: JobHandler = async (job, ctx) => {
  const { sourceId, q } = JSON.parse(job.payloadJson) as { sourceId: string; q?: string };
  const source = getSource(sourceId);
  if (!source) throw new Error("观察源不存在");
  const focus = q?.trim() ?? "";

  let parsed: ParsedRadarItem[] | null = null;
  let via: "feed" | "hotlist" | "ai" = "ai";

  // 1) 自建的 RSS / 接口源
  if (!focus && (source.kind === "rss" || source.kind === "http-api")) {
    ctx.progress(0.2, source.kind === "rss" ? "拉取 RSS" : "拉取接口");
    parsed = await fetchFeedItems(source);
    via = "feed";
  }

  // 2) 能直连官方榜单的平台，先直连（快、准、不烧钱）
  if (!parsed && !focus && hasHotlist(source.platform)) {
    ctx.progress(0.2, `直连${source.platform}榜单`);
    try {
      const hot = await fetchHotlist(source.platform);
      if (hot && hot.length > 0) {
        parsed = hot;
        via = "hotlist";
      }
    } catch {
      // 直连失败就退回模型
    }
  }

  // 3) 其余情况问联网文本模型
  if (!parsed) {
    ctx.progress(0.1, "找联网文本模型");
    const candidates = radarLlmCandidates(source.endpointId);
    const prompt = focus ? buildPlatformSearchTemplate(source.platform, focus) : source.queryTemplate;

    const failures: string[] = [];
    for (const endpoint of candidates) {
      const adapter = getAdapter(endpoint.adapterType);
      if (!adapter?.chat) {
        failures.push(`${endpoint.name}：不会聊天`);
        continue;
      }
      ctx.progress(0.25, candidates.length > 1 && failures.length > 0
        ? `${endpoint.name} 重试中`
        : focus
          ? `正在查${source.platform}「${focus}」`
          : `正在问 ${endpoint.name}`);
      try {
        const text = await chatMetered(
          adapter,
          endpoint,
          {
            system: RADAR_SYSTEM,
            prompt,
            webSearch: true,
            // 检索词只给平台 + 关键词，别把整段模板甩给搜索引擎（会检索跑偏）
            searchQuery: focus ? `${source.platform} ${focus}` : source.platform,
          },
          { jobType: "radar.fetch" },
        );
        const items = parseRadarResponse(text, source.platform);
        if (items.length > 0) {
          parsed = items;
          break;
        }
        failures.push(`${endpoint.name}：返回 0 条（模型没给出可用热点）`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${endpoint.name}：${msg.slice(0, 120)}`);
      }
    }
    if (!parsed) {
      // 「模型查不到东西」和「模型调不通」是两件事，报错得分开说，
      // 否则用户会跑去模型页换 key，其实换谁来都查不到。
      const allEmpty = failures.every((f) => /返回 0 条|没有给出任何有效热点|没给出可用/.test(f));
      if (allEmpty) {
        throw new Error(
          `${source.platform}这次没查到近期热点：没有公开榜单可直连，模型也没在公开网页里找到可靠内容。`,
        );
      }
      throw new Error(`联网模型都没查成 —— ${failures.join("；")}`);
    }
  }

  ctx.progress(0.7, "整理热点");
  const { inserted, updated } = await insertParsedItems(source, parsed);

  db.run("UPDATE radar_sources SET lastRunAt = ?, lastError = NULL WHERE id = ?", [now(), source.id]);
  ctx.progress(
    1,
    updated > 0 ? `新增 ${inserted} 条，更新 ${updated} 条热度` : `新增 ${inserted} 条`,
  );
  return { inserted, updated, parsed: parsed.length, via };
};

export function markSourceError(sourceId: string, message: string): void {
  db.run("UPDATE radar_sources SET lastRunAt = ?, lastError = ? WHERE id = ?", [now(), message.slice(0, 240), sourceId]);
}

export const digestRadarHandler: JobHandler = async (_job, ctx) => {
  ctx.progress(0.2, "汇总今日热点");
  const since = Date.now() - 24 * 3600_000;
  const items = (
    db.query("SELECT * FROM radar_items WHERE fetchedAt >= ? ORDER BY heat DESC LIMIT 10").all(since) as ItemRow[]
  ).map(rowToItem);
  if (items.length === 0) {
    ctx.progress(1, "今天还没有热点");
    return { sent: false, reason: "empty" };
  }
  const body = items
    .map((it, i) => `${i + 1}. [${it.platform} ${it.heat}] ${it.title}${it.summary ? ` — ${it.summary}` : ""}`)
    .join("\n");
  ctx.progress(0.6, "推送早报");
  await deliverToIds(
    [],
    {
      title: "今日热点早报",
      body,
      url: `${publicBase()}/radar`,
    },
    null,
  );
  const settings = getRadarSettings();
  saveRadarSettings({
    ...settings,
    lastDigestDate: (() => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })(),
  });
  ctx.progress(1, "早报已发出");
  return { sent: true, count: items.length };
};

/** 热点 → 收成首页「想法」，用户改完再走剧本/定妆/出片 */
export async function storyFromItem(itemId: string): Promise<{
  idea: string;
  title: string;
  platform: string;
  itemId: string;
}> {
  const item = getItem(itemId);
  if (!item) throw new Error("这条热点不存在或已过期");
  const fallback = fallbackStoryFromItem(item);
  try {
    const endpoint = resolveEndpoint("llm");
    const adapter = endpoint ? getAdapter(endpoint.adapterType) : null;
    if (!endpoint || !adapter?.chat) {
      return { idea: fallback, title: item.title, platform: item.platform, itemId };
    }
    const text = await chatMetered(
      adapter,
      endpoint,
      { system: RADAR_STORY_SYSTEM, prompt: radarStoryPrompt(item) },
      { jobType: "radar.story" },
    );
    const idea = text.replace(/^```[\s\S]*?```$/m, "").trim() || fallback;
    return { idea, title: item.title, platform: item.platform, itemId };
  } catch {
    return { idea: fallback, title: item.title, platform: item.platform, itemId };
  }
}
