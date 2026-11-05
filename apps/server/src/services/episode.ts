import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  duckBgm,
  emptyTimelineDoc,
  extFromFileName,
  extFromMime,
  layAmbience,
  layBgm,
  laySfxHits,
  mimeFromExt,
  type DramaBible,
  type DramaShot,
  type ShotQa,
} from "@vw/core";
import { detectBins, probe, videoThumbnail } from "@vw/media";
import { getAdapter } from "@vw/models";
import {
  heuristicShotQa,
  lockProductionIntoPrompt,
  clipSpokenText,
  parseShotQa,
  pickShotRefImages,
  primaryEntityImage,
  leadCharacterForShot,
  qaReviewPrompt,
  shouldRetryQa,
  shotDurationSec,
} from "@vw/pipeline";
import { db } from "../db";
import type { JobHandler } from "../jobs/queue";
import { now } from "../lib/resp";
import { speakOne } from "./dub";
import { absInLibrary, findSfxAsset, storeAsset } from "./library";
import { resolveEndpoint } from "./models";
import { chatMetered, recordUsage } from "./usage";

function loadBible(projectId: string): { bible: DramaBible; directory: string } {
  const row = db.query("SELECT directory FROM projects WHERE id = ?").get(projectId) as { directory: string } | null;
  if (!row) throw new Error("项目不存在");
  const path = join(row.directory, "pipeline", "bible.json");
  if (!existsSync(path)) throw new Error("这部还没有分镜。先到小说转短剧确认人物，再往下走。");
  const bible = JSON.parse(readFileSync(path, "utf8")) as DramaBible;
  return { bible, directory: row.directory };
}

function saveBible(directory: string, bible: DramaBible) {
  mkdirSync(join(directory, "pipeline"), { recursive: true });
  writeFileSync(join(directory, "pipeline", "bible.json"), JSON.stringify(bible, null, 2));
}

function imageBytes(assetId: string | null | undefined): { mime: string; data: Uint8Array } | undefined {
  if (!assetId) return undefined;
  const row = db.query("SELECT path FROM assets WHERE id = ? AND type = 'image'").get(assetId) as { path: string } | null;
  if (!row) return undefined;
  return { mime: mimeFromExt(extFromFileName(row.path) || "png"), data: new Uint8Array(readFileSync(absInLibrary(row.path))) };
}

function audioBytes(assetId: string | null | undefined): { mime: string; data: Uint8Array } | undefined {
  if (!assetId) return undefined;
  const row = db.query("SELECT path FROM assets WHERE id = ? AND type = 'audio'").get(assetId) as { path: string } | null;
  if (!row) return undefined;
  return { mime: mimeFromExt(extFromFileName(row.path) || "mp3"), data: new Uint8Array(readFileSync(absInLibrary(row.path))) };
}

/** 已经出来的视频。对口型要基于它，不能拿静帧重来。 */
function videoBytes(assetId: string | null | undefined): { mime: string; data: Uint8Array } | undefined {
  if (!assetId) return undefined;
  const row = db.query("SELECT path FROM assets WHERE id = ? AND type = 'video'").get(assetId) as { path: string } | null;
  if (!row) return undefined;
  return { mime: mimeFromExt(extFromFileName(row.path) || "mp4"), data: new Uint8Array(readFileSync(absInLibrary(row.path))) };
}

