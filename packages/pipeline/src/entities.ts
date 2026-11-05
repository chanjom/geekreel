/**
 * 角色 / 场景 / 道具实体：多视图、每镜强制引用、跨集沿用。
 */

import type {
  CharacterDossier,
  DramaAssetItem,
  DramaBible,
  DramaShot,
  EntityKind,
  EntityView,
  EntityViewKind,
} from "@vw/core";
import { lockCastIntoPrompt } from "./lock";
import { shotLanguageLine } from "./shotLang";

export const VIEW_LABEL: Record<EntityViewKind, string> = {
  face: "脸",
  front: "正面",
  side: "侧面",
  full: "全景",
};

export function viewsForKind(kind: EntityKind): EntityViewKind[] {
  return kind === "character" ? ["face", "front", "side"] : ["full"];
}

export function viewPrompt(opts: {
  kind: EntityKind;
  view: EntityViewKind;
  name: string;
  prompt: string;
}): string {
  const look = opts.prompt.trim() || opts.name;
  if (opts.kind === "scene") {
    return `场景空镜，没有人物，固定机位。${look}。禁止出现人脸和字幕。`;
  }
  if (opts.kind === "prop") {
    return `道具设定图，干净背景，无文字。${look}`;
  }
  if (opts.view === "face") {
    return `角色定妆面部特写，正对镜头，肩部以上，白底，无文字。必须是「${opts.name}」：${look}。同一张脸，禁止换脸。`;
  }
  if (opts.view === "side") {
    return `角色定妆全身左侧站姿，白底，无文字。必须是「${opts.name}」同一张脸、同一套衣服：${look}`;
  }
  return `角色定妆全身正面站姿，白底，无文字。必须是「${opts.name}」同一张脸、同一套衣服：${look}`;
}

export function primaryEntityImage(e: { imageAssetId?: string | null; views?: EntityView[] }): string | null {
  return (
    e.views?.find((v) => v.kind === "face")?.assetId ??
    e.views?.find((v) => v.kind === "front")?.assetId ??
    e.imageAssetId ??
    e.views?.[0]?.assetId ??
    null
  );
}

export function allEntityImageIds(e: { imageAssetId?: string | null; views?: EntityView[] }): string[] {
  const ids = [...(e.views ?? []).map((v) => v.assetId), e.imageAssetId ?? ""].filter(Boolean);
  return [...new Set(ids)];
}

/** 名字在画面描述里出现得越多，越可能是这一镜的主角。 */
function nameHitScore(text: string, name: string): number {
  if (!text || !name) return 0;
  if (text.includes(name)) return 4;
  // 「红裙小女孩」这种带定语的写法，退一步看后三个字。
  for (const cut of [3, 2]) {
    const tail = name.slice(-cut);
    if (tail.length >= 2 && text.includes(tail)) return cut === 3 ? 2 : 1;
  }
  const chars = [...name].filter((c) => /[\u4e00-\u9fa5]/.test(c));
  const hit = chars.filter((c) => text.includes(c)).length;
  return chars.length >= 4 && hit >= chars.length - 1 ? 1 : 0;
}

/**
 * 这一镜该以谁为准：台词和画面里点到名的角色优先，
 * 否则退回 entityIds 的第一个。免得女孩说话却拿外卖员的脸去质检。
 */
export function leadCharacterForShot(
  bible: Pick<DramaBible, "cast">,
  shot: Pick<DramaShot, "entityIds" | "visual" | "line">,
): CharacterDossier | null {
  const cast = (bible.cast ?? []).filter((c) => c.id && c.name);
  if (!cast.length) return null;
  const allowed = shot.entityIds?.length ? cast.filter((c) => shot.entityIds!.includes(c.id)) : cast;
  const pool = allowed.length ? allowed : cast;
  const text = `${shot.visual ?? ""}\n${shot.line ?? ""}`;
  let best = pool[0]!;
  let bestScore = 0;
  for (const c of pool) {
    const score = nameHitScore(text, c.name);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export function mergeEntityViews(current: EntityView[] | undefined, next: EntityView): EntityView[] {
  const rest = (current ?? []).filter((v) => v.kind !== next.kind);
  return [...rest, next];
}

type NamedEntity = { id: string; name: string; kind: EntityKind };

function catalog(bible: Pick<DramaBible, "cast" | "assets">): NamedEntity[] {
  const seen = new Set<string>();
  const out: NamedEntity[] = [];
  for (const c of bible.cast ?? []) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, name: c.name, kind: "character" });
  }
  for (const a of bible.assets ?? []) {
    if (!a.id || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ id: a.id, name: a.name, kind: a.kind });
  }
  return out;
}

