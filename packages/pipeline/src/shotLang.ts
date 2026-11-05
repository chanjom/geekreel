/**
 * 分镜镜头语言：景别、运镜、机位。没写就从画面推断，出图时写进提示词。
 */

import type { CameraAngle, CameraMove, DramaBible, DramaShot, ShotSize } from "@vw/core";
import { cameraAngleLabels, cameraMoveLabels, shotSizeLabels } from "@vw/core";

export function parseShotSize(raw: unknown): ShotSize | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "ecu" || s.includes("大特写")) return "ecu";
  if (s === "cu" || s.includes("特写")) return "cu";
  if (s === "ms" || s.includes("中景")) return "ms";
  if (s === "fs" || s.includes("全景") || s.includes("全身")) return "fs";
  if (s === "els" || s.includes("大远景")) return "els";
  if (s === "ls" || s.includes("远景")) return "ls";
  return undefined;
}

export function parseCameraMove(raw: unknown): CameraMove | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "static" || s.includes("固定") || s.includes("静止")) return "static";
  if (s === "push" || s.includes("推进") || s.includes("推近")) return "push";
  if (s === "pull" || s.includes("拉远") || s.includes("拉开")) return "pull";
  if (s === "pan" || s.includes("横摇") || s.includes("摇镜")) return "pan";
  if (s === "tilt" || s.includes("俯仰")) return "tilt";
  if (s === "follow" || s.includes("跟随") || s.includes("跟上")) return "follow";
  if (s === "orbit" || s.includes("环绕")) return "orbit";
  return undefined;
}

export function parseCameraAngle(raw: unknown): CameraAngle | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "eye" || s.includes("平视")) return "eye";
  if (s === "high" || s.includes("俯拍") || s.includes("俯视")) return "high";
  if (s === "low" || s.includes("仰拍") || s.includes("仰视")) return "low";
  if (s === "over" || s.includes("过肩")) return "over";
  return undefined;
}

export function inferShotSize(text: string): ShotSize {
  if (/大特写|瞳孔|嘴唇|眼白/.test(text)) return "ecu";
  if (/特写|面部|脸部|手部/.test(text)) return "cu";
  if (/大远景|天际|全城|山河/.test(text)) return "els";
  if (/远景|空镜|远眺/.test(text)) return "ls";
  if (/全景|全身|门口|站在/.test(text)) return "fs";
  return "ms";
}

export function inferCameraMove(text: string): CameraMove {
  if (/推进|推近|走近|逼近/.test(text)) return "push";
  if (/拉远|拉开|退后/.test(text)) return "pull";
  if (/横摇|摇过|横扫/.test(text)) return "pan";
  if (/俯仰|抬头|低头/.test(text)) return "tilt";
  if (/跟随|追上|跟上|追着|追出去/.test(text)) return "follow";
  if (/环绕|绕着|转一圈/.test(text)) return "orbit";
  if (/固定|静止|定格|不动|空镜/.test(text)) return "static";
  // 没线索时别再默认固定。固定机位图生视频出来就是「会呼吸的静止图」，
  // 一集三镜全是它，观感就是 PPT。默认给一个缓慢推进，画面至少有层次变化。
  return "push";
}

export function inferCameraAngle(text: string): CameraAngle {
  if (/俯拍|俯视|从上往下/.test(text)) return "high";
  if (/仰拍|仰视|从下往上/.test(text)) return "low";
  if (/过肩|肩后/.test(text)) return "over";
  return "eye";
}

export function applyShotLanguage(bible: DramaBible): DramaBible {
  return {
    ...bible,
    episodes: bible.episodes.map((ep) => ({
      ...ep,
      shots: ep.shots.map((shot) => fillShotLanguage(shot)),
    })),
  };
}

export function fillShotLanguage(shot: DramaShot): DramaShot {
  const hay = `${shot.visual}\n${shot.imagePrompt}\n${shot.line}`;
  return {
    ...shot,
    shotSize: shot.shotSize ?? parseShotSize(shot.shotSize) ?? inferShotSize(hay),
    cameraMove: shot.cameraMove ?? parseCameraMove(shot.cameraMove) ?? inferCameraMove(hay),
    angle: shot.angle ?? parseCameraAngle(shot.angle) ?? inferCameraAngle(hay),
  };
}

export function shotLanguageLine(shot?: Pick<DramaShot, "shotSize" | "cameraMove" | "angle"> | null): string {
  if (!shot?.shotSize && !shot?.cameraMove && !shot?.angle) return "";
  const size = shot.shotSize ? shotSizeLabels[shot.shotSize] : "中景";
  const move = shot.cameraMove ? cameraMoveLabels[shot.cameraMove] : "推进";
  const angle = shot.angle ? cameraAngleLabels[shot.angle] : "平视";
  return `镜头语言：${size}，${move}，${angle}。按这个景别和运镜拍，不要自己改成别的。`;
}

/**
 * 视频提示词里必须单独写「要动起来」。
 *
 * 分镜的 imagePrompt 是给画图用的静态描述（「谁+在哪+做什么」，40 字内），
 * 拿它直接喂图生视频，模型只会让画面轻轻呼吸，五秒下来人物没挪窝 ——
 * 这就是「PPT 感」。静态描述和运动指令是两件事，不能共用一段文本。
 */
export function videoMotionLine(shot?: Pick<DramaShot, "shotSize" | "cameraMove" | "angle" | "visual" | "line"> | null): string {
  const move = shot?.cameraMove ?? "push";
  const fixed = move === "static";
  const camera = fixed
    ? "机位固定不动，但画面里的人必须真的在做事（走、转身、抬手、放东西、回头），不要只有呼吸和眨眼。"
    : `机位${cameraMoveLabels[move]}，全程持续，不要推到一半停住，也不要忽快忽慢。`;
  const talk = shot?.line?.trim()
    ? "说话时要看得到开口、闭口、换气的连贯过程，嘴型跟着这句话走，不要抿着嘴念台词。"
    : "";
  return [
    "这是视频，不是图片：人物和身体要有看得懂的连续动作，不许几乎静止。",
    camera,
    "一个镜头里完成一个完整动作：起势、过程、收势都要占时间，不要一秒就摆好姿势等结束。",
    talk,
  ]
    .filter(Boolean)
    .join("\n");
}
