import type { ReactNode } from "react";
import { BrandMark } from "./brand";

/**
 * 登录/注册/找回这一组页面的共同外壳。
 * 左：为什么值得用（营销区，窄屏隐藏）；右：表单卡。
 * 视觉沿用工作台的暗色 + 琥珀色，不另起一套主题。
 */
export function AuthShell(props: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="relative min-h-full overflow-x-hidden bg-ink text-fg">
      {/* 背景光斑与网格：纯装饰，不拦点击 */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-40 h-[460px] w-[460px] rounded-full bg-accent/10 blur-[120px]" />
        <div className="absolute -bottom-48 left-1/3 h-[520px] w-[520px] rounded-full bg-[#3b6bd6]/10 blur-[140px]" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
      </div>

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1180px] flex-col lg:flex-row">
        <MarketingPanel />

        <main className="flex w-full flex-1 items-center justify-center px-5 py-10 sm:px-8">
          <div className={props.wide ? "w-full max-w-[420px]" : "w-full max-w-[392px]"}>
            {/* 窄屏顶部品牌 */}
            <div className="mb-7 flex justify-center lg:hidden">
              <BrandMark size="md" />
            </div>

            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-fg">{props.title}</h1>
            {props.subtitle ? <p className="mt-2 text-[13px] leading-relaxed text-fg-dim">{props.subtitle}</p> : null}

            <div className="mt-6">{props.children}</div>
            {props.footer ? <div className="mt-6">{props.footer}</div> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

const STEPS = ["选题", "剧本", "定妆", "分镜", "出片", "字幕配音"];

function MarketingPanel() {
  return (
    <aside className="relative hidden select-none flex-col justify-between px-10 py-10 lg:flex lg:w-[54%] lg:border-r lg:border-line/60">
      <div className="flex items-center gap-3">
        <BrandMark size="md" />
        <span className="ml-auto rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-faint">
          自托管 · 数据在你自己的服务器
        </span>
      </div>

      <div className="my-10">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.07] px-3 py-1 text-[11px] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          一句话 → 一集成片
        </div>

        <h2 className="text-[40px] font-semibold leading-[1.16] tracking-tight">
          把想法丢进去，
          <br />
          剩下的交给
          <span className="relative mx-1 inline-block">
            <span className="relative z-10 text-accent">流水线</span>
            <span className="absolute inset-x-0 bottom-1 z-0 h-2.5 bg-accent/20" />
          </span>
          。
        </h2>

        <p className="mt-5 max-w-[440px] text-[14px] leading-relaxed text-fg-dim">
          热点雷达找选题，剧本拆成分镜，定妆照锁人物，逐镜出片，字幕和配音一次铺好。
          中间关了页面也不丢进度 —— 任务队列在服务器上跑。
        </p>

        {/* 流程条：一排小格，像时间线 */}
        <div className="mt-7 flex flex-wrap items-center gap-1.5">
          {STEPS.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="rounded-md border border-line bg-panel/70 px-2.5 py-1 text-[11.5px] text-fg-dim">{s}</span>
              {i < STEPS.length - 1 ? <span className="text-[10px] text-fg-faint">›</span> : null}
            </span>
          ))}
        </div>

        {/* 三张微斜的卡：不做真截图，避免离线打不开 */}
        <div className="relative mt-9 h-[136px]">
          <div className="absolute left-0 top-4 h-[110px] w-[150px] rotate-[-6deg] overflow-hidden rounded-xl border border-line bg-gradient-to-br from-[#243049] to-[#12141b] p-3 opacity-75">
            <div className="text-[9px] uppercase tracking-[0.16em] text-fg-faint">SCRIPT</div>
            <div className="mt-2 space-y-1.5">
              <div className="h-1 w-20 rounded-full bg-fg/25" />
              <div className="h-1 w-24 rounded-full bg-fg/15" />
              <div className="h-1 w-16 rounded-full bg-fg/15" />
              <div className="h-1 w-22 rounded-full bg-fg/10" />
            </div>
          </div>
          <div className="absolute left-[108px] top-1 h-[120px] w-[160px] rotate-[2deg] overflow-hidden rounded-xl border border-line bg-gradient-to-br from-[#3a2a18] to-[#14161d] p-2.5 opacity-90">
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-6 rounded-[3px] bg-gradient-to-br from-accent/25 to-fg/5" />
              ))}
            </div>
            <div className="mt-1.5 h-1 w-12 rounded-full bg-fg/20" />
          </div>
          <div className="absolute left-[240px] top-5 flex h-[120px] w-[170px] rotate-[6deg] flex-col justify-end overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-br from-[#4a3416] via-[#241a10] to-[#12141b] p-3 shadow-2xl shadow-black/40">
            <div className="text-[10px] uppercase tracking-[0.18em] text-accent/80">EP.02</div>
            <div className="mt-1 text-[13px] font-medium text-fg">最后一单</div>
            <div className="mt-1 h-1 w-16 rounded-full bg-accent/70" />
            <div className="mt-1.5 h-1 w-10 rounded-full bg-fg/20" />
          </div>
        </div>

        <div className="mt-8 grid gap-3">
          <Feature icon={<RadarIcon />} title="选题不用愁" desc="微博 / 知乎 / 抖音 / B 站实时榜直连，看到就能拍" />
          <Feature icon={<KeyIcon />} title="key 是自己的" desc="平台不代付、不抽成，用多少算多少，账单在模型页" />
          <Feature icon={<QueueIcon />} title="断点能续" desc="出片、转码、导出都进队列，关掉浏览器也继续跑" />
        </div>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-fg-faint">
        <span>Unlicense · 可自建、可改、可商用</span>
        <span className="h-3 w-px bg-line" />
        <span>SQLite + 本地素材目录</span>
      </div>
    </aside>
  );
}

