import { describe, expect, test } from "bun:test";
import { agnesImageParams, isAgnes } from "./agnesImage";

describe("isAgnes", () => {
  test("识别 agnes 域名", () => {
    expect(isAgnes("https://apihub.agnes-ai.com/v1")).toBe(true);
    expect(isAgnes("https://apihub.agnes-ai.cn/v1")).toBe(true);
  });

  test("不误伤其他厂商", () => {
    expect(isAgnes("https://open.bigmodel.cn/api/paas/v4")).toBe(false);
    expect(isAgnes("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(false);
    expect(isAgnes("https://api.openai.com/v1")).toBe(false);
  });
});

describe("agnesImageParams", () => {
  test("竖版 1024x1536 → 2:3 比例", () => {
    expect(agnesImageParams("1024x1536")).toEqual({ size: "2K", ratio: "2:3" });
  });

  test("横版 1280x720 → 16:9 比例", () => {
    expect(agnesImageParams("1280x720")).toEqual({ size: "1K", ratio: "16:9" });
  });

  test("方图 1024x1024 → 1:1", () => {
    expect(agnesImageParams("1024x1024")).toEqual({ size: "1K", ratio: "1:1" });
  });

  test("9:16 竖屏手机比例", () => {
    expect(agnesImageParams("720x1280").ratio).toBe("9:16");
  });

  test("超宽 21:9", () => {
    expect(agnesImageParams("2560x1097").ratio).toBe("21:9");
  });

  test("4K 长边落 4K 档", () => {
    expect(agnesImageParams("3840x2160").size).toBe("4K");
  });

  test("没有尺寸时给默认值", () => {
    expect(agnesImageParams(undefined)).toEqual({ size: "2K", ratio: "1:1" });
  });

  test("尺寸写坏时不抛错", () => {
    expect(agnesImageParams("abc")).toEqual({ size: "2K", ratio: "1:1" });
  });

  test("显式档位优先", () => {
    expect(agnesImageParams("1024x1536", "4K").size).toBe("4K");
  });

  test("乘号写法也能解析", () => {
    expect(agnesImageParams("1280×720").ratio).toBe("16:9");
  });
});
