/**
 * 花了多少钱：端点填了单价就用真实 cost，没填就按公开价兜底估。
 *
 * 为什么要有兜底：`model_usage.cost` 只有在端点里填了单价才算得出来，而绝大多数人
 * 不会填。不估的话 spent 恒为 0，预算护栏等于没有 —— 这正是之前"预算 20 元、
 * 实际随便烧"的原因。估出来的值会带 estimated 标记，前端显示成 ≈¥x.xx。
 */

export interface UsageRow {
  capability: string;
  promptTokens: number;
  completionTokens: number;
  images: number;
  audioChars: number;
  videoSec: number;
  cost: number;
}

/** 公开价兜底（元）。宁可估高一点，让护栏早一点拦。 */
export const FALLBACK_PRICE = {
  /** 元 / 张 */
  image: 0.25,
  /** 元 / 秒 */
  video: 0.12,
  /** 元 / 千字 */
  ttsKChar: 0.02,
  /** 元 / 千 prompt token */
  promptKToken: 0.002,
  /** 元 / 千 completion token */
  completionKToken: 0.008,
} as const;

/** 单条用量的兜底估价（元） */
export function estimateYuan(r: UsageRow): number {
  if (r.capability === "image") return r.images * FALLBACK_PRICE.image;
  if (r.capability === "video") return r.videoSec * FALLBACK_PRICE.video;
  if (r.capability === "tts") return (r.audioChars / 1000) * FALLBACK_PRICE.ttsKChar;
  return (
    (r.promptTokens / 1000) * FALLBACK_PRICE.promptKToken +
    (r.completionTokens / 1000) * FALLBACK_PRICE.completionKToken
  );
}

/**
 * 汇总一批用量。
 * - 有真实 cost 的按真实算，一条都不估 → estimated=false
 * - 只要有一条是估的 → estimated=true（金额仍以真实部分优先）
 */
export function sumSpend(rows: UsageRow[]): { cents: number; estimated: boolean } {
  let yuan = 0;
  let estimated = false;
  for (const r of rows) {
    if (r.cost > 0) {
      yuan += r.cost;
      continue;
    }
    estimated = true;
    yuan += estimateYuan(r);
  }
  return { cents: Math.round(yuan * 100), estimated };
}
