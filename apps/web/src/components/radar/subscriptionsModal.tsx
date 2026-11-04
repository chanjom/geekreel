import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  pushChannelLabels,
  type PushChannel,
  type PushChannelType,
  type RadarSettings,
  type RadarSub,
} from "@vw/core";
import { api, apiJson } from "../../lib/api";
import { confirmDanger } from "../../lib/prefs";
import { iconTrash } from "../../lib/icons";
import { Modal } from "../modal";

interface PushField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder: string;
}

interface PushType {
  type: PushChannelType;
  label: string;
  fields: PushField[];
}

const inputCls =
  "h-8 w-full rounded-md border border-line bg-panel-2 px-2 text-xs outline-none placeholder:text-fg-faint focus:border-accent/60";
const labelCls = "mb-1 block text-[11px] text-fg-faint";
const btnGhost =
  "rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:border-accent/40 hover:text-fg disabled:opacity-40";
const btnAccent =
  "rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-black hover:brightness-110 disabled:opacity-40";

/** 关键词订阅 + 推送渠道 + 早报，一处管理 */
export function SubscriptionsModal({
  platforms,
  prefill,
  onClose,
}: {
  platforms: string[];
  prefill?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: subs } = useQuery({
    queryKey: ["radar-subs"],
    queryFn: () => api<RadarSub[]>("/api/radar/subs"),
  });
  const { data: channels } = useQuery({
    queryKey: ["push-channels"],
    queryFn: () => api<PushChannel[]>("/api/push/channels"),
  });
  const { data: types } = useQuery({
    queryKey: ["push-types"],
    queryFn: () => api<PushType[]>("/api/push/types"),
  });
  const { data: settings } = useQuery({
    queryKey: ["radar-settings"],
    queryFn: () => api<RadarSettings>("/api/radar/settings"),
  });

  // 新增订阅
  const [kw, setKw] = useState(prefill ?? "");
  const [kwPlatforms, setKwPlatforms] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(60);
  const [kwChannels, setKwChannels] = useState<string[]>([]);
  const [addingKw, setAddingKw] = useState(!!prefill);

  // 新增渠道
  const [chType, setChType] = useState<PushChannelType>("serverchan");
  const [chName, setChName] = useState("");
  const [chConfig, setChConfig] = useState<Record<string, string>>({});
  const [addingCh, setAddingCh] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["radar-subs"] });
    void qc.invalidateQueries({ queryKey: ["push-channels"] });
    void qc.invalidateQueries({ queryKey: ["radar-settings"] });
  };

  const guard = async (fn: () => Promise<void>, okText?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      refresh();
      if (okText) setMsg({ kind: "ok", text: okText });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const addSub = () =>
    guard(async () => {
      if (!kw.trim()) throw new Error("请填写要盯的关键词");
      await apiJson<RadarSub>("/api/radar/subs", "post", {
        keyword: kw.trim(),
        platforms: kwPlatforms,
        heatThreshold: threshold,
        channelIds: kwChannels,
      });
      setKw("");
      setKwPlatforms([]);
      setKwChannels([]);
      setAddingKw(false);
    }, "订阅已保存，之后抓到匹配热点会推送");

  const addChannel = () =>
    guard(async () => {
      if (!chName.trim()) throw new Error("给渠道起个名字，方便在订阅里挑");
      await apiJson<PushChannel>("/api/push/channels", "post", { type: chType, name: chName.trim(), config: chConfig });
      setChName("");
      setChConfig({});
      setAddingCh(false);
    }, "推送渠道已添加，点「测试」验证一下");

  const currentFields = types?.find((t) => t.type === chType)?.fields ?? [];

  return (
    <Modal title="订阅与推送" onClose={onClose} width="w-[760px]">
      <div className="space-y-6">
        {msg && (
          <div
            className={`rounded-lg px-3 py-2 text-xs ${
              msg.kind === "ok" ? "bg-emerald-950/40 text-emerald-300" : "bg-red-950/30 text-red-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* ---------------- 关键词订阅 ---------------- */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-medium">关键词订阅</h4>
              <p className="mt-0.5 text-[11px] text-fg-faint">抓到含这个词、且热度够的热点，就推到下面的渠道。</p>
            </div>
            <button className={btnGhost} onClick={() => setAddingKw((v) => !v)}>
              {addingKw ? "收起" : "＋ 加订阅"}
            </button>
          </div>

          {addingKw && (
            <div className="mb-3 space-y-2.5 rounded-lg border border-line bg-panel-2/40 p-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className={labelCls}>关键词</label>
                  <input
                    className={inputCls}
                    placeholder="比如：AI、限时、悬疑"
                    value={kw}
                    onChange={(e) => setKw(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void addSub()}
                  />
                </div>
                <div className="w-[110px]">
                  <label className={labelCls}>热度 ≥ {threshold}</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="mt-2 w-full accent-[var(--color-accent)]"
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>平台（不选＝全部平台）</label>
                <div className="flex flex-wrap gap-1.5">
                  {platforms.map((p) => (
                    <button
                      key={p}
                      className={`rounded-md px-2 py-0.5 text-[11px] ${
                        kwPlatforms.includes(p) ? "bg-accent/15 text-accent" : "bg-panel text-fg-dim hover:text-fg"
                      }`}
                      onClick={() => setKwPlatforms((l) => toggleIn(l, p))}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>推到哪些渠道（不选＝不推送，只在站内看）</label>
                <div className="flex flex-wrap gap-1.5">
                  {(channels ?? []).length === 0 && (
                    <span className="text-[11px] text-fg-faint">还没有渠道，先到下面加一个</span>
                  )}
                  {(channels ?? []).map((ch) => (
                    <button
                      key={ch.id}
                      className={`rounded-md px-2 py-0.5 text-[11px] ${
                        kwChannels.includes(ch.id) ? "bg-sky-500/15 text-sky-300" : "bg-panel text-fg-dim hover:text-fg"
                      }`}
                      onClick={() => setKwChannels((l) => toggleIn(l, ch.id))}
                    >
                      {ch.name}
                      <span className="ml-1 text-[10px] opacity-60">{pushChannelLabels[ch.type]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button className={btnGhost} onClick={() => setAddingKw(false)}>
                  取消
                </button>
                <button className={btnAccent} disabled={busy} onClick={() => void addSub()}>
                  保存订阅
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            {(subs ?? []).length === 0 && !addingKw && (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-[11px] text-fg-faint">
                还没有订阅。加一个关键词，让雷达替你盯着。
              </div>
            )}
            {(subs ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.enabled ? "bg-accent" : "bg-fg-faint"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{s.keyword}</div>
                  <div className="mt-0.5 truncate text-[10px] text-fg-faint">
                    {s.platforms.length ? s.platforms.join(" / ") : "全部平台"} · 热度 ≥{s.heatThreshold} ·{" "}
                    {s.channelIds.length ? `${s.channelIds.length} 个渠道` : "不推送"}
                  </div>
                </div>
                <button
                  className="text-[11px] text-fg-faint hover:text-fg"
                  disabled={busy}
                  onClick={() =>
                    void guard(async () => {
                      await apiJson<RadarSub>(`/api/radar/subs/${s.id}`, "patch", { enabled: !s.enabled });
                    })
                  }
                >
                  {s.enabled ? "已开" : "已关"}
                </button>
                <button
                  className="text-fg-faint hover:text-red-400"
                  onClick={() => {
                    if (!confirmDanger(`删除订阅「${s.keyword}」？`)) return;
                    void guard(async () => {
                      await apiJson(`/api/radar/subs/${s.id}`, "delete");
                    });
                  }}
                >
                  {iconTrash({ width: 13, height: 13 })}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- 推送渠道 ---------------- */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-medium">推送渠道</h4>
              <p className="mt-0.5 text-[11px] text-fg-faint">密钥加密存在本机，只用于发通知。</p>
            </div>
            <button className={btnGhost} onClick={() => setAddingCh((v) => !v)}>
              {addingCh ? "收起" : "＋ 加渠道"}
            </button>
          </div>

          {addingCh && (
            <div className="mb-3 space-y-2.5 rounded-lg border border-line bg-panel-2/40 p-3">
              <div className="flex gap-2">
                <div className="w-[150px]">
                  <label className={labelCls}>方式</label>
                  <select
                    className={inputCls}
                    value={chType}
                    onChange={(e) => {
                      setChType(e.target.value as PushChannelType);
                      setChConfig({});
                    }}
                  >
                    {(Object.keys(pushChannelLabels) as PushChannelType[]).map((t) => (
                      <option key={t} value={t}>
                        {pushChannelLabels[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className={labelCls}>名字</label>
                  <input
                    className={inputCls}
                    placeholder="比如：我的微信"
                    value={chName}
                    onChange={(e) => setChName(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {currentFields.map((f) => (
                  <div key={f.key}>
                    <label className={labelCls}>{f.label}</label>
                    <input
                      className={inputCls}
                      type={f.secret ? "password" : "text"}
                      placeholder={f.placeholder}
                      value={chConfig[f.key] ?? ""}
                      onChange={(e) => setChConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button className={btnGhost} onClick={() => setAddingCh(false)}>
                  取消
                </button>
                <button className={btnAccent} disabled={busy} onClick={() => void addChannel()}>
                  添加并加密保存
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            {(channels ?? []).length === 0 && !addingCh && (
              <div className="rounded-lg border border-dashed border-line py-6 text-center text-[11px] text-fg-faint">
                还没有推送渠道。加一个 Server酱 / Bark，热点命中就能推到手机。
              </div>
            )}
            {(channels ?? []).map((ch) => (
              <div key={ch.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ch.enabled ? "bg-emerald-400" : "bg-fg-faint"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{ch.name}</div>
                  <div className="mt-0.5 truncate text-[10px] text-fg-faint">
                    {pushChannelLabels[ch.type]}
                    {Object.entries(ch.config)
                      .filter(([, v]) => v)
                      .slice(0, 1)
                      .map(([k, v]) => ` · ${k}=${v}`)}
                  </div>
                </div>
                <button
                  className={btnGhost}
                  disabled={busy}
                  onClick={() =>
                    void guard(async () => {
                      await apiJson(`/api/push/channels/${ch.id}/test`, "post");
                    }, `已发到「${ch.name}」，看看手机收到没`)
                  }
                >
                  测试
                </button>
                <button
                  className="text-fg-faint hover:text-red-400"
                  onClick={() => {
                    if (!confirmDanger(`删除推送渠道「${ch.name}」？`)) return;
                    void guard(async () => {
                      await apiJson(`/api/push/channels/${ch.id}`, "delete");
                    });
                  }}
                >
                  {iconTrash({ width: 13, height: 13 })}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- 早报 ---------------- */}
        <section>
          <h4 className="mb-2 text-xs font-medium">每日早报</h4>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
            <button
              className={`relative h-4 w-8 shrink-0 rounded-full border transition-colors ${
                settings?.digestEnabled ? "border-accent bg-accent/80" : "border-line bg-panel-2"
              }`}
              disabled={busy}
              title={settings?.digestEnabled ? "点一下关掉早报" : "点一下开启早报"}
              onClick={() =>
                void guard(async () => {
                  await apiJson<RadarSettings>("/api/radar/settings", "put", {
                    digestEnabled: !settings?.digestEnabled,
                  });
                })
              }
            >
              <span
                className={`absolute top-[2px] h-[10px] w-[10px] rounded-full transition-all ${
                  settings?.digestEnabled ? "left-[16px] bg-black/75" : "left-[3px] bg-fg-faint"
                }`}
              />
            </button>
            <span className="text-[11px] text-fg-dim">
              {settings?.digestEnabled ? "每天汇总昨日热度前 10 条，推到全部渠道" : "关闭中"}
            </span>
            <select
              className="ml-auto h-7 rounded-md border border-line bg-panel-2 px-2 text-[11px] outline-none"
              value={settings?.digestHour ?? 8}
              disabled={!settings?.digestEnabled || busy}
              onChange={(e) =>
                void guard(async () => {
                  await apiJson<RadarSettings>("/api/radar/settings", "put", { digestHour: Number(e.target.value) });
                })
              }
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </div>
        </section>

        <p className="text-[10px] leading-relaxed text-fg-faint">
          提示：热度是联网模型看完榜单后给的估计值，不是平台官方数字。原文链接一律是去该平台搜这个话题，因为模型经常编造帖子地址。
        </p>
      </div>
    </Modal>
  );
}
