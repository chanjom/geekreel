import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiJson } from "../lib/api";
import { iconPlay, iconSpark } from "../lib/icons";

type Stage = "plan" | "bible" | "cast" | "shots" | "render" | "done";
type Status = "running" | "waiting" | "done" | "failed" | "aborted";

interface Plan {
  title: string;
  story: string;
  episodeCount: number;
  secondsPerEpisode: number;
  packId: string | null;
  styleHint: string;
  platform: string;
  audience: string;
  estimatedYuan: number;
  ask: string;
}

interface Run {
  id: string;
  projectId: string | null;
  pipelineId: string | null;
  brief: string;
  status: Status;
  stage: Stage;
  plan: Plan | null;
  detail: Record<string, unknown>;
  budgetCents: number;
  spentCents: number;
  spentEstimated: boolean;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

const STEPS: Array<{ key: Stage; label: string; hint: string }> = [
  { key: "plan", label: "方案", hint: "定集数、时长、风格" },
  { key: "bible", label: "人物", hint: "认角色、画定妆" },
  { key: "cast", label: "分集", hint: "拆集、排分镜" },
  { key: "shots", label: "第 1 集", hint: "出片" },
  { key: "render", label: "合成", hint: "字幕、音轨、导出" },
];

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

/** 当前看的是哪一条，记在地址里：刷新不丢、能直接发给别人看 */
function readIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("id");
}

function writeIdToUrl(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  window.history.replaceState(null, "", url);
}

function stepIndex(stage: Stage): number {
  if (stage === "done") return STEPS.length;
  return Math.max(STEPS.findIndex((s) => s.key === stage), 0);
}