/** 点到谁就锁谁；没点名也把主要角色和场景带上，每镜必须有引用。 */
export function bindEntitiesToShots(bible: DramaBible): DramaBible {
  const names = catalog(bible);
  const fallback = names.slice(0, 4).map((n) => n.id);
  return {
    ...bible,
    episodes: bible.episodes.map((ep) => ({
      ...ep,
      shots: ep.shots.map((shot) => {
        if (shot.entityIds?.length) return shot;
        const hay = `${shot.visual}\n${shot.line}\n${shot.imagePrompt}`;
        const hit = names.filter((n) => n.name && hay.includes(n.name)).map((n) => n.id);
        return { ...shot, entityIds: hit.length ? [...new Set(hit)] : fallback };
      }),
    })),
  };
}

/** 档案常忘了写毛色，动物就会每镜换个颜色。按物种补一句最常见的毛色兜底。 */
const FUR_HINT: Array<[RegExp, string]> = [
  [/虎/, "橘黄底黑色横纹"],
  [/豹/, "金黄底黑色斑点"],
  [/狼|犬|狗/, "灰褐色短毛"],
  [/马|驴/, "栗褐色鬃毛"],
  [/熊/, "黑褐色厚毛"],
  [/牛/, "深褐色皮毛"],
  [/鹿/, "黄褐色皮毛"],
];

/** 「金黄色瞳孔」不算写了毛色，所以只认这几个真正描述毛发的词。 */
const FUR_SPEC = /毛色|皮毛|橘黄|橘色|橙黄|金黄底|黄褐|虎纹/;

function furLine(name: string, appearance: string): string {
  if (FUR_SPEC.test(appearance)) return "";
  const hint = FUR_HINT.find(([re]) => re.test(name))?.[1];
  return hint ? `毛色固定为${hint}，全片不许换色。` : "";
}

/** 「无」「无（野生动物）」这类占位不是描述，别拼进提示词。 */
function cleanOutfit(outfit: string): string {
  const text = outfit.trim();
  return /^(?:无|没有|空|n\/a)[（(]?[^）)]*[）)]?$/i.test(text) ? "" : text;
}

/** 档案原文常带「。；」混排，拼进提示词前收拾干净，别让模型读到断句混乱的句子。 */
function tidyLook(text: string): string {
  return text
    .replace(/[。；;]\s*[。；;]+/g, "；")
    .replace(/^[；，\s]+|[；，。\s]+$/g, "")
    .replace(/；{2,}/g, "；");
}

const ANIMAL_TAIL = "虎马犬狼熊豹鹰蛇牛驴猴鹿";

/** 名字是否出现在这段文字里。动物允许用「老虎 / 大虫」这类叫法命中档案名「吊睛白额虎」。 */
function nameHit(name: string, hay: string): boolean {
  const n = name.trim();
  if (!n || !hay) return false;
  if (hay.includes(n)) return true;
  const tail = n.slice(-1);
  if (n.length >= 3 && ANIMAL_TAIL.includes(tail)) {
    return hay.includes(tail) || hay.includes(`老${tail}`) || hay.includes(`大${tail}`);
  }
  if (n.length >= 3 && hay.includes(n.slice(-2))) return true;
  return false;
}

/**
 * 引擎兜底：这一镜画面里点到谁，就把档案里的外貌穿搭逐字钉进提示词。
 * LLM 爱把「黄褐底黑纹」改写成「dark green」，靠这句话把配色焊死。
 * 只看画面描述，不看台词——台词里说「一千只虎」不代表这一镜要画虎。
 */