export const renderEpisodeHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    projectId?: string;
    episodeIndex?: number;
    videoEndpointId?: string;
    imageEndpointId?: string;
    ttsEndpointId?: string;
    withSubtitles?: boolean;
  };
  const projectId = payload.projectId ?? job.projectId;
  if (!projectId) throw new Error("缺少项目");

  const { bible, directory } = loadBible(projectId);
  const ep =
    bible.episodes.find((e) => e.index === payload.episodeIndex) ??
    bible.episodes[bible.episodes.length - 1] ??
    null;
  if (!ep || ep.shots.length === 0) throw new Error("这一集还没有分镜。先确认人物再往下走。");

  const imageEp = resolveEndpoint("image", payload.imageEndpointId);
  const videoEp = resolveEndpoint("video", payload.videoEndpointId);
  const ttsEp = resolveEndpoint("tts", payload.ttsEndpointId);
  const llmEp = resolveEndpoint("llm");
  const imageAd = imageEp ? getAdapter(imageEp.adapterType) : null;
  const videoAd = videoEp ? getAdapter(videoEp.adapterType) : null;
  const llmAd = llmEp ? getAdapter(llmEp.adapterType) : null;
  if (!imageAd?.generateImage && !videoAd?.generateVideo) {
    throw new Error("出集至少要有图片或视频模型。到「模型」页加上再来。");
  }

  const bins = await detectBins();
  const doc = emptyTimelineDoc({ portrait: true });
  const vTrack = doc.tracks.find((t) => t.type === "video")!;
  const aTrack = doc.tracks.find((t) => t.type === "audio")!;
  const sTrack = doc.tracks.find((t) => t.type === "subtitle")!;

  let cursor = 0;
  let lastFrameId: string | null = null;
  let lastFrameDesc = "";
  let lipsMissed = 0;
  let lipsSkipped = 0;
  const shots: DramaShot[] = [];

  for (let i = 0; i < ep.shots.length; i++) {
    const shot = ep.shots[i]!;
    const durSec = shotDurationSec(shot);
    const durMs = durSec * 1000;
    ctx.progress(0.08 + (i / ep.shots.length) * 0.8, `第 ${i + 1}/${ep.shots.length} 镜`);

    const prompt = lockProductionIntoPrompt({
      prompt: shot.imagePrompt || shot.visual,
      bible,
      entityIds: shot.entityIds,
      lastFrame: lastFrameDesc || null,
      dialogue: shot.line || null,
      shot,
    });
    const refIds = pickShotRefImages(bible, shot.entityIds, lastFrameId ? [lastFrameId] : []);
    // 这一镜画面/台词里点到谁，就以谁为准；都不提才退回第一个出场角色。
    const lead = leadCharacterForShot(bible, shot);
    const faceId = (lead ? primaryEntityImage(lead) : null) ?? refIds[0];
    const refs = refIds.map((id) => imageBytes(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
    // 续拍优先接上一镜的尾帧，场景和光才连得上；定妆照只当参考图，不抢首帧。
    let startImage = imageBytes(lastFrameId) ?? imageBytes(faceId) ?? refs[0];

    let imageAssetId: string | null = lastFrameId ?? refIds[0] ?? null;
    let videoAssetId: string | null = null;
    let audioAssetId: string | null = null;
    let lipSynced = false;
    let videoError: string | null = null;
    let lipsNote: string | null = null;
    let paintedId: string | null = null;
    let outputFrameId: string | null = null;
    let qa: ShotQa | null = heuristicShotQa(refIds.length > 0);

    const paintStill = async (text: string) => {
      if (!imageAd?.generateImage || !imageEp) return null;
      const still = await imageAd.generateImage(imageEp.config, {
        prompt: text,
        size: "1024x1536",
        signal: ctx.signal,
        refs,
      });
      const asset = storeAsset({
        type: "image",
        title: `${bible.title} E${ep.index}-${i + 1}`,
        ext: extFromMime(still.mime, "png"),
        source: "pipeline",
        projectId,
        data: still.data,
      });
      recordUsage({ endpoint: imageEp, projectId, jobType: "pipeline.episode", images: 1 });
      return asset.id;
    };

    // 一集的头一镜没有上一帧可接。直接拿定妆照当首帧会出白底棚，场景全靠提示词碰运气。
    // 先画一张这一镜的分镜图（人物+场景），再拿它去图生视频。一张图换一镜的稳定，划算。
    if (imageAd?.generateImage && imageEp && !lastFrameId) {
      try {
        paintedId = await paintStill(prompt);
        if (paintedId) {
          imageAssetId = paintedId;
          outputFrameId = paintedId;
          startImage = imageBytes(paintedId) ?? startImage;
        }
      } catch {
        /* 画不出来就退回定妆照，别卡住整集 */
      }
    } else if (!imageAssetId) {
      try {
        paintedId = await paintStill(prompt);
        imageAssetId = paintedId ?? imageAssetId;
        outputFrameId = paintedId;
      } catch {
        /* 没静帧也能试视频 */
      }
    }

    const reviewOutput = async (id: string | null, retries: number): Promise<ShotQa> => {
      if (!id) return heuristicShotQa(refIds.length > 0);
      if (!llmAd?.chat || !llmEp || !faceId) return { ...heuristicShotQa(refIds.length > 0), retries };
      const frame = imageBytes(id);
      const look = imageBytes(faceId);
      if (!frame || !look) return { ...heuristicShotQa(refIds.length > 0), retries };
      try {
        const text = await chatMetered(
          llmAd,
          llmEp,
          {
            system: "你是短剧质检。只输出 JSON。",
            prompt: qaReviewPrompt({ visual: shot.visual || shot.imagePrompt, lock: prompt }),
            images: [frame, look],
          },
          { projectId, jobType: "pipeline.qa" },
        );
        return parseShotQa(text, retries);
      } catch {
        return { ...heuristicShotQa(refIds.length > 0), retries };
      }
    };

    const makeVideo = async (text: string) => {
      if (!videoAd?.generateVideo || !videoEp) return;
      const result = await videoAd.generateVideo(videoEp.config, {
        prompt: text,
        durationSec: durSec,
        signal: ctx.signal,
        image: startImage ?? imageBytes(imageAssetId),
        lastFrame: lastFrameId ? imageBytes(lastFrameId) : undefined,
        refs,
        dialogue: shot.line || undefined,
        audio: Boolean(shot.line),
      });
      const asset = storeAsset({
        type: "video",
        title: `${bible.title} E${ep.index}-${i + 1}镜`,
        ext: extFromMime(result.mime, "mp4"),
        source: "pipeline",
        projectId,
        data: result.data,
      });
      recordUsage({
        endpoint: videoEp,
        projectId,
        jobType: "pipeline.episode",
        videoSec: result.durationSec ?? durSec,
      });
      videoAssetId = asset.id;
      if (bins.ffmpeg && bins.ffprobe) {
        const abs = absInLibrary(asset.path);
        const info = await probe(bins.ffprobe, abs);
        const at = Math.max(200, (info?.durationMs ?? durMs) - 240);
        const tmp = join(directory, "pipeline", `tail-${ep.index}-${i}.jpg`);
        await videoThumbnail(bins.ffmpeg, abs, tmp, at, ctx.signal);
        if (existsSync(tmp)) {
          const tail = storeAsset({
            type: "image",
            title: `${bible.title} E${ep.index}-${i + 1}尾帧`,
            ext: "jpg",
            source: "pipeline",
            projectId,
            fromPath: tmp,
          });
          lastFrameId = tail.id;
          outputFrameId = tail.id;
        }
      }
    };

    if (videoAd?.generateVideo && videoEp) {
      try {
        await makeVideo(prompt);
      } catch (e) {
        // 别把原因吞掉。画面退回静帧时，得让人知道是模型报错还是额度用完。
        videoError = e instanceof Error ? e.message : String(e);
        videoAssetId = null;
        lipSynced = false;
      }
    }

    if (outputFrameId) {
      qa = await reviewOutput(outputFrameId, 0);
      if (shouldRetryQa(qa)) {
        try {
          ctx.progress(0.08 + ((i + 0.4) / ep.shots.length) * 0.8, `第 ${i + 1} 镜质检没过，重做`);
          const retryPrompt = `${prompt}\n上一镜漂了：${qa.note}。必须和定妆同一张脸、同一套衣服，禁止换人换景。`;
          if (videoAd?.generateVideo && videoEp) {
            await makeVideo(retryPrompt);
          } else if (imageAd?.generateImage && imageEp) {
            paintedId = await paintStill(retryPrompt);
            imageAssetId = paintedId ?? imageAssetId;
            outputFrameId = paintedId ?? outputFrameId;
          }
          qa = await reviewOutput(outputFrameId, 1);
        } catch {
          qa = { ...qa, retries: 1 };
        }
      }
    }

    if (shot.line.trim()) {
      const spoken = await speakOne(clipSpokenText(shot.line, durMs), { projectId, endpoint: ttsEp, signal: ctx.signal });
      if (spoken) audioAssetId = spoken.assetId;
    }

    // 只有真能对口型的模型才跑第二遍。不能出声的模型再生成一次只会把动起来的镜头
    // 退回静帧，还白烧一遍视频额度——配音直接走下面的音轨。
    if (shot.line.trim() && audioAssetId && videoAd?.lipSync && videoEp) {
      const still = imageBytes(imageAssetId) ?? startImage;
      const voice = audioBytes(audioAssetId);
      const motion = videoBytes(videoAssetId);
      if (voice && (motion || still)) {
        try {
          ctx.progress(0.08 + ((i + 0.7) / ep.shots.length) * 0.8, `第 ${i + 1} 镜对口型`);
          const lip = await videoAd.lipSync(videoEp.config, {
            image: still,
            video: motion,
            audio: voice,
            text: shot.line,
            durationSec: durSec,
            signal: ctx.signal,
          });
          const asset = storeAsset({
            type: "video",
            title: `${bible.title} E${ep.index}-${i + 1}对口型`,
            ext: extFromMime(lip.mime, "mp4"),
            source: "pipeline",
            projectId,
            data: lip.data,
          });
          recordUsage({
            endpoint: videoEp,
            projectId,
            jobType: "pipeline.lipsync",
            videoSec: lip.durationSec ?? durSec,
          });
          videoAssetId = asset.id;
          lipSynced = true;
          lipsNote = null;
        } catch (e) {
          lipsMissed += 1;
          const reason = e instanceof Error ? e.message : String(e);
          lipsNote = videoAssetId
            ? `对口型没对上：${reason}。成片仍用原视频，没有改成静帧。`
            : `对口型没对上：${reason}。只有定妆图，嘴没动。`;
        }
      } else {
        lipsMissed += 1;
        lipsNote = videoAssetId
          ? "对口型缺定妆或配音，原视频没改成静帧。"
          : "有台词但缺定妆或配音，嘴没动。";
      }
    } else if (shot.line.trim() && !lipSynced) {
      if (videoAd?.generateVideo && !videoAd.lipSync && videoAssetId) {
        // 模型没有对口型能力，别再拿静帧重生成一遍。配音已经铺进音轨，画面照用它动的。
        lipsSkipped += 1;
        lipsNote = "这个视频模型不会对口型，画面保留原样，配音走音轨。";
      } else {
        lipsMissed += 1;
        lipsNote = videoAssetId
          ? "有台词但对口型没跑成。原视频保留，配音另铺。"
          : "有台词但对口型没跑成。没有用静帧冒充说话。";
      }
    }

    // 视频没出来就别装作是「对口型没过」。原因写清楚，人才知道该查额度还是改提示词。
    if (videoError && !videoAssetId) {
      lipsNote = `这一镜视频没出来：${videoError}。先用分镜图顶上，配音照铺。`;
    }

    if (!videoAssetId && !imageAssetId) {
      throw new Error(`第 ${i + 1} 镜没出成。检查图片或视频模型，再点出这一集。`);
    }

    const visualId = videoAssetId ?? imageAssetId!;
    vTrack.clips.push({
      id: `c_v_${i}`,
      assetId: visualId,
      startMs: cursor,
      inMs: 0,
      outMs: durMs,
      volume: 1,
    });
    if (audioAssetId) {
      aTrack.clips.push({
        id: `c_a_${i}`,
        assetId: audioAssetId,
        startMs: cursor,
        inMs: 0,
        outMs: durMs,
        volume: 1,
      });
      const lastV = vTrack.clips.at(-1);
      if (lastV) lastV.volume = 0;
    }
    if (shot.line.trim() && payload.withSubtitles !== false) {
      sTrack.clips.push({
        id: `c_s_${i}`,
        text: shot.line.trim(),
        startMs: cursor,
        inMs: 0,
        outMs: durMs,
        volume: 1,
      });
    }

    lastFrameDesc = shot.visual || shot.imagePrompt || lastFrameDesc;
    if (!videoAssetId && imageAssetId) lastFrameId = imageAssetId;
    shots.push({
      ...shot,
      imageAssetId,
      videoAssetId,
      audioAssetId,
      lipSynced,
      lipsNote,
      qa,
    });
    cursor += durMs;
  }

  const nextBible: DramaBible = {
    ...bible,
    episodes: bible.episodes.map((e) => (e.index === ep.index ? { ...e, shots, lastFrame: lastFrameDesc } : e)),
  };
  saveBible(directory, nextBible);
  const pipe = db
    .query("SELECT id, stateJson FROM pipelines WHERE projectId = ? ORDER BY updatedAt DESC LIMIT 1")
    .get(projectId) as { id: string; stateJson: string } | null;
  if (pipe) {
    try {
      const st = JSON.parse(pipe.stateJson) as { bible?: DramaBible };
      st.bible = nextBible;
      db.run("UPDATE pipelines SET stateJson = ?, updatedAt = ? WHERE id = ?", [
        JSON.stringify(st),
        now(),
        pipe.id,
      ]);
    } catch {
      /* bible file already saved */
    }
  }
  const proj = db.query("SELECT seriesId FROM projects WHERE id = ?").get(projectId) as { seriesId: string | null } | null;
  if (proj?.seriesId) {
    db.run("UPDATE series SET bibleJson = ?, lastProjectId = ?, updatedAt = ? WHERE id = ?", [
      JSON.stringify(nextBible),
      projectId,
      now(),
      proj.seriesId,
    ]);
  }
  let lined = bible.bgmAssetId ? layBgm(doc, bible.bgmAssetId) : doc;
  if (bible.ambienceAssetId) lined = layAmbience(lined, bible.ambienceAssetId);
  const talk = shots
    .map((s, idx) => ({
      startMs: doc.tracks.find((t) => t.type === "video")?.clips[idx]?.startMs ?? 0,
      endMs: (doc.tracks.find((t) => t.type === "video")?.clips[idx]?.startMs ?? 0) + shotDurationSec(s) * 1000,
      line: s.line,
      cue: s.sfxCue,
    }))
    .filter((s) => s.line.trim());
  if (bible.bgmAssetId && talk.length) {
    lined = duckBgm(
      lined,
      talk.map((s) => ({ startMs: s.startMs, endMs: s.endMs })),
    );
  }
  const hits = shots
    .map((s, idx) => {
      if (!s.sfxCue) return null;
      const asset = findSfxAsset(s.sfxCue);
      if (!asset) return null;
      return {
        startMs: doc.tracks.find((t) => t.type === "video")?.clips[idx]?.startMs ?? 0,
        assetId: asset.id,
        durationMs: 1400,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (hits.length) lined = laySfxHits(lined, hits);
  const qaMissed = shots.filter((s) => s.qa && !s.qa.ok).length;
  mkdirSync(join(directory, "timeline"), { recursive: true });
  writeFileSync(join(directory, "timeline", "main.json"), JSON.stringify(lined, null, 2));

  ctx.progress(
    1,
    [
      lipsMissed ? `${lipsMissed} 镜对口型没过，原视频还在` : "",
      lipsSkipped ? `${lipsSkipped} 镜按音轨配音（模型不会对口型）` : "",
      lipsMissed || lipsSkipped ? "" : "对口型过了",
      qaMissed ? `${qaMissed} 镜质检没过` : "质检过了",
      bible.bgmAssetId ? "配乐已压过人声" : "",
      bible.ambienceAssetId ? "环境底铺了" : "",
    ]
      .filter(Boolean)
      .join("，"),
  );
  return {
    projectId,
    episodeIndex: ep.index,
    shotCount: shots.length,
    lipsMissed,
    lipsSkipped,
    portrait: true,
  };
};
