/**
 * 直连公开榜单：不经过模型，抓到的就是平台此刻的排行。
 *
 * 两条路：
 * 1. 官方接口（B站 ranking、抖音 hotsearch）——最准，但有风控/随时会变；
 * 2. 今日热榜 tophub（api.codelife.cc）——第三方聚合，微博/知乎/抖音/B站 都有，
 *    数据带真实热度值和原文链接。微博/知乎 没有可直连的官方榜，只能走这条。
 */

import type { ParsedRadarItem } from "./feeds";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const hotlistPlatforms = ["微博", "知乎", "抖音", "B站"];

export function hasHotlist(platform: string): boolean {
  return hotlistPlatforms.includes(platform.trim());
}

function fmtCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
  return String(Math.round(n));
}

/** "1198.8万" / "1.2亿" / "161万" → 数字 */
export function parseHotValue(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const text = String(raw ?? "").trim();
  if (!text) return 0;
  const m = text.match(/([\d.]+)\s*(亿|万|w|W)?/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  if (m[2] === "亿") return Math.round(n * 1e8);
  if (m[2]) return Math.round(n * 1e4);
  return Math.round(n);
}

async function getJson(url: string, platform: string, referer?: string): Promise<unknown> {
  const host = new URL(url).host;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      // B站会拦 api. 域名的 Referer（-352 风控），必须用主站
      Referer: referer ?? `https://${host}/`,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${platform} 榜单接口 HTTP ${res.status}`);
  return res.json();
}

/**
 * 今日热榜的节点 id（从 tophub.today 首页提取，长期稳定）。
 * 小红书没有对应节点，只能靠模型。
 */
const TOPHUB_NODES: Record<string, { node: string; label: string }> = {
  微博: { node: "KqndgxeLl9", label: "热搜" },
  知乎: { node: "mproPpoq6O", label: "热榜" },
  抖音: { node: "DpQvNABoNE", label: "总榜" },
  B站: { node: "74KvxwokxM", label: "全站日榜" },
};

interface TophubItem {
  index?: string;
  title?: string;
  hotValue?: string;
  link?: string;
}

async function fetchTophub(platform: string): Promise<ParsedRadarItem[]> {
  const meta = TOPHUB_NODES[platform];
  if (!meta) throw new Error(`${platform} 没有可直连的榜单`);
  const json = (await getJson(
    `https://api.codelife.cc/api/top/list?lang=cn&id=${meta.node}`,
    platform,
  )) as { code?: number; data?: TophubItem[] };
  if (json.code !== 200 || !Array.isArray(json.data) || json.data.length === 0) {
    throw new Error(`今日热榜没有返回${platform}数据`);
  }
  const list = json.data.slice(0, 20);
  const values = list.map((v) => parseHotValue(v.hotValue));
  const max = Math.max(1, ...values);
  return list
    .map((v, i) => ({
      title: String(v.title ?? "").trim().slice(0, 160),
      platform,
      url: v.link?.trim() || null,
      // 首位 100，逐位递减，同时保留相对热度（和官方榜同一量纲）
      heat: Math.max(30, Math.min(100, Math.round((100 * values[i]!) / max))),
      heatText: `${platform}${meta.label} #${v.index ?? i + 1}${
        values[i] ? ` · ${fmtCount(values[i]!)}` : ""
      }`,
      summary: "",
    }))
    .filter((x) => x.title);
}

/** B站全站排行（公开接口） */
async function fetchBilibili(): Promise<ParsedRadarItem[]> {
  const json = (await getJson(
    "https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all",
    "B站",
    "https://www.bilibili.com/v/popular/rank/all",
  )) as { data?: { list?: Array<Record<string, unknown>> } };
  const list = json.data?.list;
  if (!Array.isArray(list) || list.length === 0) throw new Error("B站榜单返回为空");
  return list
    .slice(0, 20)
    .map((v, i) => {
      const stat = (v.stat ?? {}) as Record<string, unknown>;
      const views = Number(stat.view ?? 0);
      const bvid = String(v.bvid ?? "").trim();
      return {
        title: String(v.title ?? "").trim().slice(0, 160),
        platform: "B站",
        url: bvid ? `https://www.bilibili.com/video/${bvid}` : null,
        heat: Math.max(30, 100 - i * 4),
        heatText: `B站排行 #${i + 1}${views ? ` · ${fmtCount(views)}播放` : ""}`,
        summary: String(v.desc ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120),
      };
    })
    .filter((x) => x.title);
}

/** 抖音热榜（公开接口） */
async function fetchDouyin(): Promise<ParsedRadarItem[]> {
  const json = (await getJson(
    "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/",
    "抖音",
  )) as { word_list?: Array<Record<string, unknown>> };
  const list = json.word_list;
  if (!Array.isArray(list) || list.length === 0) throw new Error("抖音热榜返回为空");
  const values = list.map((v) => Number(v.hot_value ?? 0));
  const max = Math.max(1, ...values);
  return list
    .slice(0, 20)
    .map((v, i) => {
      const hot = Number(v.hot_value ?? 0);
      return {
        title: String(v.word ?? "").trim().slice(0, 160),
        platform: "抖音",
        url: null,
        heat: Math.max(35, Math.round((100 * hot) / max)),
        heatText: `抖音热榜 #${i + 1}${hot ? ` · ${fmtCount(hot)}热度` : ""}`,
        summary: "",
      };
    })
    .filter((x) => x.title);
}

const fetchers: Record<string, () => Promise<ParsedRadarItem[]>> = {
  B站: fetchBilibili,
  抖音: fetchDouyin,
};

/**
 * 抓某个平台的实时榜。
 * 官方接口优先，挂了就退到今日热榜；两边都有还是没有（小红书），返回 null 交给模型。
 */
export async function fetchHotlist(platform: string): Promise<ParsedRadarItem[] | null> {
  const p = platform.trim();
  const official = fetchers[p];
  if (official) {
    try {
      const items = await official();
      if (items.length > 0) return items;
    } catch (e) {
      if (!TOPHUB_NODES[p]) throw e;
    }
  }
  if (TOPHUB_NODES[p]) return fetchTophub(p);
  return null;
}
