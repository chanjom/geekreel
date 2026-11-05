/**
 * Windows 本机配音：调系统自带的 SAPI 语音引擎，离线、免费、不限字数。
 *
 * 不联网的好处是永远不会欠费、不会被限流；代价是音色比云端模型机械一些，
 * 适合先把整条链路跑通，等云端配音额度到账再换。
 *
 * 实现方式：把文字写成 UTF-8 临时文件 → PowerShell 用 COM 调 SAPI 合成到 wav → 读回字节。
 * 走临时文件而不是命令行参数，是为了避免中文和引号在命令行里被二次转义。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelAdapter, SpeechResult, TestResult } from "./index";

const PS_SCRIPT = `
param([string]$In,[string]$Out,[string]$Voice,[int]$Rate)
$ErrorActionPreference = "Stop"
$text = Get-Content -LiteralPath $In -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($text)) { throw "没有文字可读" }
$v = New-Object -ComObject SAPI.SpVoice
$voices = $v.GetVoices()
$picked = $null
for ($i = 0; $i -lt $voices.Count; $i++) {
  $d = $voices.Item($i).GetDescription()
  if ($Voice -and $d -like "*$Voice*") { $picked = $i; break }
}
if ($null -eq $picked) {
  for ($i = 0; $i -lt $voices.Count; $i++) {
    $d = $voices.Item($i).GetDescription()
    if ($d -match "Chinese|Huihui|Kangkang|Yaoyao") { $picked = $i; break }
  }
}
if ($null -ne $picked) { $v.Voice = $voices.Item($picked) }
$v.Rate = $Rate
$fs = New-Object -ComObject SAPI.SpFileStream
$fs.Open($Out, 3, $false)
$v.AudioOutputStream = $fs
$v.Speak($text) | Out-Null
$fs.Close()
if (-not (Test-Path $Out)) { throw "没有生成音频文件" }
`;

/** 把毫秒级的 -10..10 换算成 SAPI 的 -10..10，默认 0 */
function clampRate(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-10, Math.min(10, Math.round(n)));
}

function runPowerShell(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* 已经结束 */
      }
      reject(new Error(`本机配音超时（${timeoutMs / 1000} 秒）`));
    }, timeoutMs);
    Promise.all([proc.exited, new Response(proc.stderr).text()]).then(([code, stderr]) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`本机配音失败：${(stderr || "").trim().slice(0, 300) || `退出码 ${code}`}`));
    });
  });
}

export async function windowsSpeak(opts: {
  text: string;
  voice?: string;
  rate?: string;
  timeoutMs?: number;
}): Promise<SpeechResult> {
  const text = opts.text.trim();
  if (!text) throw new Error("没有要朗读的文字");
  if (process.platform !== "win32") throw new Error("本机配音只在 Windows 上可用，其他系统请用云端配音");

  const dir = mkdtempSync(join(tmpdir(), "vw-tts-"));
  const inFile = join(dir, "in.txt");
  const outFile = join(dir, "out.wav");
  const psFile = join(dir, "speak.ps1");
  try {
    writeFileSync(inFile, text, "utf8");
    writeFileSync(psFile, `\uFEFF${PS_SCRIPT}`, "utf8");
    await runPowerShell(
      ["-File", psFile, "-In", inFile, "-Out", outFile, "-Voice", opts.voice ?? "", "-Rate", String(clampRate(opts.rate))],
      opts.timeoutMs ?? 120000,
    );
    const data = new Uint8Array(readFileSync(outFile));
    if (!data.length) throw new Error("本机配音返回了空文件");
    return { data, mime: "audio/wav" };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录删不掉就算了 */
    }
  }
}

export const windowsTts: ModelAdapter = {
  type: "windows-tts",
  label: "本机配音（Windows 免费离线）",
  capabilities: ["tts"],
  configFields: [
    {
      key: "voice",
      label: "音色关键字",
      type: "text",
      placeholder: "留空自动选中文；可填 Huihui / Kangkang / Yaoyao",
    },
    {
      key: "rate",
      label: "语速",
      type: "select",
      defaultValue: "0",
      options: [
        { value: "-3", label: "很慢" },
        { value: "-1", label: "稍慢" },
        { value: "0", label: "正常" },
        { value: "2", label: "稍快" },
        { value: "4", label: "很快" },
      ],
    },
  ],

  async test(config): Promise<TestResult> {
    const start = Date.now();
    try {
      const r = await windowsSpeak({ text: "本机配音可用", voice: config.voice, rate: config.rate, timeoutMs: 60000 });
      return { ok: true, latencyMs: Date.now() - start, message: `不需要密钥，已合成 ${Math.round(r.data.length / 1024)}KB 音频` };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : String(e) };
    }
  },

  async generateSpeech(config, req) {
    return windowsSpeak({ text: req.text, voice: req.voice || config.voice, rate: config.rate });
  },
};