function Feature(props: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-accent">
        {props.icon}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-fg">{props.title}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-fg-dim">{props.desc}</div>
      </div>
    </div>
  );
}

function RadarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12l6-6" strokeLinecap="round" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M17 4h3v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="6" rx="1.6" />
      <rect x="3" y="14" width="18" height="6" rx="1.6" />
      <path d="M7 7h.01M7 17h.01" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 表单原子件：这几个页面的输入框、按钮、提示条统一样式
// ---------------------------------------------------------------------------

export const inputCls =
  "w-full rounded-xl border border-line bg-[#0f1117] px-3.5 py-2.5 text-[13.5px] text-fg placeholder:text-fg-faint outline-none transition focus:border-accent/70 focus:ring-2 focus:ring-accent/15 disabled:opacity-60";

export function Field(props: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="block" htmlFor={props.htmlFor}>
      <span className="mb-1.5 flex items-center justify-between text-[12px] text-fg-dim">
        <span>{props.label}</span>
        {props.hint}
      </span>
      {props.children}
    </label>
  );
}

export function PrimaryButton(props: {
  children: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
}) {
  return (
    <button
      type={props.type ?? "submit"}
      onClick={props.onClick}
      disabled={props.busy || props.disabled}
      className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-[#1a1206] transition hover:brightness-105 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.busy ? <Spinner /> : null}
      {props.children}
    </button>
  );
}

export function Spinner() {
  return (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#1a1206]/30 border-t-[#1a1206]" />
  );
}

export function Alert(props: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  const kind = props.kind ?? "error";
  const style =
    kind === "error"
      ? "border-red-900/50 bg-red-950/30 text-red-200"
      : kind === "ok"
        ? "border-emerald-900/50 bg-emerald-950/25 text-emerald-200"
        : "border-line bg-panel text-fg-dim";
  return <div className={`rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${style}`}>{props.children}</div>;
}

export function TextLink(props: { onClick?: () => void; href?: string; children: ReactNode }) {
  const cls = "text-[12.5px] text-fg-dim underline-offset-4 transition hover:text-accent hover:underline";
  if (props.href) {
    return (
      <a href={props.href} className={cls}>
        {props.children}
      </a>
    );
  }
  return (
    <button type="button" onClick={props.onClick} className={cls}>
      {props.children}
    </button>
  );
}
