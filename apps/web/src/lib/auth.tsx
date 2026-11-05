import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, apiJson } from "./api";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
}

export interface AuthConfig {
  multiUser: boolean;
  allowRegister: boolean;
  needsFirstAdmin: boolean;
  requireCode: boolean;
  sessionDays: number;
}

interface AuthState {
  user: AuthUser | null;
  config: AuthConfig | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; name?: string; code?: string }): Promise<void>;
  logout(): Promise<void>;
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
        const r = await apiJson<{ user: AuthUser }>("/api/auth/register", "post", input);
        setUser(r.user);
      },
      async logout() {
        try {
          await apiJson("/api/auth/logout", "post");
        } finally {
          setUser(null);
        }
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
