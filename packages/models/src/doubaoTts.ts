/**
 * 豆包语音合成（火山引擎 openspeech）。
 *
 * 走 v1 协议：APP ID + Access Token，不是方舟的 ark- key，也不是 v3 的 X-Api-Key。
 * 实测同一账号下 v3 的 X-Api-* 体系返回 403 resource not granted，v1 直接 200，
 * 所以这里固定用 v1，避免用户在两套鉴权之间反复试。
 *
 * 参数取自：语音控制台 → 应用管理 → 服务接口认证信息（APP ID / Access Token）。
 */

import type { ModelAdapter, SpeechResult, TestResult } from "./index";

const ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const DEFAULT_CLUSTER = "volcano_tts";
const DEFAULT_VOICE = "zh_female_vv_uranus_bigtts";

/** 常见返回码翻译成人话 */
function explain(code: number, raw: string): string {
  switch (code) {
    case 3001:
      return "APP ID 与 Access Token 不匹配，或该音色未开通。免费额度只覆盖 uranus 系列 4 个音色，换回默认音色再试";
    case 3003:
      return "并发超限，稍等几秒再试";
    case 3005:
      return "请求参数有误，检查音色名是否属于该 cluster";
    case 3006:
      return "音色不存在或未开通，换个 voice_type 试试";
    case 3010:
      return "文本过长，v1 单次上限约 1000 字，请分段合成";
    case 3050:
      return "账户额度不足或未开通语音合成服务";
    default:
      return raw || `返回码 ${code}`;
  }
}

function ratio(v: unknown, fallback = 1): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function doubaoSynthesize(opts: {
  appId: string;
  accessToken: string;
  text: string;
  voice?: string;
  cluster?: string;
  encoding?: string;
  speedRatio?: number;
  volumeRatio?: number;
  pitchRatio?: number;
  signal?: AbortSignal;
}): Promise<SpeechResult> {
  const appId = (opts.appId || "").trim();
  const token = (opts.accessToken || "").trim();
  const text = (opts.text || "").trim();
  if (!appId) throw new Error("豆包配音缺少 APP ID，请到语音控制台「应用管理 → 服务接口认证信息」复制");
  if (!token) throw new Error("豆包配音缺少 Access Token，请到语音控制台「应用管理 → 服务接口认证信息」复制");
  if (!text) throw new Error("没有要朗读的文字");

  const encoding = (opts.encoding || "mp3").trim();
  const voice = (opts.voice || "").trim() || DEFAULT_VOICE;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      // 注意是分号：Bearer;{token}，写空格会被拒
      Authorization: `Bearer;${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app: { appid: appId, token, cluster: (opts.cluster || "").trim() || DEFAULT_CLUSTER },
      user: { uid: "geekreel" },
      audio: {
        voice_type: voice,
        encoding,
        speed_ratio: ratio(opts.speedRatio),
        volume_ratio: ratio(opts.volumeRatio),
        pitch_ratio: ratio(opts.pitchRatio),
      },
      request: {
        reqid: crypto.randomUUID(),
        text,
        text_type: "plain",
        operation: "query",
        with_frontend: 1,
      },
    }),
    signal: opts.signal ?? null,
  });

  const raw = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`豆包配音返回了非 JSON 响应（HTTP ${res.status}）：${raw.slice(0, 160)}`);
  }

  const code = Number(body.code ?? -1);
  if (code !== 3000) {
    throw new Error(explain(code, String(body.message ?? "")));
  }
  const b64 = typeof body.data === "string" ? body.data : "";
  if (!b64) throw new Error("豆包配音返回成功但没有音频数据");
  const data = new Uint8Array(Buffer.from(b64, "base64"));
  if (!data.length) throw new Error("豆包配音返回了空音频");

  const mime = encoding === "wav" ? "audio/wav" : encoding === "ogg_opus" ? "audio/ogg" : "audio/mpeg";
  return { data, mime };
}

export const doubaoTts: ModelAdapter = {
  type: "doubao-tts",
  label: "豆包语音（火山 openspeech v1）",
  capabilities: ["tts"],
  configFields: [
    {
      key: "appId",
      label: "APP ID",
      type: "text",
      required: true,
      placeholder: "语音控制台 → 应用管理 → 服务接口认证信息",
    },
    {
      key: "apiKey",
      label: "Access Token",
      type: "password",
      required: true,
      placeholder: "同一页面下的 Access Token",
    },
    {
      key: "cluster",
      label: "集群",
      type: "select",
      defaultValue: DEFAULT_CLUSTER,
      options: [
        { value: "volcano_tts", label: "volcano_tts（大模型音色）" },
        { value: "volcano_mega", label: "volcano_mega（精品长文本）" },
      ],
    },
    {
      key: "voiceType",
      label: "音色",
      type: "select",
      defaultValue: DEFAULT_VOICE,
      options: [
        { value: "zh_female_vv_uranus_bigtts", label: "女声 2.0 · 通用旁白" },
        { value: "zh_male_m191_uranus_bigtts", label: "男声 2.0 · 通用对白" },
        { value: "zh_male_yuanboxiaoshu_uranus_bigtts", label: "渊博小叔 · 叙事感" },
        { value: "zh_female_shaoergushi_uranus_bigtts", label: "少儿故事 · 讲故事" },
      ],
    },
    {
      key: "speedRatio",
      label: "语速",
      type: "select",
      defaultValue: "1",
      options: [
        { value: "0.8", label: "慢" },
        { value: "0.9", label: "稍慢" },
        { value: "1", label: "正常" },
        { value: "1.15", label: "稍快" },
        { value: "1.3", label: "快" },
      ],
    },
  ],

  async test(config): Promise<TestResult> {
    const start = Date.now();
    try {
      const r = await doubaoSynthesize({
        appId: config.appId ?? "",
        accessToken: config.apiKey ?? "",
        text: "店家劝他别上山，冈上有猛虎。",
        voice: config.voiceType,
        cluster: config.cluster,
        speedRatio: Number(config.speedRatio ?? 1),
        signal: AbortSignal.timeout(60000),
      });
      return {
        ok: true,
        latencyMs: Date.now() - start,
        message: `已合成 ${Math.round(r.data.length / 1024)}KB 音频，音色 ${config.voiceType || DEFAULT_VOICE}`,
      };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : String(e) };
    }
  },

  async generateSpeech(config, req): Promise<SpeechResult> {
    return doubaoSynthesize({
      appId: config.appId ?? "",
      accessToken: config.apiKey ?? "",
      text: req.text,
      voice: req.voice || config.voiceType,
      cluster: config.cluster,
      speedRatio: Number(config.speedRatio ?? 1),
      signal: req.signal,
    });
  },
};
