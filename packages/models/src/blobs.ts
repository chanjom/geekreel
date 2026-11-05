export type ImageBlob = { mime: string; data: Uint8Array };

export interface ImageGenRequest {
  prompt: string;
  size?: string;
  signal?: AbortSignal;
  refs?: ImageBlob[];
}

export interface VideoGenRequest {
  prompt: string;
  durationSec?: number;
  signal?: AbortSignal;
  image?: ImageBlob;
  lastFrame?: ImageBlob;
  refs?: ImageBlob[];
  dialogue?: string;
  audio?: boolean;
  voice?: ImageBlob;
}

/** 首帧 + 尾帧 + 主体库，去重后最多 9 张。 */
export function collectVideoImages(req: { image?: ImageBlob; lastFrame?: ImageBlob; refs?: ImageBlob[] }): ImageBlob[] {
  const out: ImageBlob[] = [];
  const seen = new Set<number>();
  for (const img of [req.image, req.lastFrame, ...(req.refs ?? [])]) {
    if (!img?.data?.length) continue;
    const mid = img.data[Math.floor(img.data.length / 2)] ?? 0;
    const key = img.data.length * 104729 + (img.data[0] ?? 0) * 257 + mid * 17 + (img.data[img.data.length - 1] ?? 0);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
    if (out.length >= 9) break;
  }
  return out;
}

/**
 * 同上，但带上每张图的 role。方舟（Seedance）在收到两张以上图片时，
 * 必须逐张说明这是首帧、尾帧还是参考图，否则整个请求 400。
 * 只有一张时不带 role——部分模型不认这个字段。
 */
export function collectVideoImagesWithRoles(req: {
  image?: ImageBlob;
  lastFrame?: ImageBlob;
  refs?: ImageBlob[];
}): Array<{ image: ImageBlob; role?: "first_frame" | "last_frame" | "reference_image" }> {
  const out: Array<{ image: ImageBlob; role?: "first_frame" | "last_frame" | "reference_image" }> = [];
  const seen = new Set<number>();
  const push = (img: ImageBlob | undefined, role: "first_frame" | "last_frame" | "reference_image") => {
    if (!img?.data?.length) return;
    const mid = img.data[Math.floor(img.data.length / 2)] ?? 0;
    const key = img.data.length * 104729 + (img.data[0] ?? 0) * 257 + mid * 17 + (img.data[img.data.length - 1] ?? 0);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ image: img, role });
  };
  push(req.image, "first_frame");
  push(req.lastFrame, "last_frame");
  for (const img of req.refs ?? []) push(img, "reference_image");
  const kept = out.slice(0, 9);
  return kept.length > 1 ? kept : kept.map((x) => ({ image: x.image }));
}
