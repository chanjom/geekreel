import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell, Alert, Field, PrimaryButton, TextLink, inputCls } from "../components/authShell";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

// ---------------------------------------------------------------------------
// 忘记密码
// ---------------------------------------------------------------------------

export function ForgotPage() {
  const { config, forgot } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ via: "smtp" | "outbox"; note?: string } | null>(null);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await forgot(email.trim());
      setDone(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell title="查收你的邮箱" subtitle="如果这个邮箱注册过，重置链接已经发出去了。">
        <div className="space-y-4">
          {done.via === "smtp" ? (
            <Alert kind="ok">
              邮件已发出。链接 <b>1 小时</b>内有效，且只能用一次。没收到就看一眼垃圾邮件。
            </Alert>
          ) : (
            <Alert kind="info">
              本站还没配发信服务，所以邮件发不出去。重置链接只会出现在服务器的控制台日志和{" "}
              <code className="rounded bg-ink px-1 py-0.5 text-[11px]">data/outbox/</code> 目录里。
              <div className="mt-2">最快的办法：找站主，让他在「账号管理」里给你生成一条重置链接。</div>
            </Alert>
          )}
          {done.note ? <p className="text-[11px] leading-relaxed text-fg-faint">技术细节：{done.note}</p> : null}
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-[12.5px] text-accent hover:underline">
              回登录页
            </Link>
            <TextLink onClick={() => setDone(null)}>换个邮箱再试</TextLink>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="找回密码"
      subtitle="填注册时用的邮箱，我们给你发一条重置链接。链接 1 小时内有效。"
      footer={
        <div className="text-center text-[12px] text-fg-dim">
          想起来了？{" "}
          <Link to="/login" className="text-fg-dim underline decoration-line underline-offset-2 hover:text-accent">
            回登录页
          </Link>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="注册邮箱">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            placeholder="you@example.com"
            autoFocus
            autoComplete="username"
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <PrimaryButton busy={busy}>发送重置链接</PrimaryButton>
      </form>
      {config && !config.mailConfigured ? (
        <p className="mt-4 text-[11px] leading-relaxed text-fg-faint">
          提示：本站没有配 SMTP，邮件发不出去。登录页找站主，他能从后台直接给你一条链接。
        </p>
      ) : null}
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// 重置密码
// ---------------------------------------------------------------------------

export function ResetPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { resetPassword } = useAuth();
  const token = params.get("token") ?? "";

  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ valid: boolean }>(`/api/auth/reset/check?token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (alive) setValid(r.valid);
      })
      .catch(() => {
        if (alive) setValid(false);
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => nav("/login", { replace: true }), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <AuthShell title="正在检查链接">
        <p className="text-[13px] text-fg-dim">稍等…</p>
      </AuthShell>
    );
  }

  if (!valid && !done) {
    return (
      <AuthShell title="这条链接不能用了" subtitle="重置链接只能用一次，而且 1 小时后失效。">
        <div className="space-y-4">
          <Alert>可以让站主在「账号管理」里重新给你发一条。</Alert>
          <Link to="/forgot" className="text-[12.5px] text-accent hover:underline">
            重新申请一条 →
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="密码已改好" subtitle="所有设备上的旧登录都已经退出。">
        <div className="space-y-4">
          <Alert kind="ok">现在用新密码登录就行，正在跳转…</Alert>
          <Link to="/login" className="text-[12.5px] text-accent hover:underline">
            立即去登录 →
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="设置新密码" subtitle="改完之后，其他设备上的登录会全部失效。">
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="新密码" hint={<span className="text-[11px] text-fg-faint">至少 8 位</span>}>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
            placeholder="新密码"
            autoFocus
            autoComplete="new-password"
          />
        </Field>
        <Field label="再输一次">
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputCls}
            placeholder="确认新密码"
            autoComplete="new-password"
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <PrimaryButton busy={busy}>保存新密码</PrimaryButton>
      </form>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// 邮箱验证
// ---------------------------------------------------------------------------

export function VerifyPage() {
  const [params] = useSearchParams();
  const { verifyEmail } = useAuth();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"busy" | "ok" | "fail">("busy");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!token) {
      setState("fail");
      setMsg("链接里没有验证码，可能是复制时漏了后半段。");
      return;
    }
    verifyEmail(token)
      .then(() => setState("ok"))
      .catch((e) => {
        setState("fail");
        setMsg(e instanceof Error ? e.message : String(e));
      });
  }, [token, verifyEmail]);

  return (
    <AuthShell
      title={state === "busy" ? "正在验证…" : state === "ok" ? "邮箱已验证" : "验证没成功"}
      subtitle={state === "ok" ? "账号已激活，可以去登录了。" : undefined}
    >
      <div className="space-y-4">
        {state === "fail" ? <Alert>{msg}</Alert> : null}
        {state === "ok" ? <Alert kind="ok">以后登录不会再拦你。</Alert> : null}
        {state !== "busy" ? (
          <Link to="/login" className="text-[12.5px] text-accent hover:underline">
            去登录 →
          </Link>
        ) : (
          <p className="text-[13px] text-fg-dim">马上好…</p>
        )}
      </div>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// 条款 / 隐私
// ---------------------------------------------------------------------------

const TERMS: { h: string; p: string[] }[] = [
  {
    h: "1. 这是什么",
    p: [
      "本服务是一套可自托管的 AI 视频创作工具。你可以用它写剧本、生成画面与配音、合成成片。",
      "本站不是内容平台，不提供成片托管、分发或推荐服务。作品存在部署这台机器的磁盘上。",
    ],
  },
  {
    h: "2. 账号",
    p: [
      "你需要一个邮箱和密码登录。请自行保管好密码；怀疑泄露就立即改密码，或联系管理员停用账号。",
      "一人一号。把账号转借他人使用导致的费用和数据损失，由账号持有人承担。",
    ],
  },
  {
    h: "3. 模型费用",
    p: [
      "本站不代付、不赠送模型额度。生成调用产生的费用由你在模型服务商处的账户直接结算。",
      "模型页显示的金额按你填写的单价估算，仅供参考，以服务商账单为准。",
    ],
  },
  {
    h: "4. 内容责任",
    p: [
      "你对自己输入的主题、剧本、上传素材以及生成结果负责。请确保拥有相应权利，不侵犯他人肖像权、著作权。",
      "禁止用本工具生成违法违规、侵害他人权益或虚假误导的内容。由此产生的责任由使用者承担。",
    ],
  },
  {
    h: "5. 服务可用性",
    p: [
      "本软件按「现状」提供，不承诺可用性。任务失败、磁盘写满、模型服务商故障都可能导致成片丢失，请及时下载。",
      "管理员可以在提前通知后停机维护、清理数据；违规账号可被直接停用。",
    ],
  },
  {
    h: "6. 开源许可",
    p: ["本程序以 Unlicense 发布，你可以自建、修改、商用。条款只约束本站这一份部署的使用行为。"],
  },
];

const PRIVACY: { h: string; p: string[] }[] = [
  {
    h: "我们收什么",
    p: [
      "注册信息：邮箱、昵称、密码哈希（不可逆）。登录时记录 IP 和浏览器 UA，用于风控和排查异常。",
      "创作数据：项目、剧本、素材、成片、任务记录，都写在这台服务器的数据库和磁盘上。",
      "模型密钥：加密后存在本机数据库，接口只返回脱敏后的尾号。",
    ],
  },
  {
    h: "我们不做什么",
    p: [
      "不把数据卖给第三方，不做用户画像广告。",
      "不把生成内容上传到我们自己以外的服务器 —— 除了你主动调用的模型服务商。",
    ],
  },
  {
    h: "数据会发给谁",
    p: [
      "只有你配置的模型端点会收到对应的提示词与素材。用哪家、传什么，由你在「模型」页决定。",
      "热点雷达会请求微博、知乎、抖音、B 站等公开榜单接口，只带关键词，不带你的账号信息。",
    ],
  },
  {
    h: "留存与删除",
    p: [
      "账号停用或删除后，会话立即失效。项目与素材由管理员按站内规则清理。",
      "想导出或删除自己的数据，直接联系站点管理员。",
    ],
  },
  {
    h: "Cookie",
    p: ["只用一个 HttpOnly 会话 cookie 维持登录态，不做跨站跟踪，不接第三方统计。"],
  },
];

export function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  const { config } = useAuth();
  const blocks = useMemo(() => (kind === "terms" ? TERMS : PRIVACY), [kind]);

  return (
    <div className="min-h-full bg-ink text-fg">
      <div className="mx-auto max-w-[720px] px-6 py-12">
        <div className="mb-8 flex items-center gap-4 text-[12.5px]">
          <Link to="/terms" className={kind === "terms" ? "text-accent" : "text-fg-dim hover:text-fg"}>
            服务条款
          </Link>
          <span className="h-3 w-px bg-line" />
          <Link to="/privacy" className={kind === "privacy" ? "text-accent" : "text-fg-dim hover:text-fg"}>
            隐私说明
          </Link>
          <Link to="/login" className="ml-auto text-fg-dim hover:text-accent">
            回登录页
          </Link>
        </div>

        <h1 className="text-[26px] font-semibold tracking-tight">{kind === "terms" ? "服务条款" : "隐私说明"}</h1>
        <p className="mt-2 text-[13px] text-fg-dim">
          {config?.siteName ?? "本站"} · 本页说明的是这一份部署的使用规则，不构成法律意见。
        </p>

        <div className="mt-9 space-y-7">
          {blocks.map((b) => (
            <section key={b.h}>
              <h2 className="text-[14px] font-semibold text-fg">{b.h}</h2>
              <div className="mt-2 space-y-2">
                {b.p.map((p, i) => (
                  <p key={i} className="text-[13px] leading-[1.85] text-fg-dim">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 border-t border-line pt-5 text-[11.5px] leading-relaxed text-fg-faint">
          最后更新：2026-11 · 管理员可以按实际情况修改本页内容，改完请同步通知站内用户。
        </div>
      </div>
    </div>
  );
}