export function castLockLine(
  bible: Pick<DramaBible, "cast" | "assets">,
  hay: string,
  limit = 4,
): string {
  const text = hay.trim();
  if (!text) return "";
  const lines: string[] = [];
  for (const c of bible.cast ?? []) {
    if (lines.length >= limit) break;
    if (!c.name || !nameHit(c.name, text)) continue;
    const look = tidyLook([c.appearance, cleanOutfit(c.outfit)].filter(Boolean).join("，") || c.prompt || c.name);
    const animal = !c.outfit.trim() || ANIMAL_TAIL.includes(c.name.slice(-1));
    if (animal) {
      const fur = furLine(c.name, `${c.appearance} ${c.prompt}`);
      lines.push(`角色锁定「${c.name}」：${look}。${fur}同一种毛色花纹，配色逐字照用，不许改。`);
      continue;
    }
    lines.push(`角色锁定「${c.name}」：${look}。同一张脸、同一发型、同一套衣服，配色逐字照用，不许改。`);
  }
  for (const a of bible.assets ?? []) {
    if (lines.length >= limit + 2) break;
    if (a.kind === "character" || !a.name || !a.prompt) continue;
    if (!nameHit(a.name, text)) continue;
    lines.push(
      a.kind === "scene"
        ? `场景锁定「${a.name}」：${a.prompt}。同一处空间，不要换地方。`
        : `道具锁定「${a.name}」：${a.prompt}。外形材质不要改。`,
    );
  }
  return lines.join("\n");
}

export function entitiesForShot(
  bible: Pick<DramaBible, "cast" | "assets">,
  entityIds?: string[],
): Array<CharacterDossier | DramaAssetItem> {
  const byId = new Map<string, CharacterDossier | DramaAssetItem>();
  for (const c of bible.cast ?? []) byId.set(c.id, c);
  for (const a of bible.assets ?? []) if (!byId.has(a.id)) byId.set(a.id, a);
  const ids = entityIds?.length ? entityIds : [...byId.keys()].slice(0, 4);
  return ids.map((id) => byId.get(id)).filter((x): x is CharacterDossier | DramaAssetItem => Boolean(x));
}

export function pickShotRefImages(
  bible: Pick<DramaBible, "cast" | "assets">,
  entityIds?: string[],
  extra?: string[],
): string[] {
  const used = entitiesForShot(bible, entityIds);
  const ids: string[] = [];
  for (const e of used) ids.push(...allEntityImageIds(e));
  for (const id of extra ?? []) if (id) ids.push(id);
  return [...new Set(ids)].slice(0, 6);
}

export function lockProductionIntoPrompt(opts: {
  prompt: string;
  bible: Pick<DramaBible, "cast" | "assets">;
  entityIds?: string[];
  lastFrame?: string | null;
  dialogue?: string | null;
  shot?: Pick<DramaShot, "shotSize" | "cameraMove" | "angle"> | null;
}): string {
  const used = entitiesForShot(opts.bible, opts.entityIds);
  const cast = used.filter((e): e is CharacterDossier => "appearance" in e);
  const extras = used.filter((e) => !("appearance" in e)) as DramaAssetItem[];
  const base = lockCastIntoPrompt({
    prompt: opts.prompt,
    cast: cast.length ? cast : (opts.bible.cast ?? []),
    lastFrame: opts.lastFrame,
    dialogue: opts.dialogue,
  });
  const more = extras
    .map((e) => {
      if (e.kind === "scene") return `场景锁定「${e.name}」：${e.prompt}。必须是同一处空间，禁止换地方。`;
      return `道具锁定「${e.name}」：${e.prompt}。外形材质不要改。`;
    })
    .join("\n");
  return [more, base, shotLanguageLine(opts.shot)].filter(Boolean).join("\n");
}

export function assetsFromEntities(cast: CharacterDossier[], extras: DramaAssetItem[] = []): DramaAssetItem[] {
  const fromCast: DramaAssetItem[] = cast.map((c) => ({
    id: c.id,
    kind: "character",
    name: c.name,
    prompt: c.prompt,
    imageAssetId: primaryEntityImage(c),
    views: c.views,
    libraryAssetId: c.libraryAssetId,
  }));
  const seen = new Set(fromCast.map((a) => a.id));
  const rest = extras.filter((a) => a.id && !seen.has(a.id)).map((a) => ({
    ...a,
    imageAssetId: primaryEntityImage(a),
  }));
  return [...fromCast, ...rest];
}
