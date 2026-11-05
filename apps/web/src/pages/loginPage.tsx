import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell, Alert, Field, PrimaryButton, TextLink, inputCls } from "../components/authShell";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

type Mode = "login" | "register";

const REMEMBER_KEY = "vw.lastEmail";

function passwordScore(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (pw.length >= 12) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s += 1;
  const score = Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
  const label = ["太短", "弱", "一般", "不错", "很强"][score] ?? "";
  const color = ["bg-red-500/70", "bg-red-500/70", "bg-amber-500/70", "bg-emerald-500/70", "bg-emerald-400"][score] ?? "";
  return { score, label, color };
}

export function LoginPage() {
  const { user, config, loading, login, register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "login");
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_KEY) ?? "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [accept, setAccept] = useState(false);
  const [remember, setRemember] = useState(Boolean(localStorage.getItem(REMEMBER_KEY)));
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [verifySent, setVerifySent] = useState<{ email: string; message?: string } | null>(null);

  const strength = useMemo(() => passwordScore(password), [password]);

  useEffect(() => {
    setPassword("");
    setError("");
    setErrorCode(undefined);
  }, [mode]);

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-ink text-sm text-fg-dim">正在加载…</div>;
  }
  // 单机模式不需要登录页
  if (!config?.multiUser) return <Navigate to="/" replace />;
  if (user) return <Navigate to="/" replace />;

  const canRegister = config.allowRegister;
  const firstAdmin = config.needsFirstAdmin;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setErrorCode(undefined);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
        if (remember) localStorage.setItem(REMEMBER_KEY, email.trim());
        else localStorage.removeItem(REMEMBER_KEY);
        nav("/", { replace: true });
      } else {
        const r = await register({
          email: email.trim(),
          password,
          name: name.trim() || undefined,
          code: code.trim() || undefined,
          acceptTerms: accept,
        });
        if (r.needVerify) {
          setVerifySent({ email: email.trim(), message: r.message });
        } else {
          nav("/", { replace: true });
        }
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(e instanceof Error ? e.message : String(e));
      setErrorCode(err?.code);
      // 邮箱已注册：直接把用户送到登录态，省得他再点一次
      if (err?.code === "exists") setMode("login");
    } finally {
      setBusy(false);
    }
  }

  if (verifySent) {
    return (
      <AuthShell
        title="去邮箱点一下验证链接"
        subtitle={
          <>
            我们给 <span className="text-fg">{verifySent.email}</span> 发了一封验证邮件。点开里面的按钮，账号就激活了。
          </>
        }
      >
        <div className="space-y-4">
          <Alert kind="ok">{verifySent.message ?? "验证邮件已发出"}</Alert>
          <div className="rounded-xl border border-line bg-panel/60 p-4 text-[12.5px] leading-relaxed text-fg-dim">
            <div className="mb-1 font-medium text-fg">没收到？</div>
            <ul className="list-disc space-y-1 pl-4">
              <li>先看垃圾邮件 / 广告邮件分类</li>
              <li>邮件可能延迟 1–2 分钟，稍等再刷新</li>
              <li>还是没有就找站主，让他从后台给你发一条验证链接</li>
            </ul>
          </div>
          <TextLink onClick={() => setVerifySent(null)}>返回登录</TextLink>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={mode === "login" ? "登录工作台" : firstAdmin ? "创建第一个管理员" : "创建账号"}
      subtitle={
        mode === "login" ? (
          "用邮箱和密码进入你的工作台。"
        ) : firstAdmin ? (
          "这台服务器还是空的。第一个注册的账号会自动成为管理员，接管站内已有数据。"
        ) : (
          "注册后到「模型」页填自己的 API key 就能开始出片。本站不代付模型费用。"
        )
      }
      footer={
        <div className="space-y-3">
          <div className="text-center text-[12px] text-fg-dim">
            {mode === "login" ? (
              canRegister ? (
                <>
                  还没有账号？ <TextLink onClick={() => setMode("register")}>立即注册</TextLink>
                </>
              ) : (
                <>本站未开放注册，找站主要一个账号。</>
              )
            ) : (
              <>
                已经有账号了？ <TextLink onClick={() => setMode("login")}>去登录</TextLink>
              </>
            )}
          </div>
          <p className="text-center text-[11px] leading-relaxed text-fg-faint">
            继续即表示你已阅读并同意{" "}
            <Link to="/terms" className="underline decoration-line underline-offset-2 hover:text-fg-dim">
              服务条款
            </Link>{" "}
            与{" "}
            <Link to="/privacy" className="underline decoration-line underline-offset-2 hover:text-fg-dim">
              隐私说明
            </Link>
            。
          </p>
        </div>
      }
    >
      {firstAdmin ? (
        <div className="mb-4 rounded-xl border border-accent/25 bg-accent/[0.07] px-3.5 py-2.5 text-[12px] leading-relaxed text-accent">
          首次部署：这个账号会成为管理员，之后在「账号管理」里可以给其他人开号。
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-3.5">
        <Field label="邮箱">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            className={inputCls}
            placeholder="you@example.com"
            autoFocus={!email}
          />
        </Field>

        {mode === "register" ? (
          <Field label="昵称" hint={<span className="text-[11px] text-fg-faint">可留空，默认用邮箱前缀</span>}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              className={inputCls}
              placeholder="怎么称呼你"
              autoComplete="nickname"
            />
          </Field>
        ) : null}

        <Field
          label="密码"
          hint={
            mode === "login" ? (
              <Link to="/forgot" className="text-[11.5px] text-fg-dim hover:text-accent">
                忘记密码？
              </Link>
            ) : (
              <span className="text-[11px] text-fg-faint">至少 8 位</span>
            )
          }
        >
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              className={`${inputCls} pr-16`}
              placeholder={mode === "login" ? "输入密码" : "8 位以上，别用 12345678"}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11.5px] text-fg-dim transition hover:bg-panel hover:text-fg"
              tabIndex={-1}
            >
              {showPw ? "隐藏" : "显示"}
            </button>
          </div>
          {mode === "register" && password ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={`h-1 flex-1 rounded-full ${i <= strength.score ? strength.color : "bg-line"}`} />
                ))}
              </div>
              <span className="w-8 text-right text-[11px] text-fg-faint">{strength.label}</span>
            </div>
          ) : null}
        </Field>

        {mode === "register" && config.requireCode ? (
          <Field label="邀请码" hint={<span className="text-[11px] text-fg-faint">找站主要一个</span>}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputCls}
              placeholder="站主给的邀请码"
              autoComplete="off"
            />
          </Field>
        ) : null}

        {mode === "login" ? (
          <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-fg-dim">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#f5b53f]"
            />
            记住我的邮箱
          </label>
        ) : (
          <label className="flex cursor-pointer select-none items-start gap-2 text-[12px] leading-relaxed text-fg-dim">
            <input
              type="checkbox"
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#f5b53f]"
            />
            <span>
              我同意{" "}
              <Link to="/terms" className="text-fg underline decoration-line underline-offset-2">
                服务条款
              </Link>{" "}
              与{" "}
              <Link to="/privacy" className="text-fg underline decoration-line underline-offset-2">
                隐私说明
              </Link>
              ，知道模型调用费用由我自己承担。
            </span>
          </label>
        )}

        {error ? (
          <Alert kind={errorCode === "unverified" ? "info" : "error"}>
            {error}
            {errorCode === "unverified" ? (
              <div className="mt-1.5 text-[11.5px] text-fg-dim">
                收不到邮件就找站主，让他从「账号管理」给你发一条链接。
              </div>
            ) : null}
          </Alert>
        ) : null}

        <PrimaryButton busy={busy} disabled={mode === "register" && !accept}>
          {busy ? "请稍候…" : mode === "login" ? "登录" : firstAdmin ? "创建管理员并进入" : "注册并进入"}
        </PrimaryButton>
      </form>

      <div className="mt-4 flex items-center justify-between text-[11px] text-fg-faint">
        <span>数据存在这台服务器上</span>
        <span>
          {config.siteName} v{config.version}
        </span>
      </div>
    </AuthShell>
  );
}
