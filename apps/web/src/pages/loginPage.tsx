import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { BrandMark } from "../components/brand";

type Mode = "login" | "register";

export function LoginPage() {
  const { user, config, loading, login, register } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-fg-dim">正在加载…</div>;
  }
  // 单机模式不需要登录页
  if (!config?.multiUser) return <Navigate to="/" replace />;
  if (user) return <Navigate to="/" replace />;

  const canRegister = config.allowRegister;
  const firstAdmin = config.needsFirstAdmin;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register({ email: email.trim(), password, name: name.trim() || undefined, code: code.trim() || undefined });
      }
      nav("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark size="md" />
        </div>

        <div className="rounded-2xl border border-line bg-panel p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-fg">
            {mode === "login" ? "登录" : firstAdmin ? "创建管理员账号" : "注册"}
          </h1>
          <p className="mt-1 text-xs text-fg-dim">
            {mode === "login"
              ? "用邮箱和密码进入工作台"
              : firstAdmin
                ? "这是本站第一个账号，会自动成为管理员"
                : "注册后到「模型」页填自己的 API key 即可开始"}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-fg-dim">邮箱</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                placeholder="you@example.com"
              />
            </label>

            {mode === "register" ? (
              <label className="block">
                <span className="mb-1 block text-xs text-fg-dim">昵称（可不填）</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  placeholder="怎么称呼你"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-xs text-fg-dim">密码</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={8}
                className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                placeholder="至少 8 位"
              />
            </label>

            {mode === "register" && config.requireCode ? (
              <label className="block">
                <span className="mb-1 block text-xs text-fg-dim">邀请码</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                  placeholder="找站主要一个"
                />
              </label>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并进入"}
            </button>
          </form>

          {canRegister ? (
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
              className="mt-4 w-full text-center text-xs text-fg-dim underline-offset-2 hover:text-fg hover:underline"
            >
              {mode === "login" ? "没有账号？注册一个" : "已经有账号？去登录"}
            </button>
          ) : null}
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-fg-dim">
          所有项目与素材都存在这台服务器上。
          <br />
          模型调用走你自己配置的 key，本站不代付。
        </p>
      </div>
    </div>
  );
}
