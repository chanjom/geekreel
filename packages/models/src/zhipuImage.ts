/**
 * 智谱（BigModel）图片尺寸归一化。
 *
 * 智谱的 /images/generations 只接受固定枚举尺寸，传任意宽高会直接 400。
 * 而画布与流水线默认传的是 1024x1536 这类自由尺寸，所以必须按宽高比就近映射。
 * 与 dashscopeImageSize 同一思路：保留调用方想要的构图比例，只换尺寸。
 */

export function isZhipu(baseUrl: string): boolean {
  return /bigmodel\.cn/i.test(baseUrl);
}

/** cogview-3-flash / cogview-4 系列支持的枚举尺寸（官方文档）。 */
const COGVIEW_SIZES = [
  "1024x1024",
  "1344x768",
  "1152x864",
  "1440x720",
  "768x1344",
  "864x1152",
  "720x1440",
];

/** glm-image 系列的枚举尺寸（更大一档）。 */
const GLM_IMAGE_SIZES = [
  "1280x1280",
  "1568x1056",
  "1472x1088",
  "1728x960",
  "1056x1568",
  "1088x1472",
  "960x1728",
];

/**
 * 把任意 "宽x高" 映射到智谱枚举尺寸中宽高比最接近的一个。
 * 比例是乘性量纲，所以用 log 距离比较，避免 2:1 与 1:2 被算成同样远。
 */
export function zhipuImageSize(model: string, size?: string): string {
  const table = /glm-image/i.test(model) ? GLM_IMAGE_SIZES : COGVIEW_SIZES;
  const raw = (size ?? "1024x1024").replace(/[*×]/g, "x").toLowerCase();
  const [ws, hs] = raw.split("x");
  const w = Number(ws);
  const h = Number(hs);
  if (!(w > 0 && h > 0)) return table[0]!;

  const target = Math.log(w / h);
  let best = table[0]!;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of table) {
    const [cw = 1, ch = 1] = candidate.split("x").map(Number);
    const diff = Math.abs(Math.log(cw / ch) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}
