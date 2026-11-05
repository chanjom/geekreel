import { expect, test } from "bun:test";
import { qaReviewPrompt, shouldRetryQa } from "./qa";

test("质检只看人、衣服、场景，不拿口型判死", () => {
  const prompt = qaReviewPrompt({ visual: "陈默提餐走在昏暗楼道", lock: "同一张脸" });
  expect(prompt).toContain("不看口型");
  expect(prompt).toContain("陈默提餐走在昏暗楼道");
});

test("同一镜最多重做一次，别把额度烧在返工上", () => {
  expect(shouldRetryQa({ ok: false, score: 0.2, note: "", retries: 0 })).toBe(true);
  expect(shouldRetryQa({ ok: false, score: 0.2, note: "", retries: 1 })).toBe(false);
  expect(shouldRetryQa({ ok: true, score: 0.9, note: "", retries: 0 })).toBe(false);
});
