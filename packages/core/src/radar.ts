/**
 * 热点雷达 + 推送：前后端共享类型。
 * 热度统一折成 0–100：B站/抖音 来自官方榜单原始值，其余平台是模型估计，UI 必须标注口径。
 */

export type RadarSourceKind = "ai-query" | "rss" | "http-api";

export interface RadarSource {
  id: string;
  name: string;
  kind: RadarSourceKind;
  platform: string;
  queryTemplate: string;
  intervalMinutes: number;
  endpointId: string | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface RadarItem {
  id: string;
  sourceId: string;
  title: string;
  platform: string;
  url: string | null;
  /** 0–100，AI 估计 */
  heat: number;
  heatText: string;
  summary: string;
  hash: string;
  fetchedAt: number;
  /** 最近一次再次被抓到的时刻（去重命中时刷新），老数据可能为空 */
  lastSeenAt?: number;
}

export type RadarSort = "heat" | "time";

/** 每个平台的抓取情况，用来在页签上显示条数与新鲜度 */
export interface RadarPlatformStat {
  platform: string;
  sourceId: string;
  sourceName: string;
  lastRunAt: number | null;
  lastError: string | null;
  /** 该平台当前在榜的条数 */
  count: number;
  /** 该平台最近一条热点的抓取时刻 */
  latestAt: number | null;
  /** 数据来源：直连官方榜单 / 模型联网查 / 自建 RSS 接口 */
  via: "hotlist" | "ai" | "feed";
}

export const radarPlatformColors: Record<string, string> = {
  微博: "#e8543f",
  抖音: "#3ec7c2",
  B站: "#4ea8f7",
  知乎: "#5b8def",
  小红书: "#f0556a",
};

export function platformColor(platform: string): string {
  return radarPlatformColors[platform.trim()] ?? "#8a909e";
}

/** 热度分档，用于配色 */
export function heatTier(heat: number): "hot" | "warm" | "cool" {
  if (heat >= 80) return "hot";
  if (heat >= 60) return "warm";
  return "cool";
}

/** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 2 天前 */
export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "还没抓过";
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return `${Math.floor(day / 30)} 个月前`;
}

export interface RadarSub {
  id: string;
  keyword: string;
  /** 空数组 = 不限平台 */
  platforms: string[];
  heatThreshold: number;
  /** 免打扰开始小时 0–23；与 quietEnd 组成区间，可跨夜 */
  quietStart: number | null;
  quietEnd: number | null;
  channelIds: string[];
  enabled: boolean;
  createdAt: number;
}

export type PushChannelType = "webhook" | "serverchan" | "telegram" | "bark" | "email";

export const pushChannelLabels: Record<PushChannelType, string> = {
  webhook: "Webhook",
  serverchan: "Server酱",
  telegram: "Telegram",
  bark: "Bark",
  email: "邮件",
};

export interface PushChannel {
  id: string;
  type: PushChannelType;
  name: string;
  config: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

export interface PushLog {
  id: string;
  subId: string | null;
  channelId: string;
  title: string;
  status: "sent" | "failed";
  error: string | null;
  createdAt: number;
}

export interface RadarSettings {
  digestEnabled: boolean;
  digestHour: number;
  lastDigestDate: string | null;
}

export const intervalPresets: Array<{ minutes: number; label: string }> = [
  { minutes: 30, label: "每半小时" },
  { minutes: 60, label: "每小时" },
  { minutes: 360, label: "每 6 小时" },
  { minutes: 1440, label: "每天一次" },
];

/** 模型经常编造帖子链接。原文一律去该平台搜这条话题。 */
export function topicQuery(title: string): string {
  return title.replace(/#/g, "").replace(/\s+/g, " ").trim() || title.trim();
}

export function topicSearchUrl(platform: string, title: string): string {
  const q = topicQuery(title);
  const enc = encodeURIComponent(q);
  switch (platform.trim()) {
    case "微博": {
      const weiboQ = /#.+#/.test(title) ? title.trim() : q;
      return `https://s.weibo.com/weibo?q=${encodeURIComponent(weiboQ)}`;
    }
    case "抖音":
      return `https://www.douyin.com/search/${enc}`;
    case "B站":
      return `https://search.bilibili.com/all?keyword=${enc}`;
    case "知乎":
      return `https://www.zhihu.com/search?type=content&q=${enc}`;
    case "小红书":
      return `https://www.xiaohongshu.com/search_result?keyword=${enc}`;
    default:
      return `https://www.bing.com/search?q=${encodeURIComponent(`${platform} ${q}`)}`;
  }
}
