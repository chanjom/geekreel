import { expect, test } from "bun:test";
import { applyShotLanguage, inferCameraMove, inferShotSize, parseShotSize, shotLanguageLine, videoMotionLine } from "./shotLang";
import { parseShotQa, shouldRetryQa } from "./qa";
import { matchLibraryEntity } from "./libraryMatch";
import { suggestSfxCue } from "./sfx";
import type { DramaBible } from "@vw/core";

test("画面里的特写推近写成镜头语言", () => {
  expect(inferShotSize("武松面部特写")).toBe("cu");
  expect(parseShotSize("全景")).toBe("fs");
  expect(parseShotSize("大远景")).toBe("els");
  expect(parseShotSize("远景")).toBe("ls");
  expect(shotLanguageLine({ shotSize: "cu", cameraMove: "push", angle: "low" })).toContain("特写");
  expect(shotLanguageLine({ shotSize: "cu", cameraMove: "push", angle: "low" })).toContain("推进");
});

test("没写景别就从画面补上", () => {
  const bible: DramaBible = {
    title: "武松",
    packId: null,
    substyle: null,
    palette: { note: "", colors: [] },
    assets: [],
    episodes: [
      {
        index: 1,
        title: "一",
        synopsis: "",
        narrator: "",
        lastFrame: "",
        shots: [{ startSec: 0, endSec: 5, visual: "酒店门口全身站着", line: "", imagePrompt: "推进到脸上" }],
      },
    ],
  };
  const next = applyShotLanguage(bible);
  expect(next.episodes[0]!.shots[0]!.shotSize).toBe("fs");
  expect(next.episodes[0]!.shots[0]!.cameraMove).toBe("push");
});

test("质检 JSON 漂了就打回", () => {
  const qa = parseShotQa('{"ok":false,"score":0.2,"note":"漂脸了"}');
  expect(qa.ok).toBe(false);
  expect(shouldRetryQa(qa)).toBe(true);
  expect(shouldRetryQa({ ...qa, retries: 1 })).toBe(false);
});

test("资产库按名字对上定妆视图", () => {
  const hit = matchLibraryEntity({
    name: "武松",
    kind: "character",
    assets: [
      { id: "a1", title: "武松脸", kind: "character" },
      { id: "a2", title: "武松侧面", kind: "character" },
    ],
  });
  expect(hit?.views.map((v) => v.kind)).toEqual(["face", "side"]);
});

test("喝酒画面给出酒碗音效", () => {
  expect(suggestSfxCue("武松举碗喝酒", "这酒好")).toBe("酒碗");
  expect(suggestSfxCue("空镜夜色")).toBeNull();
});

test("没写运镜时默认推进，不再默认固定机位", () => {
  // 固定机位图生视频出来就是会呼吸的静止图，一集三镜全是它就是 PPT。
  expect(inferCameraMove("外卖员站在小区门口，手里提着箱子")).toBe("push");
  expect(inferCameraMove("画面定格，最后一格静止")).toBe("static");
  expect(inferCameraMove("镜头跟上去")).toBe("follow");
});

test("视频提示词要求动起来，而不是描述长什么样", () => {
  const line = videoMotionLine({ shotSize: "ms", cameraMove: "push", angle: "eye", line: "" });
  expect(line).toContain("推进");
  expect(line).toContain("不是图片");
  expect(line).toContain("起势");
  // 没台词就别要求嘴型，免得模型开始瞎张嘴
  expect(line).not.toContain("嘴型");
});

test("有台词时要求嘴型跟上，固定机位也要人在动", () => {
  const talking = videoMotionLine({ cameraMove: "static", line: "又是你这个底层垃圾" });
  expect(talking).toContain("机位固定");
  expect(talking).toContain("必须真的在做事");
  expect(talking).toContain("嘴型");
});
