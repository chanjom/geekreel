/**
 * 扣子（Coze）工作流当视频模型用。
 *
 * 为什么走这条路：火山方舟的 Seedance 2.0 要单独激活（资源包或余额门槛），
 * 而扣子把 Seedance 做成了「视频生成节点」，扣子套餐用户直接能用。
 * 代价是它不是一个标准视频 API，而是一个工作流：你给参数，它跑一遍，吐出 url。
 *
 * 所以这里只做三件事：把图传上去换 file_id、带参数跑工作流、轮询到 url 再下载。
 * 工作流的输入参数名每家不一样（prompt / image / duration 是常见叫法，但可以改），
 * 因此全部做成可配字段，而不是写死。
 */

import type { ModelAdapter, TestResult, VideoGenResult } from "./index";
import type { VideoGenRequest } from "./blobs";
import { downloadBytes, sleep } from "./video";

const DEFAULT_BASE = "https://api.coze.cn";

/** 从工作流输出里抠出视频地址。输出常常是一层层转义的 JSON 字符串。 */
export function pickVideoUrl(text: string): string | null {
  if (!text) return null;
  const m = /https?:\/\/[^\s"'\\<>()]+?\.(?:mp4|mov|webm)(?:\?[^\s"'\\<>()]*)?/i.exec(text);
  return m ? m[0] : null;
}

function auth(config: Record<string, string>) {
  const token = String(config.token ?? config.apiKey ?? "").trim();
  if (!token) throw new Error("扣子令牌没填");
  const base = String(config.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  return { token, base };
}

function readMsg(text: string): string {
  try {
    const j = JSON.parse(text) as { msg?: string; code?: number };
    return [j.code ? `[${j.code}]` : "", j.msg ?? ""].join(" ").trim() || text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

async function uploadImage(
  base: string,
  token: string,
  img: { mime: string; data: Uint8Array },
  name: string,
  signal?: AbortSignal,
): Promise<string> {
  const fd = new FormData();
  // Uint8Array 的底层可能是 SharedArrayBuffer，直接塞进 Blob 类型不过，拷一份干净的。
  const buf = img.data.slice().buffer as ArrayBuffer;
  fd.append("file", new Blob([buf], { type: img.mime || "image/png" }), name);
  const res = await fetch(`${base}/v1/files/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
    signal: signal ?? null,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`扣子传图失败：${readMsg(text)}`);
  const j = JSON.parse(text) as { code?: number; data?: { id?: string }; msg?: string };
  if (j.code !== 0 || !j.data?.id) throw new Error(`扣子传图失败：${j.msg || text.slice(0, 160)}`);
  return j.data.id;
}

export const cozeWorkflow: ModelAdapter = {
  type: "coze-workflow",
  label: "扣子工作流（视频）",
  capabilities: ["video"],
  configFields: [
    { key: "token", label: "访问令牌", type: "password", required: true, placeholder: "pat_…" },
    { key: "workflowId", label: "工作流 ID", type: "text", required: true, placeholder: "744208683…" },
    {
      key: "promptField",
      label: "提示词参数名",
      type: "text",
      defaultValue: "prompt",
      placeholder: "工作流开始节点里那个文本变量",
    },
    {
      key: "imageField",
      label: "首帧图参数名",
      type: "text",
      defaultValue: "image",
      placeholder: "留空＝不传图（纯文生视频，人物会漂）",
    },
    { key: "durationField", label: "时长参数名", type: "text", defaultValue: "duration", placeholder: "留空＝不传" },
    { key: "ratioField", label: "画幅参数名", type: "text", defaultValue: "ratio", placeholder: "留空＝不传" },
    {
      key: "ratio",
      label: "画幅",
      type: "select",
      defaultValue: "9:16",
      options: [
        { value: "9:16", label: "9:16 竖屏（短剧）" },
        { value: "16:9", label: "16:9 横屏" },
        { value: "1:1", label: "1:1 方形" },
      ],
    },
    {
      key: "model",
      label: "工作流里的模型（仅备注）",
      type: "text",
      placeholder: "如 doubao-seedance-2.0，写清方便以后换",
    },
  ],

  async test(config): Promise<TestResult> {
    const start = Date.now();
    try {
      const { token, base } = auth(config);
      const id = String(config.workflowId ?? "").trim();
      if (!id) return { ok: false, latencyMs: 0, message: "没填工作流 ID" };
      const res = await fetch(`${base}/v1/workflows/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await res.text();
      const latencyMs = Date.now() - start;
      if (res.status === 401 || res.status === 403) return { ok: false, latencyMs, message: readMsg(text) };
      if (res.status === 404) return { ok: false, latencyMs, message: `工作流 ${id} 找不到，或没发布` };
      return { ok: res.ok, latencyMs, message: res.ok ? "令牌与工作流都对得上" : readMsg(text) };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : String(e) };
    }
  },

  async generateVideo(config, req: VideoGenRequest): Promise<VideoGenResult> {
    const { token, base } = auth(config);
    const workflowId = String(config.workflowId ?? "").trim();
    if (!workflowId) throw new Error("扣子视频端点没填工作流 ID");

    const params: Record<string, unknown> = {};
    const promptField = String(config.promptField ?? "prompt").trim();
    if (promptField) params[promptField] = req.prompt;

    const imageField = String(config.imageField ?? "image").trim();
    // 首帧是人物不漂的关键。没有就退化成纯文生视频，每个镜头重新长一张脸。
    if (imageField && req.image?.data?.length) {
      const fileId = await uploadImage(base, token, req.image, "first.png", req.signal);
      params[imageField] = JSON.stringify({ file_id: fileId });
    }

    const durationField = String(config.durationField ?? "duration").trim();
    if (durationField) params[durationField] = Math.round(req.durationSec || 5);

    const ratioField = String(config.ratioField ?? "ratio").trim();
    if (ratioField && config.ratio) params[ratioField] = config.ratio;

    const runOnce = (isAsync: boolean) =>
      fetch(`${base}/v1/workflow/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: workflowId,
          parameters: JSON.stringify(params),
          ...(isAsync ? { is_async: true } : {}),
        }),
        signal: req.signal ?? null,
      });

    let res = await runOnce(true);
    let text = await res.text();
    let body = JSON.parse(text) as { code?: number; msg?: string; data?: string; execute_id?: string };

    // 异步是付费版功能。免费版会报 6003，退回同步——但同步接口 90 秒就断，
    // 5 秒的视频通常来得及，来不及就让上层如实报错，别装作成功。
    if (body.code === 6003) {
      res = await runOnce(false);
      text = await res.text();
      body = JSON.parse(text) as typeof body;
    }
    if (body.code !== 0) throw new Error(`扣子工作流没跑起来：${readMsg(text)}`);

    let output = body.data ?? "";
    if (body.execute_id) {
      const poll = `${base}/v1/workflows/${encodeURIComponent(workflowId)}/run_histories/${encodeURIComponent(body.execute_id)}`;
      for (let i = 0; i < 120; i++) {
        await sleep(5000, req.signal);
        const r = await fetch(poll, { headers: { Authorization: `Bearer ${token}` }, signal: req.signal ?? null });
        const t = await r.text();
        if (!r.ok) throw new Error(`扣子查结果失败：${readMsg(t)}`);
        const j = JSON.parse(t) as {
          code?: number;
          msg?: string;
          data?: Array<{ execute_status?: string; output?: string; error_message?: string }>;
        };
        const row = j.data?.[0];
        if (!row) continue;
        if (row.execute_status === "Fail") throw new Error(`扣子工作流执行失败：${row.error_message || j.msg || "没说原因"}`);
        if (row.execute_status === "Success") {
          output = row.output ?? "";
          break;
        }
      }
    }

    const url = pickVideoUrl(output);
    if (!url) throw new Error(`工作流跑完了但没找到视频地址：${String(output).slice(0, 200)}`);

    const data = await downloadBytes(url, undefined, req.signal);
    return { data, mime: "video/mp4", durationSec: req.durationSec };
  },
};
