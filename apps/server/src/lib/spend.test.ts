import { describe, expect, test } from "bun:test";
import { FALLBACK_PRICE, estimateYuan, sumSpend, type UsageRow } from "./spend";

function row(part: Partial<UsageRow>): UsageRow {
  return { capability: "llm", promptTokens: 0, completionTokens: 0, images: 0, audioChars: 0, videoSec: 0, cost: 0, ...part };
}

describe("estimateYuan", () => {
  test("图片按张算", () => {
    expect(estimateYuan(row({ capability: "image", images: 4 }))).toBeCloseTo(4 * FALLBACK_PRICE.image, 6);
  });

  test("视频按秒算", () => {
    expect(estimateYuan(row({ capability: "video", videoSec: 15 }))).toBeCloseTo(15 * FALLBACK_PRICE.video, 6);
  });

  test("语音按千字算", () => {
    expect(estimateYuan(row({ capability: "tts", audioChars: 2500 }))).toBeCloseTo(2.5 * FALLBACK_PRICE.ttsKChar, 6);
  });

  test("文本按 prompt + completion 两段算", () => {
    const yuan = estimateYuan(row({ promptTokens: 2000, completionTokens: 500 }));
    expect(yuan).toBeCloseTo(2 * FALLBACK_PRICE.promptKToken + 0.5 * FALLBACK_PRICE.completionKToken, 6);
  });

  test("什么都没用就是 0", () => {
    expect(estimateYuan(row({}))).toBe(0);
  });
});

describe("sumSpend", () => {
  test("空表是 0，不算估", () => {
    expect(sumSpend([])).toEqual({ cents: 0, estimated: false });
  });

  test("全部填了单价：用真实值，不标估", () => {
    const out = sumSpend([row({ capability: "image", images: 4, cost: 0.8 }), row({ cost: 1.2 })]);
    expect(out).toEqual({ cents: 200, estimated: false });
  });

  test("一条没填单价就整体标估", () => {
    const out = sumSpend([row({ capability: "image", images: 2, cost: 0.5 }), row({ capability: "video", videoSec: 10 })]);
    // 0.5 真实 + 10×0.12 估算 = 1.7 元
    expect(out).toEqual({ cents: 170, estimated: true });
  });

  test("元转分四舍五入，不把 0.333 记成 0", () => {
    const out = sumSpend([row({ capability: "video", videoSec: 1, cost: 0.333 })]);
    expect(out.cents).toBe(33);
    expect(out.estimated).toBe(false);
  });

  test("典型一部片子：3 张图 + 6 镜 15 秒 + 一段旁白", () => {
    const out = sumSpend([
      row({ capability: "image", images: 3 }),
      row({ capability: "video", videoSec: 12 }),
      row({ capability: "tts", audioChars: 800 }),
      row({ promptTokens: 3000, completionTokens: 900 }),
    ]);
    // 0.75 + 1.44 + 0.016 + 0.0132 ≈ 2.22 元
    expect(out.cents).toBe(222);
    expect(out.estimated).toBe(true);
  });
});
