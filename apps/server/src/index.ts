import "@vw/models/register";
import { detectBins } from "@vw/media";
import { createApp, websocket } from "./app";
import { host, port, siteName, siteTagline, version } from "./config";
import { jobQueue } from "./jobs/queue";
import { indexAssetHandler } from "./services/indexer";
import { genImageHandler, genTtsHandler, genVideoHandler, mediaTranscodeHandler, timelineTtsHandler } from "./services/generate";
import { timelineFinishHandler } from "./services/dub";
import { migrateLibraryHandler } from "./services/migrate";
import { renderTimelineHandler } from "./services/render";
import { fetchRadarHandler, digestRadarHandler, seedRadarSources } from "./services/radar";
import { startRadarScheduler } from "./services/scheduler";
import { analyzeRunHandler } from "./services/analyze";
import { remakeRunHandler } from "./services/remake";
import { pipelineRunHandler } from "./services/pipeline";
import { renderEpisodeHandler } from "./services/episode";
import { composeKeysHandler } from "./services/compose";
import { listPacks } from "./services/styles";
import { styleImportHandler } from "./services/styleImport";
import { libraryRoot } from "./services/library";
import { detectYtdlp } from "@vw/analyze";
import { adoptOrphans, ensureLocalAdmin, hasAnyRealUser, purgeExpiredSessions, purgeExpiredTokens } from "./lib/auth";
import { allowRegister, multiUser, registerCode, smtp } from "./config";
import { mailConfigured } from "./lib/mail";

// 单机模式：建一个本机管理员，并把历史数据收归名下，行为与旧版完全一致。
// 多人模式：等第一个注册者成为管理员后再接管；此处只清理过期会话。
if (!multiUser) {
  const admin = ensureLocalAdmin();
  const moved = adoptOrphans(admin.id);
  if (moved > 0) console.log(`[vw] 已有 ${moved} 条历史数据归入本机管理员`);
}
purgeExpiredSessions();
purgeExpiredTokens();

// 注册任务处理器
jobQueue.register("asset.index", indexAssetHandler, 2);
jobQueue.register("gen.image", genImageHandler, 4);
jobQueue.register("gen.video", genVideoHandler, 2);
jobQueue.register("gen.tts", genTtsHandler, 2);
jobQueue.register("media.transcode", mediaTranscodeHandler, 2);
jobQueue.register("timeline.tts", timelineTtsHandler, 1);
jobQueue.register("timeline.finish", timelineFinishHandler, 1);
jobQueue.register("asset.migrate", migrateLibraryHandler, 1);
jobQueue.register("timeline.render", renderTimelineHandler, 2);
jobQueue.register("radar.fetch", fetchRadarHandler, 2);
jobQueue.register("radar.digest", digestRadarHandler, 1);
jobQueue.register("analyze.run", analyzeRunHandler, 1);
jobQueue.register("remake.run", remakeRunHandler, 2);
jobQueue.register("pipeline.run", pipelineRunHandler, 1);
jobQueue.register("pipeline.episode", renderEpisodeHandler, 1);
jobQueue.register("compose.keys", composeKeysHandler, 1);
jobQueue.register("style.import", styleImportHandler, 2);
jobQueue.recover();
seedRadarSources();
startRadarScheduler();

const bins = await detectBins();
const app = createApp();

// hono/bun 的 upgradeWebSocket 会在 /ws 路由内部完成升级，
// 这里直接把 server 实例透传给 app.fetch 即可
Bun.serve({
  port,
  hostname: host,
  fetch: app.fetch,
  websocket,
  // 拆集、定妆、出图这些接口要跑几分钟，默认 10 秒会被 Bun 直接掐断。
  idleTimeout: 255,
});

console.log(`[vw] 视频工作台 server 已启动: http://${host}:${port}`);
console.log(`[vw] 站点: ${siteName}${siteTagline ? ` · ${siteTagline}` : ""}（v${version}）`);
console.log(`[vw] 资产库根目录: ${libraryRoot()}`);
console.log(`[vw] ffmpeg: ${bins.available ? `${bins.ffmpeg} (${bins.source})` : "未检测到 —— 缩略图/代理不可用，安装后重启生效"}`);
const ytdlp = detectYtdlp();
console.log(`[vw] yt-dlp: ${ytdlp.bin ? `${ytdlp.bin} (${ytdlp.source})` : "未打包（竞品分析已改为读文案，不再依赖下载）"}`);
const packs = listPacks();
console.log(`[vw] 风格包: ${packs.map((p) => `${p.name}${p.ready ? "" : "(未开放)"}`).join("、") || "无"}`);

// 部署自检：这几行是给运维看的，出问题时先看这里
if (multiUser) {
  const first = !hasAnyRealUser();
  console.log(`[vw] 多人模式：已开启。注册 ${allowRegister || first ? "开放" : "关闭"}${registerCode ? "（需邀请码）" : ""}`);
  console.log(
    `[vw] 发信：${mailConfigured() ? `SMTP ${smtp.host}:${smtp.port}` : "未配置 —— 忘记密码只能由管理员在「账号管理」里发链接"}`,
  );
  if (first) console.log("[vw] 还没有账号：浏览器打开首页，第一个注册的人会成为管理员");
} else {
  console.log("[vw] 单机模式：不需要登录。要给别人用，设 VW_MULTI_USER=1 后重启（见 docs/SELF-HOST.md）");
}
if (host === "0.0.0.0" && !multiUser) {
  console.log("[vw] 注意：已监听所有网卡但没有开多人模式，任何能访问这个端口的人都能直接用你的模型 key");
}
