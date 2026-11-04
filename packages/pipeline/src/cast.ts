/**
 * 小说 → 角色档案 + 事件清单。不点选风格包，造型从正文里长出来。
 */

import type { CharacterDossier, DramaAssetItem, DramaBible, StoryEvent } from "@vw/core";

export const CAST_SYSTEM =
  "你是剧本统筹。先通读全文，识别所有出场角色——包括没有名字的（店家、掌柜、村民、路人、士兵等）和动物猛兽（虎、马、犬、狼等），给每个都写档案；再按章节抽出关键事件。有台词或被反复写到外形的都要建档，不要编造正文没有的角色。只输出 JSON。";

/** 文生图模型爱自己加画风词，会把风格包的平涂/水墨冲掉。建档时统一清掉，画风只由风格包注入。 */
const STYLE_NOISE =
  /\b(?:photorealistic|photo-?realistic|hyper-?realistic|realistic(?:\s+style)?|cinematic(?:\s+lighting)?|detailed\s+texture|highly\s+detailed|ultra-?detailed|8k|4k|octane\s+render|unreal\s+engine|studio\s+lighting|flat\s+illustration|chinese\s+(?:style|painting)|vector\s+(?:art|illustration)|clip\s?art|cel\s+shad(?:e|ing)|no\s+shadows?|solid\s+colou?rs)\b/gi;

export function stripStyleWords(prompt: string): string {
  const src = prompt.trim();
  if (!src) return src;
  const cleaned = src
    .replace(STYLE_NOISE, "")
    .replace(/\s*[,，;；]\s*(?=[,，;；])/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,，;；]+|[\s,，;；]+$/g, "")
    .trim();
  return cleaned || src;
}

export const CAST_REVISE_SYSTEM =
  "你是角色造型指导。按用户的新描述（和参考图，如果有）重写这一个角色的档案。其他字段也要自洽。只输出这一个角色的 JSON。";

export const EVENT_REVISE_SYSTEM =
  "你是编剧。按用户意见改这一条事件，不要改人物名字。只输出这一条事件的 JSON。";

export const BIBLE_REVISE_SYSTEM =
  "你是短剧统筹。按用户一句话改整份人物档案和事件清单。可以改语言、语气、详略、删并条目。必须保住每条原来的 id。只输出 JSON。";

export const STORY_REWRITE_SYSTEM =
  "你是小说编辑。按用户要求改整篇正文。只输出改好的正文，不要标题、不要解释、不要 markdown。";

export const CAST_TO_BIBLE_SYSTEM =
  "你是短剧编剧。人物造型必须严格按已确认的档案，不要改外貌和穿搭。只输出 JSON。";

export function dossierPrompt(c: CharacterDossier): string {
  return [
    c.name,
    c.identity && `身份：${c.identity}`,
    c.appearance && `外貌：${c.appearance}`,
    c.outfit && `穿搭：${c.outfit}`,
    c.personality && `性格：${c.personality}`,
  ]
    .filter(Boolean)
    .join("。");
}

export function novelCastPrompt(story: string): string {
  return `通读下面的小说，输出 JSON：
{"title":"剧名","summary":"一两句故事","palette":{"note":"从正文气氛归纳的色调","colors":[{"name":"色名","hex":"#RRGGBB","role":"主/辅/点缀/底"}]},"cast":[{"id":"C01","name":"人名","identity":"身份","personality":"性格","appearance":"外貌","outfit":"穿搭","prompt":"可直接文生图的全身设定"}],"assets":[{"id":"S01","kind":"scene","name":"景名","prompt":"空镜设定"},{"id":"P01","kind":"prop","name":"道具","prompt":"外形材质"}],"events":[{"id":"E01","chapter":"第几章或段落名","index":1,"title":"事件名","summary":"发生了什么","characters":["C01"]}]}

规则：
- 每个出场角色一份档案，**包括没有名字的角色**（店家、掌柜、村民、路人、士兵、随从等，名字就用文中称呼）和**动物猛兽**（虎、马、犬、狼等，毛色、体型、眼睛、花纹必须写死）。
- 外貌和穿搭要写具体、可复现：身形高矮胖瘦、脸型五官、发型胡须、肤色、衣物颜色与材质、随身物件。同一个人每次出场都要靠这段文字保持一致，所以不要写"俊朗""威武"这类空词。
- 穿搭必须把颜色写死：上衣、裤子、腰带、鞋、头巾各是什么颜色都要点名，只写「深色粗布短打」这种没有色名的一律不合格——没有色名，每一镜的衣服颜色都会漂。颜色名用「墨绿」「土黄」「赭褐」「青灰」这类能画出来的词。
- 动物猛兽的毛色必须定死：原文写了就照写；原文没写就按这种动物的传统形象定（虎＝橘黄底黑纹、额头白斑、眼睛金黄），定完不许改，也不许写成黑虎白灰虎。
- prompt 只写外形、穿搭、姿态，**禁止写任何画风词**（realistic / photorealistic / cinematic / 8k / 胶片感 / 3D / 渲染器之类一律不要）。画风由风格包统一注入，写了会打架。
- assets 里写反复出现的场景和道具，id 用 Sxx / Pxx。
- 按原文自然章节或明显段落拆事件，每章至少 1 条关键事件，最多 30 条。
- characters 填角色 id，事件里出现的每个角色都要列上。

正文：
${story.trim()}`;
}

