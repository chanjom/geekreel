import { expect, test } from "bun:test";
import type { CharacterDossier, DramaBible } from "@vw/core";
import { bindEntitiesToShots, castLockLine, leadCharacterForShot, lockProductionIntoPrompt, pickShotRefImages, viewPrompt } from "./entities";

const wu: CharacterDossier = {
  id: "C01",
  name: "武松",
  identity: "行者",
  personality: "暴烈",
  appearance: "豹头环眼",
  outfit: "青布头巾",
  prompt: "武松",
  imageAssetId: "img-wu",
  views: [
    { kind: "face", assetId: "img-face" },
    { kind: "front", assetId: "img-front" },
  ],
};

const inn = { id: "S01", kind: "scene" as const, name: "酒店", prompt: "宋代酒旗", imageAssetId: "img-inn" };

const bible: DramaBible = {
  title: "武松",
  packId: null,
  substyle: null,
  palette: { note: "", colors: [] },
  assets: [inn],
  cast: [wu],
  episodes: [
    {
      index: 1,
      title: "第一集",
      synopsis: "",
      narrator: "",
      lastFrame: "",
      shots: [{ startSec: 0, endSec: 5, visual: "武松在酒店喝酒", line: "这酒好", imagePrompt: "武松举碗" }],
    },
  ],
};

test("点到的人和场景都写进锁定，每镜带上引用", () => {
  const bound = bindEntitiesToShots(bible);
  expect(bound.episodes[0]!.shots[0]!.entityIds).toEqual(["C01", "S01"]);
  const prompt = lockProductionIntoPrompt({
    prompt: "武松在酒店喝酒",
    bible: bound,
    entityIds: bound.episodes[0]!.shots[0]!.entityIds,
    dialogue: "这酒好",
  });
  expect(prompt).toContain("角色锁定「武松」");
  expect(prompt).toContain("场景锁定「酒店」");
});

test("没点名也强制带上主要实体", () => {
  const empty = bindEntitiesToShots({
    ...bible,
    episodes: [
      {
        ...bible.episodes[0]!,
        shots: [{ startSec: 0, endSec: 5, visual: "空镜", line: "", imagePrompt: "夜" }],
      },
    ],
  });
  expect(empty.episodes[0]!.shots[0]!.entityIds?.length).toBeGreaterThan(0);
});

test("参考图带上多视图", () => {
  expect(pickShotRefImages(bible, ["C01"])).toEqual(["img-face", "img-front", "img-wu"]);
});

test("定妆视图提示词按脸/正面/侧面分开", () => {
  expect(viewPrompt({ kind: "character", view: "face", name: "武松", prompt: "豹头" })).toContain("面部特写");
  expect(viewPrompt({ kind: "scene", view: "full", name: "酒店", prompt: "酒旗" })).toContain("没有人物");
});

const tiger: CharacterDossier = {
  id: "C03",
  name: "吊睛白额虎",
  identity: "猛兽",
  personality: "",
  appearance: "体型巨大，浅黄褐色毛，额头有白斑，金黄眼睛",
  outfit: "",
  prompt: "吊睛白额虎",
  imageAssetId: null,
};

test("镜里点到谁就钉谁的外貌配色，动物用俗称也能命中", () => {
  const cast = [wu, tiger];
  const hit = castLockLine({ cast, assets: [inn] }, "老虎翻滚，尘土飞扬");
  expect(hit).toContain("角色锁定「吊睛白额虎」");
  expect(hit).toContain("浅黄褐色毛");
  expect(hit).toContain("不许改");
  const scene = castLockLine({ cast, assets: [inn] }, "武松走进酒店");
  expect(scene).toContain("角色锁定「武松」");
  expect(scene).toContain("场景锁定「酒店」");
});

test("空镜不硬塞人物锁定", () => {
  expect(castLockLine({ cast: [wu, tiger], assets: [inn] }, "远山如黛，酒旗猎猎")).toBe("");
});

test("档案漏写毛色时按物种补一句，老虎不会一镜一个色", () => {
  const plain: CharacterDossier = { ...tiger, appearance: "体长六尺，额头有白色王字斑纹，金黄色瞳孔" };
  const line = castLockLine({ cast: [plain], assets: [] }, "老虎扑来");
  expect(line).toContain("毛色固定为橘黄底黑色横纹");
  const stated: CharacterDossier = { ...tiger, appearance: "毛色橘黄，黑色横纹" };
  expect(castLockLine({ cast: [stated], assets: [] }, "老虎扑来")).not.toContain("毛色固定为");
});

test("这一镜谁在画面里，就以谁的脸为准", () => {
  const girl: CharacterDossier = { ...wu, id: "C02", name: "红裙小女孩", imageAssetId: "img-girl" };
  const bible: DramaBible = { cast: [wu, girl], assets: [] } as DramaBible;
  const shot = { entityIds: ["C01", "C02"], visual: "小女孩伸手接过餐盒", line: "谢谢叔叔" };
  expect(leadCharacterForShot(bible, shot)?.id).toBe("C02");
  expect(leadCharacterForShot(bible, { entityIds: ["C01"], visual: "武松提棍上冈" })?.id).toBe("C01");
  // 都不点名就退回演员表第一个，不乱猜
  expect(leadCharacterForShot(bible, { entityIds: ["C02", "C01"], visual: "冈上血泊" })?.id).toBe("C01");
});
