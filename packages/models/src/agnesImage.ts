/**
 * Agnes（apihub.agnes-ai.com）图片参数归一化。
 *
 * Agnes 的 /v1/images/generations 不接受自由宽高，size 只认 1K / 2K / 3K / 4K 四档，
 * 构图比例要单独放在 ratio 字段（1:1、3:4、4:3、16:9、9:16、2:3、3:2、21:9）。
 * 而画布与流水线传的是 1024x1536 这类自由尺寸，直接透传会 400，
 * 所以这里把自由宽高拆成「分辨率档位 + 最接近的比例」。
 * 与 zhipuImageSize / dashscopeImageSize 同一思路。
 */

export function isAgnes(baseUrl: string): boolean {
  return /agnes-ai/i.test(baseUrl);
}

/** Agnes 官方文档给出的比例枚举。 */
const AGNES_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];

/** 分辨率档位：按请求的长边落档，保证不比调用方要求的更糊。 */
function tierForLongEdge(longEdge: number): string {
  if (longEdge >= 3000) return "4K";
  if (longEdge >= 2000) return "3K";
  if (longEdge >= 1400) return "2K";
  return "1K";
}

export interface AgnesImageParams {
  size: string;
  ratio: string;
}

/**
 * 把任意 "宽x高" 转成 Agnes 要的 { size, ratio }。
 * 比例是乘性量纲，用 log 距离比较，避免 2:1 与 1:2 被算成同样远。
 */
export function agnesImageParams(size?: string, sizeTier?: string): AgnesImageParams {
  const raw = (size ?? "").replace(/[*×]/g, "x").toLowerCase();
  const [ws, hs] = raw.split("x");
  const w = Number(ws);
  const h = Number(hs);

  // 调用方没给尺寸：给一个够用又便宜的默认值。
  if (!(w > 0 && h > 0)) {
    return { size: sizeTier || "2K", ratio: "1:1" };
  }

  const target = Math.log(w / h);
  let best = AGNES_RATIOS[0]!;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of AGNES_RATIOS) {
    const [cw = 1, ch = 1] = candidate.split(":").map(Number);
    const diff = Math.abs(Math.log(cw / ch) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }

  return { size: sizeTier || tierForLongEdge(Math.max(w, h)), ratio: best };
}
