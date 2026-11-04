import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  heatTier,
  platformColor,
  relativeTime,
  topicSearchUrl,
  type Job,
  type RadarItem,
  type RadarPlatformStat,
  type RadarSort,
  type RadarSource,
} from "@vw/core";
import { api, apiJson } from "../lib/api";
import { emptyHomeDraft, parkCurrent, saveHomeDraft } from "../lib/homeDraft";
import { waitForJob } from "../lib/runGen";
import { confirmDanger } from "../lib/prefs";
import {
  iconCheck,
  iconCopy,
  iconPlus,
  iconRadar,
  iconRefresh,
  iconSearch,
  iconTrash,
  iconX,
} from "../lib/icons";
import { SubscriptionsModal } from "../components/radar/subscriptionsModal";

const HEAT_COLOR: Record<"hot" | "warm" | "cool", string> = {
  hot: "#f0603a",
  warm: "#f5b53f",
  cool: "#5f6b80",
};

interface RadarStatus {
  hasWebSearchLlm: boolean;
  hasFeedSources: boolean;
  hotlistPlatforms: string[];
  sourceCount: number;
  enabledCount: number;
  lastRunAt: number | null;
}

export function RadarPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get("item");

  const [platform, setPlatform] = useState("");
  const [draft, setDraft] = useState("");
  const [sort, setSort] = useState<RadarSort>("heat");
  const [freshOnly, setFreshOnly] = useState(false);
  const [busy, setBusy] = useState<null | "refresh" | "search">(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [makingId, setMakingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchHits, setSearchHits] = useState<{ keyword: string; items: RadarItem[] } | null>(null);
  const [subsOpen, setSubsOpen] = useState(searchParams.get("subs") === "1");
  const [subPrefill, setSubPrefill] = useState(searchParams.get("kw") ?? "");

  const { data: status } = useQuery({
    queryKey: ["radar-status"],
    queryFn: () => api<RadarStatus>("/api/radar/status"),
  });
  const { data: sources } = useQuery({
    queryKey: ["radar-sources"],
    queryFn: () => api<RadarSource[]>("/api/radar/sources?board=1"),
  });
  const { data: stats } = useQuery({
    queryKey: ["radar-stats"],
    queryFn: () => api<RadarPlatformStat[]>("/api/radar/stats"),
  });
  const { data: trend } = useQuery({
    queryKey: ["radar-trend"],
    queryFn: () => api<Array<{ date: string; count: number }>>("/api/radar/trend"),
  });
  const boardQ = useQuery({
    queryKey: ["radar-board", platform, sort, freshOnly],
    queryFn: () =>
      api<RadarItem[]>(
        `/api/radar/board?sort=${sort}${platform ? `&platform=${encodeURIComponent(platform)}` : ""}${
          freshOnly ? "&hours=24" : ""
        }`,
      ),
  });

  const items = boardQ.data ?? [];
  const hotlist = status?.hotlistPlatforms ?? [];
  /** 有直连榜单的，或配了联网模型，就能抓 */
  const canFetch = !!status?.hasWebSearchLlm || hotlist.length > 0;
  const platforms = (sources ?? []).map((s) => s.platform);
  const current = (sources ?? []).find((s) => s.platform === platform) ?? null;
  const statOf = (p: string) => (stats ?? []).find((s) => s.platform === p) ?? null;

  const totalCount = (stats ?? []).reduce((n, s) => n + s.count, 0);
  const lastRun = Math.max(0, ...(sources ?? []).map((s) => s.lastRunAt ?? 0));
  const covered = (stats ?? []).filter((s) => s.count > 0).length;
  /**
   * 模型配了、但上次抓取报错了（多半是 key 过期或额度用完）。
   * 只认「认证/额度」类错误——「模型没查到内容」也会写进 lastError，
   * 那不是模型坏了，报成「去模型页配置」会把人带沟里。
   */
  const modelError =
    (stats ?? []).find(
      (s) =>
        s.via === "ai" &&
        s.lastError &&
        /key|auth|invalid|额度|余额|欠费|未授权|认证|401|403/i.test(s.lastError),
    )?.lastError ?? "";
  const modelBroken = !!status?.hasWebSearchLlm && !!modelError;

  /** 输入即筛，回车/按钮才联网搜 */
  const shown = useMemo(() => {
    const kw = draft.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((it) => `${it.title}\n${it.summary}\n${it.heatText}`.toLowerCase().includes(kw));
  }, [items, draft]);

  const spark = useMemo(() => {
    const map = new Map((trend ?? []).map((t) => [t.date, t.count]));
    const pad = (n: number) => String(n).padStart(2, "0");
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return map.get(key) ?? 0;
    });
  }, [trend]);

  // 从推送点进来时定位到那一条
  useEffect(() => {
    if (!highlight || items.length === 0) return;
    const el = document.querySelector(`[data-item-id="${highlight}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight, items.length]);

  const switchPlatform = (p: string) => {
    if (p === platform) return;
    setPlatform(p);
    setDraft("");
    setError("");
    setSearchHits(null);
  };

  const refreshAllKeys = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["radar-board"] }),
      qc.invalidateQueries({ queryKey: ["radar-stats"] }),
      qc.invalidateQueries({ queryKey: ["radar-sources"] }),
      qc.invalidateQueries({ queryKey: ["radar-status"] }),
      qc.invalidateQueries({ queryKey: ["radar-trend"] }),
    ]);
  };

  /** 跑一批平台：单平台＝刷新/搜索，全部＝并行抓 */
  const runFetch = async (mode: "refresh" | "search") => {
    const all = current ? [current] : (sources ?? []);
    if (all.length === 0) {
      setError("还没有可用的平台。先到「模型」页配一个联网文本模型。");
      return;
    }
    if (mode === "search" && !status?.hasWebSearchLlm) {
      setError("搜索要让模型上网查，先到「模型」页加一个勾了「支持联网搜索」的文本模型。");
      return;
    }
    const keyword = mode === "search" ? draft.trim() : "";
    if (mode === "search" && !keyword) return;

    // 点“全部”时，把已知抓不了的平台跳过，别一次弹三个同样的错；单平台仍然照试
    const hot = new Set(hotlist);
    const aiUsable = !!status?.hasWebSearchLlm && !modelBroken;
    const skipped = current || aiUsable ? [] : all.filter((t) => !hot.has(t.platform)).map((t) => t.platform);
    const targets = all.filter((t) => !skipped.includes(t.platform));
    if (targets.length === 0) {
      setError("这几个平台要靠联网文本模型，先去「模型」页配一个。");
      return;
    }

    setError("");
    setNotice("");
    setSearchHits(null);
    setBusy(mode);
    setProgress({ done: 0, total: targets.length });
    setRunning(Object.fromEntries(targets.map((t) => [t.platform, true])));

    const before = new Set(items.map((it) => it.id));
    let inserted = 0;
    let updated = 0;
    const failed: string[] = [];
    // 「这个平台本来就没有公开数据」不算失败，别每次点刷新都弹一堆红字
    const noData: string[] = [];

    await Promise.all(
      targets.map(async (t) => {
        try {
          const job = await apiJson<Job>(`/api/radar/sources/${t.id}/run`, "post", {
            q: keyword || undefined,
          });
          const done = await waitForJob(job.id, 5 * 60_000);
          try {
            const r = JSON.parse(done.resultJson ?? "{}") as { inserted?: number; updated?: number };
            inserted += r.inserted ?? 0;
            updated += r.updated ?? 0;
          } catch {
            /* 结果字段可缺 */
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/没查到近期热点/.test(msg)) noData.push(t.platform);
          else failed.push(`${t.platform}：${msg}`);
        } finally {
          setProgress((p) => ({ ...p, done: p.done + 1 }));
          setRunning((m) => ({ ...m, [t.platform]: false }));
        }
      }),
    );

    setBusy(null);
    setRunning({});
    await refreshAllKeys();

    const skipNote = [
      skipped.length > 0 ? `${skipped.join("、")} 需要联网模型，这次跳过了` : "",
      noData.length > 0 ? `${noData.join("、")} 没有可用的实时榜，这次没抓到` : "",
    ]
      .filter(Boolean)
      .join("；");
    const skipSuffix = skipNote ? `（${skipNote}）` : "";
    if (mode === "search") {
      const fresh = await api<RadarItem[]>("/api/radar/board?sort=heat");
      const hits = fresh.filter((it) => !before.has(it.id));
      setSearchHits({ keyword, items: hits.slice(0, 6) });
      if (hits.length === 0) {
        setNotice(`「${keyword}」这次没有新热点，可能之前已经抓过了。${skipSuffix}`);
      }
    } else {
      setNotice(
        `新增 ${inserted} 条${updated > 0 ? `，${updated} 条旧热点更新了热度` : ""}${
          targets.length > 1 ? `（${targets.length} 个平台）` : ""
        }${skipSuffix}`,
      );
    }
    if (failed.length > 0) setError(`部分平台没抓成：${failed.join("；")}`);
  };

  const makeVideo = async (item: RadarItem) => {
    setError("");
    setMakingId(item.id);
    try {
      const r = await apiJson<{ idea: string; title: string; platform: string; itemId: string }>(
        "/api/radar/to-story",
        "post",
        { itemId: item.id },
      );
      parkCurrent();
      saveHomeDraft({
        ...emptyHomeDraft(),
        idea: r.idea,
        step: "write",
        source: "radar",
        radarItemId: r.itemId,
        radarPlatform: r.platform || item.platform,
      });
      navigate("/?from=radar");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMakingId(null);
    }
  };

  const copyTitle = async (item: RadarItem) => {
    try {
      await navigator.clipboard.writeText(item.title);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((v) => (v === item.id ? null : v)), 1500);
    } catch {
      setError("复制失败，浏览器没给剪贴板权限");
    }
  };

  const removeItem = async (item: RadarItem) => {
    if (!confirmDanger(`把「${item.title}」从雷达里删掉？\n（只是本地删掉，下次刷新如果它还在榜上会再出现）`)) return;
    try {
      await apiJson(`/api/radar/items/${item.id}`, "delete");
      await refreshAllKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const clearBoard = async () => {
    const scope = current ? `「${current.platform}」` : "全部平台";
    if (!confirmDanger(`清空${scope}已抓到的热点？下次刷新会重新抓。`)) return;
    try {
      await apiJson<{ removed: number }>("/api/radar/items/clear", "post", {
        platform: current?.platform,
      });
      setNotice(`已清空 ${scope}的热点`);
      await refreshAllKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openSubs = (keyword?: string) => {
    setSubPrefill(keyword ?? "");
    setSubsOpen(true);
  };

  const showSkeleton = boardQ.isLoading;

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* 标题 */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {iconRadar({ width: 17, height: 17, className: "text-accent" })}
            热点雷达
          </h1>
          <p className="mt-1 text-xs text-fg-faint">
            {hotlist.length > 0
              ? `${hotlist.join("、")} 直连实时榜；其余平台靠联网模型查。热度是按各平台自己的榜单折算成 0–100，同一平台内可比，跨平台别直接比大小。`
              : "靠联网模型去各平台查。热度是按讨论量折算的 0–100，不是平台原始数字。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
              modelBroken
                ? "border-amber-900/60 bg-amber-950/30 text-amber-300"
                : status?.hasWebSearchLlm
                  ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300"
                  : hotlist.length
                    ? "border-sky-900/60 bg-sky-950/30 text-sky-300"
                    : "border-amber-900/60 bg-amber-950/30 text-amber-300"
            }`}
            title={
              modelBroken
                ? `上次抓取报错：${modelError}`
                : status?.hasWebSearchLlm
                  ? "有会联网的文本模型，微博/知乎/小红书 也能查"
                  : "没有联网模型，只有能直连官方榜单的平台可抓"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                modelBroken
                  ? "bg-amber-400"
                  : status?.hasWebSearchLlm
                    ? "bg-emerald-400"
                    : hotlist.length
                      ? "bg-sky-400"
                      : "bg-amber-400"
              }`}
            />
            {modelBroken
              ? "联网模型报错"
              : status?.hasWebSearchLlm
                ? "联网模型就绪"
                : hotlist.length
                  ? `直连榜单 · ${hotlist.join(" / ")}`
                  : "未配置数据源"}
          </span>
          <button
            className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-fg-dim hover:border-accent/40 hover:text-fg"
            onClick={() => openSubs()}
          >
            订阅与推送
          </button>
        </div>
      </div>

      {status && (!status.hasWebSearchLlm || modelBroken) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-900/50 bg-amber-950/25 px-4 py-3 text-xs text-amber-200">
          <span className="min-w-0 flex-1">
            {modelBroken
              ? `联网模型报错了（${modelError.slice(0, 60)}），微博 / 知乎 / 小红书 暂时抓不到。`
              : "微博 / 知乎 / 小红书 要靠会联网的文本模型查，现在没有可用的模型。"}
            {hotlist.length > 0 && `${hotlist.join("、")} 可以直接刷新，不受影响。`}
          </span>
          <button className="shrink-0 underline hover:text-amber-100" onClick={() => navigate("/models")}>
            去模型页 →
          </button>
        </div>
      )}

      {/* 平台页签 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <PlatformTab
          label="全部"
          count={totalCount}
          active={platform === ""}
          onClick={() => switchPlatform("")}
        />
        {(sources ?? []).map((s) => {
          const st = statOf(s.platform);
          return (
            <PlatformTab
              key={s.id}
              label={s.platform}
              count={st?.count ?? 0}
              active={platform === s.platform}
              running={!!running[s.platform]}
              error={st?.lastError}
              via={st?.via}
              onClick={() => switchPlatform(s.platform)}
            />
          );
        })}
        <span className="ml-auto text-[10px] text-fg-faint">热度：榜单折算 / AI 估计</span>
      </div>

      {platform === "小红书" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          <span>
            小红书没有公开榜单，也没有能直连的源——这里的内容是模型从媒体报道反推的，可能滞后，也可能就是空的。
            想看真实热度，切到 {hotlist.filter((p) => p !== "小红书").join(" / ")}。
          </span>
        </div>
      )}

      {/* 工具条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 sm:max-w-sm">
          {iconSearch({ width: 13, height: 13, className: "shrink-0 text-fg-faint" })}
          <input
            className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-fg-faint"
            placeholder={
              current ? `在${current.platform}搜，回车联网查` : "在已抓到的热点里筛，回车搜全部平台"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (draft.trim()) void runFetch("search");
              }
              if (e.key === "Escape") setDraft("");
            }}
          />
          {draft && (
            <button
              type="button"
              className="shrink-0 text-fg-faint hover:text-fg"
              title="清除"
              onClick={() => setDraft("")}
            >
              {iconX({ width: 12, height: 12 })}
            </button>
          )}
        </div>
        <button
          className="h-9 rounded-lg border border-line px-3 text-[11px] text-fg-dim hover:border-accent/40 hover:text-fg disabled:opacity-40"
          disabled={!status?.hasWebSearchLlm || !!busy || !draft.trim()}
          title={
            !status?.hasWebSearchLlm
              ? "搜索要让模型上网查，先到「模型」页配一个联网文本模型"
              : current
                ? `联网查${current.platform}上关于这个词的热点`
                : `会同时问 ${sources?.length ?? 0} 个平台，调用 ${sources?.length ?? 0} 次模型`
          }
          onClick={() => void runFetch("search")}
        >
          {busy === "search" ? "在搜…" : current ? "搜索" : "搜全部平台"}
        </button>
        <button
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-black hover:brightness-110 disabled:opacity-40"
          disabled={!canFetch || !!busy}
          onClick={() => void runFetch("refresh")}
        >
          {iconRefresh({ width: 13, height: 13 })}
          {busy === "refresh"
            ? progress.total > 1
              ? `抓取中 ${progress.done}/${progress.total}`
              : "正在问模型…"
            : current
              ? `刷新${current.platform}`
              : `刷新全部 ${sources?.length ?? ""} 个平台`}
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(
              [
                ["heat", "按热度"],
                ["time", "按最新"],
              ] as Array<[RadarSort, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                className={`px-2.5 py-1.5 text-[11px] ${
                  sort === key ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"
                }`}
                onClick={() => setSort(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
              freshOnly ? "border-accent/50 text-accent" : "border-line text-fg-dim hover:text-fg"
            }`}
            onClick={() => setFreshOnly((v) => !v)}
          >
            只看 24h
          </button>
        </div>
      </div>

      {/* 概览条 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-[11px] text-fg-faint">
        <span>
          在榜 <b className="text-fg">{totalCount}</b> 条
        </span>
        <span>
          覆盖 <b className="text-fg">{covered}</b>/{(sources ?? []).length} 个平台
        </span>
        <span>最近抓取 {relativeTime(lastRun || null)}</span>
        <span className="ml-auto flex items-center gap-2">
          近 14 天抓取 <b className="text-fg">{spark.reduce((a, b) => a + b, 0)}</b>
          <Spark data={spark} />
        </span>
      </div>

      {/* 提示 */}
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-950/30 px-3 py-2 text-xs text-red-300">
          <span className="flex-1">{error}</span>
          <button className="shrink-0 hover:text-red-200" onClick={() => setError("")}>
            {iconX({ width: 12, height: 12 })}
          </button>
        </div>
      )}
      {notice && !error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-emerald-950/25 px-3 py-2 text-xs text-emerald-300">
          <span className="flex-1">{notice}</span>
          <button className="shrink-0 hover:text-emerald-200" onClick={() => setNotice("")}>
            {iconX({ width: 12, height: 12 })}
          </button>
        </div>
      )}

      {/* 搜索结果（只显示这次新抓到的） */}
      {searchHits && searchHits.items.length > 0 && (
        <section className="mb-4 rounded-xl border border-accent/30 bg-accent/[0.04] p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] text-accent">
              这次搜「{searchHits.keyword}」新抓到 {searchHits.items.length} 条
            </span>
            <button
              className="ml-auto text-[10px] text-fg-faint hover:text-fg"
              onClick={() => setSearchHits(null)}
            >
              收起
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {searchHits.items.map((it) => (
              <button
                key={it.id}
                className="max-w-full truncate rounded-md bg-panel px-2 py-1 text-[11px] text-fg-dim hover:text-fg"
                title={it.title}
                onClick={() => {
                  document
                    .querySelector(`[data-item-id="${it.id}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                <span style={{ color: platformColor(it.platform) }}>●</span> {it.title}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 空态 / 骨架 */}
      {showSkeleton ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[168px] animate-pulse rounded-xl border border-line bg-panel" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          platform={platform}
          hasKeyword={!!draft.trim()}
          keyword={draft.trim()}
          canFetch={canFetch}
          busy={!!busy}
          hotlist={hotlist}
          onRefresh={() => void runFetch("refresh")}
          onSearch={() => void runFetch("search")}
          onClearFilters={() => {
            setDraft("");
            setFreshOnly(false);
          }}
          onModels={() => navigate("/models")}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              highlighted={highlight === it.id}
              making={makingId === it.id}
              copied={copiedId === it.id}
              onMake={() => void makeVideo(it)}
              onCopy={() => void copyTitle(it)}
              onSubscribe={() => openSubs(it.title)}
              onDelete={() => void removeItem(it)}
            />
          ))}
        </div>
      )}

      {/* 底部操作 */}
      {items.length > 0 && (
        <div className="mt-5 flex items-center gap-2 text-[11px] text-fg-faint">
          <span>
            共 {shown.length} 条
            {draft.trim() ? `（筛「${draft.trim()}」）` : ""}
          </span>
          <button className="ml-auto underline hover:text-fg" onClick={() => void clearBoard()}>
            清空{current ? current.platform : "全部"}热点
          </button>
        </div>
      )}

      {subsOpen && (
        <SubscriptionsModal
          platforms={platforms}
          prefill={subPrefill}
          onClose={() => setSubsOpen(false)}
        />
      )}
    </div>
  );
}

function PlatformTab({
  label,
  count,
  active,
  running,
  error,
  via,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  running?: boolean;
  error?: string | null;
  via?: "hotlist" | "ai" | "feed";
  onClick: () => void;
}) {
  const sourceHint =
    via === "hotlist"
      ? "直连实时榜单，不花模型额度"
      : via === "ai"
        ? "靠联网文本模型查询"
        : via === "feed"
          ? "自建 RSS / 接口源"
          : "";
  return (
    <button
      className={`group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
        active ? "bg-panel-2 text-accent" : "text-fg-dim hover:bg-panel hover:text-fg"
      }`}
      title={[sourceHint, error ? `上次失败：${error}` : ""].filter(Boolean).join(" · ") || undefined}
      onClick={onClick}
    >
      {running ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: platformColor(label) }} />
      )}
      {label}
      {count > 0 && (
        <span className={`text-[10px] ${active ? "text-accent/70" : "text-fg-faint"}`}>{count}</span>
      )}
      {error && !running && <span className="text-[10px] text-red-400">!</span>}
    </button>
  );
}

function ItemCard({
  item,
  highlighted,
  making,
  copied,
  onMake,
  onCopy,
  onSubscribe,
  onDelete,
}: {
  item: RadarItem;
  highlighted: boolean;
  making: boolean;
  copied: boolean;
  onMake: () => void;
  onCopy: () => void;
  onSubscribe: () => void;
  onDelete: () => void;
}) {
  const tier = heatTier(item.heat);
  const color = HEAT_COLOR[tier];
  return (
    <article
      data-item-id={item.id}
      className={`group flex flex-col rounded-xl border bg-panel p-4 transition-colors hover:border-line/80 ${
        highlighted ? "border-accent" : "border-line"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: platformColor(item.platform) }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: platformColor(item.platform) }} />
          {item.platform}
        </span>
        {item.heatText && (
          <span className="truncate rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-fg-dim">{item.heatText}</span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-fg-faint">
          {relativeTime(item.lastSeenAt ?? item.fetchedAt)}
        </span>
      </div>

      <h3 className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</h3>
      {item.summary && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-fg-dim">{item.summary}</p>
      )}

      <div className="mt-auto pt-3">
        <div className="mb-1 flex items-center justify-between text-[10px] text-fg-faint">
          <span title="按榜单排名或原始热度折算到 0–100">热度</span>
          <span style={{ color }}>{item.heat}</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-panel-2">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${Math.max(4, item.heat)}%`, background: color }}
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-black hover:brightness-110 disabled:opacity-40"
            disabled={making}
            onClick={onMake}
          >
            {making ? "在提炼…" : "做成视频"}
          </button>
          <a
            className="text-[11px] text-fg-faint underline hover:text-fg"
            href={topicSearchUrl(item.platform, item.title)}
            target="_blank"
            rel="noreferrer"
          >
            原文
          </a>
          <div className="ml-auto flex items-center gap-0.5">
            <IconBtn title={copied ? "已复制" : "复制标题"} onClick={onCopy} active={copied}>
              {copied ? iconCheck({ width: 13, height: 13 }) : iconCopy({ width: 13, height: 13 })}
            </IconBtn>
            <IconBtn title="把这条标题加成订阅关键词" onClick={onSubscribe}>
              {iconPlus({ width: 13, height: 13 })}
            </IconBtn>
            <IconBtn title="从雷达里删掉" onClick={onDelete} danger>
              {iconTrash({ width: 13, height: 13 })}
            </IconBtn>
          </div>
        </div>
      </div>
    </article>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  active,
  danger,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`rounded p-1 opacity-60 transition-opacity hover:bg-panel-2 hover:opacity-100 ${
        active ? "text-emerald-400 opacity-100" : danger ? "text-fg-faint hover:text-red-400" : "text-fg-faint hover:text-fg"
      }`}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EmptyState({
  platform,
  hasKeyword,
  canFetch,
  busy,
  keyword,
  hotlist,
  onRefresh,
  onSearch,
  onClearFilters,
  onModels,
}: {
  platform: string;
  hasKeyword: boolean;
  canFetch: boolean;
  busy: boolean;
  keyword: string;
  hotlist: string[];
  onRefresh: () => void;
  onSearch: () => void;
  onClearFilters: () => void;
  onModels: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line py-14 text-center">
      <div className="mb-3 flex justify-center text-fg-faint">
        {iconRadar({ width: 26, height: 26 })}
      </div>
      <p className="text-sm text-fg-dim">
        {hasKeyword ? `没有匹配「${keyword}」的热点` : platform ? `${platform}还没有热点` : "还没有抓过热点"}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-fg-faint">
        {hasKeyword
          ? "这个词可能只是本地没搜到。可以让模型现在去平台上查一遍，也可以清掉筛选看全部。"
          : hotlist.length > 0
            ? `点一下刷新：${hotlist.join("、")} 直连实时榜，几秒就好；其余平台要走模型，慢一些。`
            : "点一下刷新，模型会去各平台看现在在传什么。"}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:opacity-40"
          disabled={!canFetch || busy}
          onClick={hasKeyword ? onSearch : onRefresh}
        >
          {busy
            ? "抓取中…"
            : hasKeyword
              ? platform
                ? `去${platform}搜「${keyword}」`
                : `搜全部平台的「${keyword}」`
              : platform
                ? `刷新${platform}`
                : "刷新全部平台"}
        </button>
        {hasKeyword && (
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim hover:text-fg"
            onClick={onClearFilters}
          >
            清掉筛选
          </button>
        )}
        {!canFetch && (
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim hover:text-fg"
            onClick={onModels}
          >
            去配置联网模型
          </button>
        )}
      </div>
    </div>
  );
}

/** 14 天抓取量小柱状 */
function Spark({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <span className="flex items-end gap-[2px]" title={data.join(" / ")}>
      {data.map((n, i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm"
          style={{
            height: `${Math.max(2, Math.round((n / max) * 16))}px`,
            background: n > 0 ? "var(--color-accent)" : "var(--color-line)",
            opacity: n > 0 ? 0.35 + 0.65 * (i / Math.max(1, data.length - 1)) : 1,
          }}
        />
      ))}
    </span>
  );
}
