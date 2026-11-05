import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, apiJson } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
}

export interface AuthConfig {
  siteName: string;
  version: string;
  multiUser: boolean;
  allowRegister: boolean;
  needsFirstAdmin: boolean;
  requireCode: boolean;
  sessionDays: number;
  /** 注册后是否必须去邮箱点验证链接（只有配好 SMTP 才会为 true） */
  requireVerify: boolean;
  /** 站里配了发信服务没有。没配时忘记密码要走管理员手动发链接 */
  mailConfigured: boolean;
}

export interface RegisterResult {
  needVerify: boolean;
  message?: string;
}

interface AuthState {
  user: AuthUser | null;
  config: AuthConfig | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: {
    email: string;
    password: string;
    name?: string;
    code?: string;
    acceptTerms: boolean;
  }): Promise<RegisterResult>;
  logout(): Promise<void>;
  forgot(email: string): Promise<{ via: "smtp" | "outbox"; note?: string }>;
  resetPassword(token: string, password: string): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  resendVerify(): Promise<void>;
  updateName(name: string): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [me, cfg] = await Promise.all([
        api<{ user: AuthUser | null }>("/api/auth/me"),
        api<AuthConfig>("/api/auth/config"),
      ]);
      setUser(me.user);
      setConfig(cfg);
      if (cfg.siteName) document.title = `${cfg.siteName} · AI 视频工作台`;
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // 任何接口回 401 都视为掉线，回登录页
  useEffect(() => {
    function onUnauth() {
      setUser((prev) => (prev ? null : prev));
    }
    window.addEventListener("vw:unauth", onUnauth);
    return () => window.removeEventListener("vw:unauth", onUnauth);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      config,
      loading,
      refresh: load,
      async login(email, password) {
        const r = await apiJson<{ user: AuthUser }>("/api/auth/login", "post", { email, password });
        setUser(r.user);
      },
      async register(input) {
        const r = await apiJson<{ user: AuthUser | null; needVerify?: boolean; message?: string }>(
          "/api/auth/register",
          "post",
          input,
        );
        if (r.user) setUser(r.user);
        return { needVerify: Boolean(r.needVerify), message: r.message };
      },
      async logout() {
        try {
          await apiJson("/api/auth/logout", "post");
        } finally {
          setUser(null);
        }
      },
      async forgot(email) {
        const r = await apiJson<{ ok: true; via: "smtp" | "outbox"; note?: string }>("/api/auth/forgot", "post", {
          email,
        });
        return { via: r.via, note: r.note };
      },
      async resetPassword(token, password) {
        await apiJson("/api/auth/reset", "post", { token, password });
      },
      async verifyEmail(token) {
        await apiJson("/api/auth/verify", "post", { token });
      },
      async resendVerify() {
        await apiJson("/api/auth/verify/send", "post");
      },
      async updateName(name) {
        const r = await apiJson<{ user: AuthUser }>("/api/auth/profile", "post", { name });
        setUser(r.user);
      },
    }),
    [user, config, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return v;
}
