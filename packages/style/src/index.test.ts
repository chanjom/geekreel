import { expect, test } from "bun:test";
import type { PaletteDoc } from "@vw/core";
import { discoverStylePacks, injectImagePrompt, paletteLine } from "./index";

test("扫描到上美影和白板包", () => {
  const packs = discoverStylePacks();
  const ids = packs.map((p) => p.public.id);
  expect(ids).toContain("smy-animation");
  expect(ids).toContain("whiteboard");
  const smy = packs.find((p) => p.public.id === "smy-animation")!;
  expect(smy.public.ready).toBe(true);
  expect(smy.public.substyles.length).toBeGreaterThanOrEqual(3);
  const board = packs.find((p) => p.public.id === "whiteboard")!;
  expect(board.public.ready).toBe(true);
  expect(board.public.requiredCapabilities).toEqual([]);
  expect(board.styleBlock).toContain("纸");
});

test("色盘与风格块强制注入", () => {
  const pack = discoverStylePacks().find((p) => p.public.id === "smy-animation")!;
  const palette: PaletteDoc = {
    note: "",
    colors: [{ name: "朱砂", hex: "#C23A2B", role: "主" }],
  };
  const out = injectImagePrompt({ pack, raw: "武松打虎近景", palette, substyle: "flat" });
  expect(out).toContain("武松打虎近景");
  expect(out).toContain("#C23A2B");
  expect(out).toContain("2D");
  expect(paletteLine(palette)).toContain("朱砂");
});

test("白板提示词注入纸底约束", () => {
  const pack = discoverStylePacks().find((p) => p.public.id === "whiteboard")!;
  const out = injectImagePrompt({ pack, raw: "先把问题画成三步", palette: { note: "", colors: [{ name: "宣纸", hex: "#F5EBD7", role: "底" }] } });
  expect(out).toContain("先把问题画成三步");
  expect(out).toContain("#F5EBD7");
  expect(out).toContain("线稿");
});

test("分镜用场景档硬约束，不再要求大面积留白", () => {
  const pack = discoverStylePacks().find((p) => p.public.id === "smy-animation")!;
  const sheet = injectImagePrompt({ pack, raw: "武松定妆", variant: "character" });
  const scene = injectImagePrompt({ pack, raw: "武松醉卧青石", variant: "scene" });
  expect(sheet).toContain("大面积留白");
  expect(scene).not.toContain("大面积留白");
  expect(scene).toContain("禁止大面积纯色空白底");
  expect(scene).toContain("武松醉卧青石");
});

test("缺场景档文件的包回落到原硬约束", () => {
  const pack = discoverStylePacks().find((p) => p.public.id === "whiteboard")!;
  expect(pack.hardConstraintScene).toBe(pack.hardConstraint);
  expect(injectImagePrompt({ pack, raw: "三步法", variant: "scene" })).toContain("线稿");
});

test("角色锁定插在风格块和原文之间", () => {
  const pack = discoverStylePacks().find((p) => p.public.id === "smy-animation")!;
  const out = injectImagePrompt({
    pack,
    raw: "老虎扑来",
    variant: "scene",
    castLock: "角色锁定「吊睛白额虎」：浅黄褐毛色，黑纹。",
  });
  const lines = out.split("\n");
  expect(lines.indexOf("老虎扑来")).toBeGreaterThan(lines.findIndex((l) => l.startsWith("角色锁定")));
  expect(out).toContain("浅黄褐毛色");
});