export function novelCastContinuePrompt(
  story: string,
  locked: { title: string; castLine: string },
): string {
  return `这是连载《${locked.title}》的下一章。人物档案已经锁定，不要改造型。只抽本章事件。
已锁定人物：${locked.castLine || "沿用上集"}

输出 JSON：
{"title":"${locked.title}","summary":"本章一两句","palette":{"note":"沿用","colors":[]},"cast":[],"events":[{"id":"E01","chapter":"本章","index":1,"title":"事件名","summary":"发生了什么","characters":["C01"]}]}

本章正文：
${story.trim()}`;
}

export function reviseCharacterPrompt(current: CharacterDossier, instruction: string, hasImage: boolean): string {
  return `当前档案：
${JSON.stringify(current)}

用户要求：${instruction.trim() || "按参考重做这个角色"}
${hasImage ? "已附参考图，外貌和穿搭以图为准，再结合文字。" : ""}

只输出这一个角色：
{"id":"${current.id}","name":"${current.name}","identity":"","personality":"","appearance":"","outfit":"","prompt":""}`;
}

export function reviseBiblePrompt(bible: Pick<DramaBible, "title" | "palette" | "cast" | "events">, instruction: string): string {
  const slim = {
    title: bible.title,
    palette: bible.palette,
    cast: (bible.cast ?? []).map(({ imageAssetId: _img, ...c }) => c),
    events: bible.events ?? [],
  };
  return `当前整份：
${JSON.stringify(slim)}

用户要求：${instruction.trim()}

规则：
- 按这句话改整份。例如「全部改成中文」就把标题、色调说明、人物、事件都改成中文。
- 保住每个角色和事件的 id，不要换号。
- 可以增删事件或角色，新增的 id 用 Cxx / Exx 接着编。
- 不要输出定妆图字段。

只输出：
{"title":"","palette":{"note":"","colors":[]},"cast":[{"id":"C01","name":"","identity":"","personality":"","appearance":"","outfit":"","prompt":""}],"events":[{"id":"E01","chapter":"","index":1,"title":"","summary":"","characters":["C01"]}]}`;
}

export function rewriteStoryPrompt(story: string, instruction: string): string {
  return `用户要求：${instruction.trim()}

原文：
${story.trim()}`;
}

export function parseBibleRevise(text: string, current: DramaBible): DramaBible {
  const json = extractJson(text);
  if (!json) throw new Error("模型没按格式改整份，再试一次");
  const rawCast = Array.isArray(json.cast) ? json.cast : null;
  const rawEvents = Array.isArray(json.events) ? json.events : null;
  if (!rawCast && !rawEvents && !String(json.title ?? "").trim()) {
    throw new Error("改完的内容是空的，换一句再说");
  }
  const doc = parseCastDoc(JSON.stringify(json), current.title);
  const oldById = new Map((current.cast ?? []).map((c) => [c.id, c]));
  const cast = rawCast && rawCast.length
    ? doc.cast.map((c) => ({ ...c, imageAssetId: oldById.get(c.id)?.imageAssetId ?? null }))
    : (current.cast ?? []);
  return {
    ...current,
    title: String(json.title ?? "").trim() || current.title,
    palette: {
      note: doc.paletteNote || current.palette.note,
      colors: doc.colors.length ? doc.colors : current.palette.colors,
    },
    cast,
    events: rawEvents && rawEvents.length ? doc.events : (current.events ?? []),
    assets: assetsFromCast(cast),
  };
}

