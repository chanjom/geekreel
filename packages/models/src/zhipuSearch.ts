/**
 * 智谱（BigModel）联网检索。
 *
 * 坑：智谱的 chat/completions 不认 OpenAI/DashScope 那套 `enable_search`，
 * 也不认 `tools:[{type:"web_search"}]`——传了不报错，但搜索结果一条都不注入，
 * 模型于是凭训练记忆编（实测 prompt_tokens 只有 20，答案里还是两年前的旧闻）。
 * 它的联网能力挂在独立接口 `/web_search` 上：返回标题、来源、发布日期、
 * 正文片段。我们取回来自己拼进上下文，比赌模型内部工具可靠得多。
 */

export interface SearchHit {
  title: string;
  link: string;
  media: string;
  publishDate: string;
  content: string;
}

interface RawSearchResponse {
  search_result?: Array<{
    title?: string;
    link?: string;
    media?: string;
    publish_date?: string;
    content?: string;
  }>;
}

/** 免费额度用 search_std；search_pro 更贵也更全，留给需要时切换。 */
const DEFAULT_ENGINE = "search_std";

/** 单条正文截断长度：10 条全塞进去会把小模型的上下文挤爆。 */
const PER_HIT_CHARS = 700;

export function buildSearchQuery(prompt: string): string {
  // 检索接口对长 query 会做意图重写，太啰嗦反而跑偏；
  // 留前 100 字够表达意图，同时把换行压成空格。
  return prompt.replace(/\s+/g, " ").trim().slice(0, 100);
}

export async function zhipuWebSearch(
  config: Record<string, string>,
  query: string,
  opts: { limit?: number; engine?: string } = {},
): Promise<SearchHit[]> {
  const key = (config.apiKey ?? "").trim();
  if (!key) throw new Error("智谱没有配置 API Key");
  const base = (config.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");
  const res = await fetch(`${base}/web_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      search_engine: opts.engine ?? DEFAULT_ENGINE,
      search_query: buildSearchQuery(query),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string }; message?: string };
      detail = j.error?.message ?? j.message ?? detail;
    } catch {
      /* 保留状态码 */
    }
    throw new Error(`智谱检索失败：${detail}`);
  }
  const json = (await res.json()) as RawSearchResponse;
  const limit = opts.limit ?? 8;
  return (json.search_result ?? [])
    .slice(0, limit)
    .map((r) => ({
      title: (r.title ?? "").trim(),
      link: (r.link ?? "").trim(),
      media: (r.media ?? "").trim(),
      publishDate: (r.publish_date ?? "").trim(),
      content: (r.content ?? "").replace(/\s+/g, " ").trim().slice(0, PER_HIT_CHARS),
    }))
    .filter((h) => h.title || h.content);
}

/**
 * 把检索结果拼成一段可核对的上下文。
 *
 * 检索接口本身是按相关度排的，不按时间——查「短剧」能翻出两年前盘点春节档的旧文。
 * 所以先按发布日筛一遍近期的，再按新→旧排；全都很旧时也不能假装有数据，
 * 得在上下文里把「这些是旧的」写清楚，让模型别当成今天的热点。
 */
export function withSearchContext(
  prompt: string,
  hits: SearchHit[],
  opts: { freshDays?: number } = {},
): string {
  const freshDays = opts.freshDays ?? 45;
  const nowTs = Date.now();
  const cutoff = nowTs - freshDays * 86400_000;
  const today = new Date(nowTs).toISOString().slice(0, 10);

  const dated = hits.map((h) => ({ h, ts: Date.parse(h.publishDate) || 0 }));
  // 没有日期的留着（有些源就是不给），有日期的按时间裁
  const fresh = dated.filter((x) => x.ts === 0 || x.ts >= cutoff);
  const useFresh = fresh.length >= 3;
  const picked = (useFresh ? fresh : dated)
    .sort((a, b) => b.ts - a.ts)
    .map((x) => x.h)
    .slice(0, 8);

  const blocks = picked.map((h, i) => {
    const meta = [h.media, h.publishDate].filter(Boolean).join(" · ");
    return `【${i + 1}】${h.title}${meta ? `（${meta}）` : ""}\n${h.content}${h.link ? `\n来源：${h.link}` : ""}`;
  });

  const staleWarning = useFresh
    ? ""
    : `注意：这 ${picked.length} 条里没有一条是 ${freshDays} 天内发布的（最新一条是 ${
        picked[0]?.publishDate || "未知日期"
      }）。也就是说没搜到「此刻正在发生」的内容。遇到这种情况必须直说「最近没有查到相关热点」，禁止把它们当成今天的榜单。\n`;

  return [
    `今天是 ${today}。下面是我刚用搜索引擎取回的实时网页片段，共 ${picked.length} 条：`,
    "",
    blocks.join("\n\n"),
    "",
    "——",
    staleWarning +
      `要求：只依据上面这些片段回答，优先采用 ${freshDays} 天内发布的内容。片段里没有的信息，直接说「没查到」，不要用你自己的记忆补，也不要推测。`,
    "片段里的发布时间只用来判断新旧，不要把日期、链接、来源名写进正文，也不要在正文里加【1】这类角标。",
    "",
    `问题：${prompt}`,
  ]
    .filter((s) => s !== "")
    .join("\n");
}