export function DirectorPage() {
  const qc = useQueryClient();
  const [activeId, setActiveIdState] = useState<string | null>(readIdFromUrl);
  const setActiveId = (id: string | null) => {
    setActiveIdState(id);
    writeIdToUrl(id);
  };
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState(20);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: runs } = useQuery({
    queryKey: ["agent-runs"],
    queryFn: () => api<Run[]>("/api/agent"),
    refetchInterval: 15_000,
  });

  const { data: run, error: runError } = useQuery({
    queryKey: ["agent-run", activeId],
    queryFn: () => api<Run>(`/api/agent/${activeId}`),
    enabled: !!activeId,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2500 : false),
  });

  async function act(fn: () => Promise<Run>) {
    setBusy(true);
    setError("");
    try {
      const next = await fn();
      setActiveId(next.id);
      setNote("");
      setBrief("");
      qc.setQueryData(["agent-run", next.id], next);
      void qc.invalidateQueries({ queryKey: ["agent-runs"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const started = !!activeId;
  const canAct = run?.status === "waiting" && !busy;

  return (
    <div className="flex h-full">
      {/* 左：历史 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          <span className="text-xs font-medium text-fg-dim">拍过的</span>
          <button
            className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-dim hover:border-accent-dim hover:text-fg"
            onClick={() => {
              setActiveId(null);
              setError("");
            }}
          >
            新开
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {!runs?.length && <p className="px-2 py-3 text-[11px] leading-relaxed text-fg-faint">还没有。右边写一句你想拍什么。</p>}
          {runs?.map((r) => (
            <button
              key={r.id}
              onClick={() => setActiveId(r.id)}
              className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                r.id === activeId ? "bg-panel-2 text-fg" : "text-fg-dim hover:bg-panel-2/60"
              }`}
            >
              <div className="truncate text-xs">{r.plan?.title || r.brief.slice(0, 12)}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-fg-faint">
                <span>{statusLabel(r.status, r.stage)}</span>
                {r.spentCents > 0 && <span>· {yuan(r.spentCents)}</span>}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* 右：主区 */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          <h1 className="text-lg font-semibold">导演模式</h1>
          <p className="mt-1 text-xs text-fg-faint">
            说一句你想拍什么。我拆剧本、定人物、出第 1 集，每一步停下来给你看；不满意就说一句，我改这一点，不重跑整部。
          </p>

          {/* 起手 */}
          {!started && (
            <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={3}
                placeholder="例：做个外卖员被富家女看不起、后来发现自己是大股东的 3 集短剧，每集 15 秒，抖音"
                className="w-full resize-y rounded-xl border border-line bg-panel-2 p-3 text-sm outline-none focus:border-accent-dim"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-fg-dim">
                  预算上限
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value) || 20)}
                    className="w-20 rounded-lg border border-line bg-panel-2 px-2 py-1 text-center text-xs outline-none focus:border-accent-dim"
                  />
                  元
                </label>
                <button
                  disabled={busy || !brief.trim()}
                  onClick={() =>
                    act(async () => {
                      const r = await apiJson<Run>("/api/agent/start", "post", { brief, budgetYuan: budget });
                      setActiveId(r.id);
                      return r;
                    })
                  }
                  className="ml-auto flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
                >
                  {iconSpark({ className: "h-4 w-4" })}
                  {busy ? "拆方案中…" : "开工"}
                </button>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
                花钱顺序：先认人物、画定妆（每角色几张图，几毛钱），再拆集排分镜，最后第 1 集出视频（最贵，按秒算）。
                超过预算我会停下来。端点没填单价时按公开价估算。
              </p>
            </section>
          )}

          {error && <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{error}</p>}

          {started && !run && (
            <div className="mt-6 rounded-xl border border-line bg-panel px-4 py-3 text-xs text-fg-faint">
              {runError ? (
                <>
                  这一条找不到了（可能数据目录换过）。
                  <button className="ml-1 text-accent hover:underline" onClick={() => setActiveId(null)}>
                    新开一部
                  </button>
                </>
              ) : (
                "读取中…"
              )}
            </div>
          )}

          {/* 当前这次 */}
          {started && run && (
            <>
              <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {STEPS.map((s, i) => {
                    const done = stepIndex(run.stage) > i || run.stage === "done";
                    const now = run.stage === s.key;
                    return (
                      <div key={s.key} className="flex items-center gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] ${
                            done
                              ? "bg-accent/15 text-accent"
                              : now
                                ? "bg-accent text-black"
                                : "border border-line text-fg-faint"
                          }`}
                          title={s.hint}
                        >
                          {s.label}
                        </span>
                        {i < STEPS.length - 1 && <span className="text-[10px] text-fg-faint">→</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="shrink-0 text-right text-[11px] text-fg-faint">
                  <div>
                    {run.spentEstimated ? "≈" : ""}
                    {yuan(run.spentCents)} / {yuan(run.budgetCents)}
                  </div>
                </div>
              </div>

              <div className="mt-4">{renderCard(run)}</div>

              {/* 操作 */}
              <div className="mt-4 rounded-xl border border-line bg-panel p-4">
                {run.status === "running" && (
                  <div className="flex items-center gap-2 text-xs text-fg-dim">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                    {runningLabel(run)}
                  </div>
                )}

                {run.status === "failed" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="flex-1 text-xs text-amber-300">{run.note || "这一步失败了"}</p>
                    <button
                      disabled={busy}
                      onClick={() => act(() => apiJson<Run>(`/api/agent/${run.id}/retry`, "post"))}
                      className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-black disabled:opacity-40"
                    >
                      重试这一步
                    </button>
                  </div>
                )}

                {run.status === "waiting" && (
                  <>
                    {run.stage === "cast" ? (
                      <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11px] leading-relaxed text-fg-faint">
                        分集和分镜都排好了，从这一步往后就锁死了：改角色或分镜，点右下角「在画布上自己改」；改集数只能点「停在这里」重开一部（在「方案」那一步改最省钱）。
                      </p>
                    ) : (
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={noteHint(run.stage)}
                        className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-dim"
                      />
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {note.trim() ? (
                        <button
                          disabled={!canAct}
                          onClick={() =>
                            act(() =>
                              apiJson<Run>(`/api/agent/${run.id}/confirm`, "post", { note: note.trim() }),
                            )
                          }
                          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-black disabled:opacity-40"
                        >
                          按这句改
                        </button>
                      ) : (
                        <button
                          disabled={!canAct}
                          onClick={() => act(() => apiJson<Run>(`/api/agent/${run.id}/confirm`, "post", {}))}
                          className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-black disabled:opacity-40"
                        >
                          {confirmLabel(run.stage)}
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => act(() => apiJson<Run>(`/api/agent/${run.id}/abort`, "post"))}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim hover:border-amber-500/40"
                      >
                        停在这里
                      </button>
                      {run.projectId && (
                        <a
                          href={`/canvas?project=${run.projectId}`}
                          className="ml-auto text-[11px] text-fg-faint hover:text-accent"
                        >
                          在画布上自己改 →
                        </a>
                      )}
                    </div>
                  </>
                )}

                {run.status === "done" && (
                  <p className="text-xs text-fg-dim">
                    做完了。{run.projectId && <a className="text-accent" href={`/projects?open=${run.projectId}`}>去项目里看全部成片 →</a>}
                  </p>
                )}

                {run.status === "aborted" && <p className="text-xs text-fg-faint">已停下。已经生成的东西都还在项目里，可以接着手工做。</p>}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ 卡片 */

function renderCard(run: Run) {
  const d = run.detail;

  if (run.stage === "plan" && run.plan) {
    const p = run.plan;
    return (
      <section className="rounded-2xl border border-line bg-panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{p.title}</h2>
            <p className="mt-1 text-[11px] text-fg-faint">
              {p.episodeCount} 集 × {p.secondsPerEpisode} 秒 · {p.platform}
              {p.styleHint ? ` · ${p.styleHint}` : ""}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-panel-2 px-2.5 py-1 text-[11px] text-fg-dim">
            预估 {`¥${p.estimatedYuan}`}
          </span>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg-dim">{p.story}</p>
        {p.audience && <p className="mt-3 text-[11px] text-fg-faint">给谁看：{p.audience}</p>}
        {p.ask && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            我还想问一句：{p.ask}
          </p>
        )}
      </section>
    );
  }

  if (run.stage === "bible" || (run.stage === "cast" && d.cast)) {
    const cast = (d.cast as Array<{ id: string; name: string; identity: string; imageAssetId: string | null }> | undefined) ?? [];
    const episodes = (d.episodes as Array<{ index: number; title: string; summary: string; shotCount: number }> | undefined) ?? [];
    return (
      <section className="rounded-2xl border border-line bg-panel p-5">
        <h2 className="text-base font-semibold">{(d.title as string) || "剧本"}</h2>

        <div className="mt-4">
          <p className="mb-2 text-[11px] text-fg-faint">人物</p>
          <div className="flex flex-wrap gap-2">
            {cast.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-xl border border-line bg-panel-2 px-2 py-1.5">
                {c.imageAssetId ? (
                  <img src={`/api/assets/${c.imageAssetId}/file?variant=thumb`} alt={c.name} className="h-8 w-8 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-panel text-[11px] text-fg-faint">
                    {c.name.slice(0, 1)}
                  </div>
                )}
                <div>
                  <div className="text-xs text-fg">{c.name}</div>
                  <div className="text-[10px] text-fg-faint">{c.identity}</div>
                </div>
              </div>
            ))}
            {!cast.length && <p className="text-xs text-fg-faint">还没认出角色</p>}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-[11px] text-fg-faint">分集</p>
          <div className="space-y-1.5">
            {episodes.map((e) => (
              <div key={e.index} className="rounded-lg border border-line bg-panel-2 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fg">
                    第 {e.index} 集 · {e.title}
                  </span>
                  <span className="text-[10px] text-fg-faint">{e.shotCount} 镜</span>
                </div>
                {e.summary && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg-faint">{e.summary}</p>}
              </div>
            ))}
            {!episodes.length && <p className="text-xs text-fg-faint">还没拆集</p>}
          </div>
        </div>
      </section>
    );
  }

  if (run.stage === "shots") {
    const shotCount = Number(d.shotCount ?? 0);
    const lips = Number(d.lipsMissed ?? 0);
    const skipped = Number(d.lipsSkipped ?? 0);
    const videoCount = Number(d.videoCount ?? shotCount);
    const videoFailed = Number(d.videoFailed ?? 0);
    const errors = (d.videoErrors as string[] | undefined) ?? [];
    const noVideo = shotCount > 0 && videoCount === 0;
    return (
      <section className="rounded-2xl border border-line bg-panel p-5">
        <h2 className="text-base font-semibold">{noVideo ? "第 1 集只有图片" : "第 1 集出来了"}</h2>

        {noVideo && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5">
            <p className="text-xs font-medium text-red-300">
              {videoFailed || shotCount} 个镜头的视频都没出来，现在合成出来会是一张张图配字幕——就是「像 PPT」那种。
            </p>
            {errors.length > 0 && <p className="mt-1 break-all text-[11px] text-red-300/80">{errors[0]}</p>}
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg-dim">
              多半是视频模型没开通或者额度用完了，去「模型」页试一下那个视频端点，修好回来点「重出这一集」。
            </p>
          </div>
        )}

        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Metric label="镜头" value={`${shotCount} 个`} />
          <Metric label="真视频" value={noVideo ? "0 个" : `${videoCount} / ${shotCount}`} />
          <Metric label="对口型" value={lips ? `${lips} 镜没过` : skipped ? `${skipped} 镜走配音` : "全部通过"} />
          <Metric label="累计花费" value={`${run.spentEstimated ? "≈" : ""}${yuan(run.spentCents)}`} />
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
          {noVideo
            ? "建议先别合成。修好视频端点后，在下面写一句（比如「重出这一集」）再点按钮重跑。"
            : "满意就合成（配字幕、混音、导出 MP4）；不满意在下面写一句，比如「第 2 镜换成近景，人物表情再狠一点」，我重出这一集。"}
        </p>
      </section>
    );
  }

  if (run.stage === "render") {
    return (
      <section className="rounded-2xl border border-line bg-panel p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {iconPlay({ className: "h-4 w-4 text-accent" })}
          合成中
        </h2>
        <p className="mt-2 text-xs text-fg-dim">正在烧字幕、混音轨、导出 MP4。这一步不花钱，就是等。</p>
      </section>
    );
  }

  if (run.stage === "done") {
    const assetId = d.assetId as string | undefined;
    const ms = Number(d.durationMs ?? 0);
    return (
      <section className="rounded-2xl border border-line bg-panel p-5">
        <h2 className="text-base font-semibold">成片</h2>
        {assetId ? (
          <video
            src={`/api/assets/${assetId}/file?variant=original`}
            controls
            className="mt-3 max-h-[60vh] w-full rounded-xl bg-black object-contain"
          />
        ) : (
          <p className="mt-2 text-xs text-fg-faint">没拿到成片地址，去项目里看。</p>
        )}
        <p className="mt-3 text-[11px] text-fg-faint">
          {ms > 0 ? `${(ms / 1000).toFixed(1)} 秒 · ` : ""}
          总花费 {run.spentEstimated ? "≈" : ""}
          {yuan(run.spentCents)}（预算 {yuan(run.budgetCents)}
          {run.spentEstimated ? "，按公开价估算" : ""}）
        </p>
      </section>
    );
  }

  return <section className="rounded-2xl border border-line bg-panel p-5 text-xs text-fg-faint">等下一步…</section>;
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2">
      <dt className="text-[10px] text-fg-faint">{props.label}</dt>
      <dd className="mt-0.5 text-xs text-fg">{props.value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ 文案 */

function statusLabel(status: Status, stage: Stage): string {
  if (status === "done") return "已出片";
  if (status === "aborted") return "已停";
  if (status === "failed") return "卡住了";
  if (status === "running") return "在跑";
  const step = STEPS.find((s) => s.key === stage);
  return step ? `等你确认${step.label}` : "等你";
}

function runningLabel(run: Run): string {
  const msg = typeof run.detail.message === "string" ? run.detail.message : "";
  const p = typeof run.detail.progress === "number" ? Math.round(run.detail.progress * 100) : null;
  if (msg && p !== null) return `${msg} · ${p}%`;
  if (msg) return msg;
  return "在跑，别关页面";
}

function confirmLabel(stage: Stage): string {
  if (stage === "plan") return "就按这个拍";
  if (stage === "bible") return "人物对了，去分集";
  if (stage === "cast") return "分镜没问题，出第 1 集";
  if (stage === "shots") return "这集可以，合成导出";
  return "继续";
}

function noteHint(stage: Stage): string {
  if (stage === "plan") return "想改哪里？比如「改成 5 集，女主年龄再大一点，平台换快手」";
  if (stage === "bible") return "想改哪个角色？比如「女主换成熟一点，穿西装」";
  if (stage === "cast") return "想改哪里？比如「第 2 集冲突太弱，加一个反转」";
  if (stage === "shots") return "想改哪里？比如「第 3 镜换成特写，光线暗一点」";
  return "";
}