export function reviseEventPrompt(current: StoryEvent, instruction: string): string {
  return `当前事件：
${JSON.stringify(current)}

用户要求：${instruction.trim()}

只输出这一条：
{"id":"${current.id}","chapter":"${current.chapter}","index":${current.index},"title":"","summary":"","characters":${JSON.stringify(current.characters)}}`;
}

export function bibleFromCastPrompt(
  story: string,
  bible: Pick<DramaBible, "title" | "cast" | "events" | "palette">,
  episodeCount: number,
): string {
  const cast = (bible.cast ?? []).map((c) => `${c.id} ${dossierPrompt(c)}`).join("\n");
  const events = (bible.events ?? []).map((e) => `${e.id} [${e.chapter}] ${e.title}：${e.summary}`).join("\n");
  return `把已确认的人物和事件做成短剧圣经。必须正好 ${episodeCount} 集，每集 3 镜（0-5s / 5-10s / 10-15s）。
人物必须按档案出镜，不要改外貌穿搭。

硬要求（关系到成片一致性，必须遵守）：
- 每个镜头都要写 imagePrompt，不许留空；不许只写「紧接上一镜尾帧」。
- imagePrompt 只写「谁 + 在哪 + 做什么」一句，**不超过 40 字**；不要重复档案里的外貌穿搭，服装配色由引擎按档案逐字注入，你再写一遍反而会被改乱。
- imagePrompt 必须带出环境：天色、地面材质、山石树木、房屋陈设，别让人物站在空底上。
- 同一角色在不同镜头之间只变动作、表情、机位，不变长相。
- imagePrompt 一律用中文写。不要英文、不要画风词（realistic / cinematic / 8k / flat illustration / Chinese style / 胶片感等），画风由风格包统一注入。
- 整套尽量短：visual 不超过 20 字，line 不超过 20 字，不要解释、不要注释。

剧名：${bible.title}
人物：
${cast || "无"}
事件清单：
${events || "按正文顺序"}

只输出 JSON，不要代码块标记，不要任何说明文字：
{"title":"${bible.title}","palette":{"note":"","colors":[]},"assets":[],"episodes":[{"index":1,"title":"集标题","synopsis":"本集一事","narrator":"旁白","lastFrame":"尾帧","shots":[{"startSec":0,"endSec":5,"visual":"画面","line":"对白或旁白","imagePrompt":"谁在哪做什么","shotSize":"cu|ms|fs|ls","cameraMove":"static|push|pull|pan|follow","angle":"eye|high|low|over"}]}]}

原文摘录：
${story.trim().slice(0, 3000)}`;
}

export function parseCastDoc(text: string, fallbackStory: string): {
  title: string;
  summary: string;
  paletteNote: string;
  colors: DramaBible["palette"]["colors"];
  cast: CharacterDossier[];
  events: StoryEvent[];
  extras: DramaAssetItem[];
} {
  const json = extractJson(text);
  const r = (json ?? {}) as Record<string, unknown>;
  const title = String(r.title ?? "").trim() || guessTitle(fallbackStory);
  const summary = String(r.summary ?? "").trim();
  const palette = (r.palette ?? {}) as Record<string, unknown>;
  const colors = Array.isArray(palette.colors)
    ? palette.colors
        .map((c) => {
          const x = (c ?? {}) as Record<string, unknown>;
          return { name: String(x.name ?? "").trim(), hex: String(x.hex ?? "").trim(), role: String(x.role ?? "").trim() };
        })
        .filter((c) => c.name && c.hex)
    : [];
  const cast = (Array.isArray(r.cast) ? r.cast : []).map((raw, i) => normalizeCast(raw, i)).filter((c) => c.name);
  const events = (Array.isArray(r.events) ? r.events : []).map((raw, i) => normalizeEvent(raw, i)).filter((e) => e.title || e.summary);
  const extras = (Array.isArray(r.assets) ? r.assets : [])
    .map((raw, i) => normalizeExtra(raw, i))
    .filter((a) => a.name && a.kind !== "character");
  return {
    title,
    summary,
    paletteNote: String(palette.note ?? "").trim(),
    colors,
    cast: cast.length ? cast : fallbackCast(fallbackStory),
    events: events.length ? events.slice(0, 30) : fallbackEvents(fallbackStory),
    extras,
  };
}

export function parseOneCharacter(text: string, fallback: CharacterDossier): CharacterDossier {
  const json = extractJson(text);
  if (!json) return { ...fallback, prompt: dossierPrompt(fallback) };
  const next = normalizeCast({ ...fallback, ...json }, 0);
  return {
    ...fallback,
    ...next,
    id: fallback.id,
    name: next.name || fallback.name,
    prompt: next.prompt || dossierPrompt(next),
  };
}

