import { expect, test } from "bun:test";
import { pickVideoUrl } from "./coze";

test("工作流直接吐出 mp4 链接", () => {
  expect(pickVideoUrl("https://oss.example.com/a/b.mp4")).toBe("https://oss.example.com/a/b.mp4");
});

test("输出是转义过的 JSON 字符串也能抠出来", () => {
  // 扣子的 output 常常是 JSON 里再套一层 JSON，链接前后带 \"
  const out = JSON.stringify({ Output: JSON.stringify({ video_url: "https://x.com/t.mp4?sig=abc" }) });
  expect(pickVideoUrl(out)).toBe("https://x.com/t.mp4?sig=abc");
});

test("输出成数组、带说明文字也能抠出来", () => {
  const out = '你可以直接提取到有效URL如下:\n```\n["https://oss.miheai.com/temp/d1c0.mp4"]\n```';
  expect(pickVideoUrl(out)).toBe("https://oss.miheai.com/temp/d1c0.mp4");
});

test("先出现图片再出现视频时取视频，不是抓到 jpg 就返回", () => {
  const out = '{"cover":"https://x.com/c.jpg","video":"https://x.com/v.mp4"}';
  expect(pickVideoUrl(out)).toBe("https://x.com/v.mp4");
});

test("啥也没有就返回 null，别硬编一个地址", () => {
  expect(pickVideoUrl("")).toBeNull();
  expect(pickVideoUrl('{"Output":"生成失败"}')).toBeNull();
});
