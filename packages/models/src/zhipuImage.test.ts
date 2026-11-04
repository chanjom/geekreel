import { describe, expect, test } from "bun:test";
import { isZhipu, zhipuImageSize } from "./zhipuImage";

describe("isZhipu", () => {
  test("识别智谱域名", () => {
    expect(isZhipu("https://open.bigmodel.cn/api/paas/v4")).toBe(true);
  });
  test("不误判其它厂商", () => {
    expect(isZhipu("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(false);
    expect(isZhipu("https://api.openai.com/v1")).toBe(false);
  });
});

describe("zhipuImageSize", () => {
  test("方图原样保留", () => {
    expect(zhipuImageSize("cogview-3-flash", "1024x1024")).toBe("1024x1024");
  });

  test("竖版 2:3（流水线默认）落到 3:4", () => {
    // 1024x1536 = 0.667，最近的枚举值是 864x1152 = 0.75
    expect(zhipuImageSize("cogview-3-flash", "1024x1536")).toBe("864x1152");
  });

  test("横版 16:9 落到 1344x768", () => {
    expect(zhipuImageSize("cogview-3-flash", "1280x720")).toBe("1344x768");
  });

  test("超宽 2:1 落到 1440x720", () => {
    expect(zhipuImageSize("cogview-3-flash", "1600x800")).toBe("1440x720");
  });

  test("结果始终在枚举表内", () => {
    const table = new Set([
      "1024x1024", "1344x768", "1152x864", "1440x720",
      "768x1344", "864x1152", "720x1440",
    ]);
    for (const s of ["1x1", "300x900", "4096x512", "1024x1536", "abc", ""]) {
      expect(table.has(zhipuImageSize("cogview-3-flash", s))).toBe(true);
    }
  });

  test("glm-image 走自己那套更大的枚举", () => {
    expect(zhipuImageSize("glm-image", "1280x720")).toBe("1728x960");
    expect(zhipuImageSize("glm-image", "1024x1024")).toBe("1280x1280");
  });

  test("星号与乘号写法都认", () => {
    expect(zhipuImageSize("cogview-3-flash", "1024*1536")).toBe("864x1152");
    expect(zhipuImageSize("cogview-3-flash", "1280×720")).toBe("1344x768");
  });
});