export function parseOneEvent(text: string, fallback: StoryEvent): StoryEvent {
  const json = extractJson(text);
  if (!json) return fallback;
  const next = normalizeEvent({ ...fallback, ...json }, fallback.index - 1);
  return { ...fallback, ...next, id: fallback.id, index: fallback.index };
}

export function assetsFromCast(cast: CharacterDossier[], extras: DramaAssetItem[] = []): DramaAssetItem[] {
  const fromCast: DramaAssetItem[] = cast.map((c) => ({
    id: c.id,
    kind: "character" as const,
    name: c.name,
    prompt: c.prompt || dossierPrompt(c),
    imageAssetId: c.imageAssetId ?? null,
    views: c.views,
    libraryAssetId: c.libraryAssetId,
  }));
  const seen = new Set(fromCast.map((a) => a.id));
  return [...fromCast, ...extras.filter((a) => a.id && !seen.has(a.id))];
}

export function castFromAssets(assets: DramaAssetItem[]): CharacterDossier[] {
  return assets
    .filter((a) => a.kind === "character")
    .map((a, i) => ({
      id: a.id || `C${String(i + 1).padStart(2, "0")}`,
      name: a.name,
      identity: "",
      personality: "",
      appearance: a.prompt,
      outfit: "",
      prompt: a.prompt,
      imageAssetId: a.imageAssetId ?? null,
      views: a.views,
      libraryAssetId: a.libraryAssetId,
    }));
}

function normalizeExtra(raw: unknown, i: number): DramaAssetItem {
  const x = (raw ?? {}) as Record<string, unknown>;
  const kind = x.kind === "prop" ? "prop" : "scene";
  const prefix = kind === "prop" ? "P" : "S";
  return {
    id: String(x.id ?? "").trim() || `${prefix}${String(i + 1).padStart(2, "0")}`,
    kind,
    name: String(x.name ?? "").trim(),
    prompt: String(x.prompt ?? "").trim() || String(x.name ?? "").trim(),
  };
}

function normalizeCast(raw: unknown, i: number): CharacterDossier {
  const x = (raw ?? {}) as Record<string, unknown>;
  const name = String(x.name ?? "").trim();
  const identity = String(x.identity ?? x.role ?? "").trim();
  const personality = String(x.personality ?? "").trim();
  const appearance = String(x.appearance ?? "").trim();
  const outfit = String(x.outfit ?? x.clothing ?? "").trim();
  const draft: CharacterDossier = {
    id: String(x.id ?? "").trim() || `C${String(i + 1).padStart(2, "0")}`,
    name,
    identity,
    personality,
    appearance,
    outfit,
    prompt: stripStyleWords(String(x.prompt ?? "").trim()),
    imageAssetId: typeof x.imageAssetId === "string" ? x.imageAssetId : null,
  };
  if (!draft.prompt) draft.prompt = dossierPrompt(draft);
  return draft;
}

function normalizeEvent(raw: unknown, i: number): StoryEvent {
  const x = (raw ?? {}) as Record<string, unknown>;
  const characters = Array.isArray(x.characters) ? x.characters.map((c) => String(c).trim()).filter(Boolean) : [];
  return {
    id: String(x.id ?? "").trim() || `E${String(i + 1).padStart(2, "0")}`,
    chapter: String(x.chapter ?? "").trim() || `第 ${i + 1} 段`,
    index: Number(x.index) > 0 ? Math.round(Number(x.index)) : i + 1,
    title: String(x.title ?? "").trim(),
    summary: String(x.summary ?? "").trim(),
    characters,
  };
}

function fallbackCast(story: string): CharacterDossier[] {
  return [
    {
      id: "C01",
      name: "主角",
      identity: "待确认",
      personality: "从正文再认",
      appearance: story.slice(0, 40) || "待描述",
      outfit: "待描述",
      prompt: story.slice(0, 40) || "主角",
      imageAssetId: null,
    },
  ];
}

function fallbackEvents(story: string): StoryEvent[] {
  return [
    {
      id: "E01",
      chapter: "开篇",
      index: 1,
      title: "开场",
      summary: story.slice(0, 80) || "关键事件待补",
      characters: ["C01"],
    },
  ];
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function guessTitle(story: string): string {
  return story.replace(/\s+/g, " ").trim().slice(0, 12) || "未命名短剧";
}
