import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiJson } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatTime } from "../lib/format";

interface AdminOverview {
  version: string;
  siteName: string;
  mailConfigured: boolean;
  users: number;
  activeUsers: number;
  projects: number;
  jobs: number;
  jobsRunning: number;
  assets: number;
  endpoints: number;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  createdAt: number;
  lastLoginAt: number | null;
  emailVerified: boolean;
  projects: number;
}

interface UsageRow {
  id: string;
  email: string;
  name: string;
  calls: number;
  cost: number;
}

export function AdminPage() {
  const { user: me, config } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [linkFor, setLinkFor] = useState<{ email: string; link: string } | null>(null);

  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => api<AdminOverview>("/api/admin/overview"),
  });

  const users = useQuery({
    queryKey: ["admin-users", keyword],
    queryFn: () => api<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(keyword)}`),
  });

  const usage = useQuery({
    queryKey: ["admin-usage"],
    queryFn: () => api<{ usage: UsageRow[] }>("/api/admin/usage"),
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; body: { role?: string; status?: string } }) =>
      apiJson(`/api/admin/users/${input.id}`, "patch", input.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
      void qc.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (e) => setToast({ kind: "err", text: e instanceof Error ? e.message : String(e) }),
  });

  const makeLink = useMutation({
    mutationFn: (id: string) => apiJson<{ link: string; mailed: boolean }>(`/api/admin/users/${id}/reset-link`, "post"),
    onSuccess: (r, id) => {
      const u = users.data?.users.find((x) => x.id === id);
      setLinkFor({ email: u?.email ?? "", link: r.link });
      setToast({
        kind: "ok",
        text: r.mailed ? "链接已生成，同时也发了一封邮件给对方" : "链接已生成，复制给对方即可（本站没配发信服务）",
      });
    },
    onError: (e) => setToast({ kind: "err", text: e instanceof Error ? e.message : String(e) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiJson(`/api/admin/users/${id}`, "delete"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
      void qc.invalidateQueries({ queryKey: ["admin-overview"] });
      setToast({ kind: "ok", text: "账号已删除" });
    },
    onError: (e) => setToast({ kind: "err", text: e instanceof Error ? e.message : String(e) }),
  });

  const o = overview.data;
  const cards = useMemo(
    () =>
      o
        ? [
            { label: "账号", value: o.users, hint: `${o.activeUsers} 个正常` },
            { label: "项目", value: o.projects, hint: "全站合计" },
            { label: "任务", value: o.jobs, hint: `${o.jobsRunning} 个在跑` },
            { label: "素材", value: o.assets, hint: "资产库条目" },
            { label: "模型端点", value: o.endpoints, hint: "全部用户" },
          ]
        : [],
    [o],
  );

  if (!config?.multiUser) {
    return (
      <div className="mx-auto max-w-[560px] p-8 text-sm leading-relaxed text-fg-dim">
        单机模式没有账号体系，不需要这一页。
        <br />
        要让别人也能用，设 <code className="rounded bg-panel px-1 py-0.5 text-[12px]">VW_MULTI_USER=1</code> 后重启，
        步骤见仓库里的 <code className="rounded bg-panel px-1 py-0.5 text-[12px]">docs/SELF-HOST.md</code>。
      </div>
    );
  }

  if (me?.role !== "admin") {
    return <div className="p-8 text-sm text-fg-dim">只有管理员能看这一页。</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] px-6 py-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">账号管理</h1>
            <p className="mt-1 text-xs text-fg-dim">
              {o?.siteName ?? config?.siteName} v{o?.version ?? config?.version} · 这里的操作立即生效
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setKeyword(q.trim());
                if (e.key === "Escape") {
                  setQ("");
                  setKeyword("");
                }
              }}
              placeholder="搜邮箱或昵称，回车"
              className="w-56 rounded-lg border border-line bg-panel px-3 py-1.5 text-[12.5px] outline-none focus:border-accent/60"
            />
            <button
              type="button"
              onClick={() => setKeyword(q.trim())}
              className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-fg-dim hover:border-accent-dim hover:text-fg"
            >
              搜索
            </button>
          </div>
        </div>

        {o && !o.mailConfigured ? (
          <div className="mt-4 rounded-xl border border-amber-900/40 bg-amber-950/20 px-4 py-3 text-[12.5px] leading-relaxed text-amber-200">
            没配发信服务（<code className="text-[11px]">VW_SMTP_*</code>）。用户点「忘记密码」收不到邮件，
            <b>用下面的「重置链接」把地址复制给对方</b>就行。配好 SMTP 之后这里会自动发信。
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-line bg-panel px-4 py-3">
              <div className="text-[11.5px] text-fg-dim">{c.label}</div>
              <div className="mt-1 text-[22px] font-semibold leading-none text-fg">{c.value}</div>
              <div className="mt-1.5 text-[10.5px] text-fg-faint">{c.hint}</div>
            </div>
          ))}
        </div>

        {toast ? (
          <div
            className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-2.5 text-[12.5px] ${
              toast.kind === "ok"
                ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-200"
                : "border-red-900/40 bg-red-950/25 text-red-200"
            }`}
          >
            <span className="flex-1">{toast.text}</span>
            <button type="button" onClick={() => setToast(null)} className="text-[11px] opacity-70 hover:opacity-100">
              关闭
            </button>
          </div>
        ) : null}

        {linkFor ? (
          <div className="mt-3 rounded-xl border border-accent/30 bg-accent/[0.06] p-4">
            <div className="text-[12.5px] text-accent">给 {linkFor.email} 的密码重置链接（1 小时有效，只能用一次）</div>
            <div className="mt-2 flex gap-2">
              <input readOnly value={linkFor.link} className="flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-[11.5px] text-fg-dim" />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(linkFor.link);
                  setToast({ kind: "ok", text: "已复制" });
                }}
                className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-[#1a1206]"
              >
                复制
              </button>
              <button type="button" onClick={() => setLinkFor(null)} className="rounded-lg border border-line px-3 py-2 text-[12px] text-fg-dim">
                收起
              </button>
            </div>
          </div>
        ) : null}

        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-medium text-fg">账号列表</h2>
            <span className="text-[11px] text-fg-faint">最多显示 200 个</span>
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-panel-2 text-[11px] uppercase tracking-wide text-fg-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">账号</th>
                  <th className="px-3 py-2 font-medium">角色</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">项目</th>
                  <th className="px-3 py-2 font-medium">最近登录</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-fg-dim">
                      正在加载…
                    </td>
                  </tr>
                ) : users.data?.users.length ? (
                  users.data.users.map((u) => (
                    <tr key={u.id} className="border-t border-line/70">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-fg">{u.name || u.email.split("@")[0]}</div>
                        <div className="text-[11px] text-fg-faint">{u.email}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10.5px] ${
                            u.role === "admin" ? "bg-accent/15 text-accent" : "bg-panel-2 text-fg-dim"
                          }`}
                        >
                          {u.role === "admin" ? "管理员" : "普通用户"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[11.5px] ${u.status === "active" ? "text-emerald-400" : "text-red-400"}`}>
                          {u.status === "active" ? "正常" : "已停用"}
                        </span>
                        {!u.emailVerified ? <span className="ml-1 text-[10.5px] text-fg-faint">未验证</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-fg-dim">{u.projects}</td>
                      <td className="px-3 py-2.5 text-[11.5px] text-fg-faint">
                        {u.lastLoginAt ? formatTime(u.lastLoginAt) : "从未"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => makeLink.mutate(u.id)}
                            className="rounded border border-line px-2 py-1 text-[11px] text-fg-dim hover:border-accent-dim hover:text-fg"
                          >
                            重置链接
                          </button>
                          <button
                            type="button"
                            disabled={patch.isPending}
                            onClick={() =>
                              patch.mutate({ id: u.id, body: { role: u.role === "admin" ? "user" : "admin" } })
                            }
                            className="rounded border border-line px-2 py-1 text-[11px] text-fg-dim hover:border-accent-dim hover:text-fg disabled:opacity-40"
                          >
                            {u.role === "admin" ? "降为普通" : "设为管理员"}
                          </button>
                          <button
                            type="button"
                            disabled={patch.isPending}
                            onClick={() =>
                              patch.mutate({ id: u.id, body: { status: u.status === "active" ? "disabled" : "active" } })
                            }
                            className="rounded border border-line px-2 py-1 text-[11px] text-fg-dim hover:border-accent-dim hover:text-fg disabled:opacity-40"
                          >
                            {u.status === "active" ? "停用" : "启用"}
                          </button>
                          <button
                            type="button"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (confirm(`删除 ${u.email}？他的模型端点会一起删掉。`)) remove.mutate(u.id);
                            }}
                            className="rounded border border-line px-2 py-1 text-[11px] text-red-400/80 hover:border-red-900 hover:text-red-300 disabled:opacity-40"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-fg-dim">
                      没有匹配的账号
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <CreateUser onDone={() => void qc.invalidateQueries({ queryKey: ["admin-users"] })} onToast={setToast} />

        <section className="mt-6 pb-10">
          <h2 className="mb-2 text-[13px] font-medium text-fg">近 30 天用量（按花费排序）</h2>
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-panel-2 text-[11px] uppercase tracking-wide text-fg-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">账号</th>
                  <th className="px-3 py-2 font-medium">调用次数</th>
                  <th className="px-3 py-2 font-medium">估算花费</th>
                </tr>
              </thead>
              <tbody>
                {usage.data?.usage.length ? (
                  usage.data.usage.map((r) => (
                    <tr key={r.id} className="border-t border-line/70">
                      <td className="px-3 py-2 text-fg-dim">{r.name || r.email}</td>
                      <td className="px-3 py-2 text-fg-dim">{r.calls}</td>
                      <td className="px-3 py-2 text-fg">¥{r.cost.toFixed(2)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-3 py-5 text-center text-fg-faint">
                      还没有调用记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-fg-faint">金额按用户在模型页填的单价估算，以服务商账单为准。</p>
        </section>
      </div>
    </div>
  );
}

function CreateUser(props: {
  onDone: () => void;
  onToast: (t: { kind: "ok" | "err"; text: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiJson("/api/admin/users", "post", { email: email.trim(), name: name.trim(), password, role });
      props.onToast({ kind: "ok", text: `已创建 ${email.trim()}，把密码发给他就能登录` });
      setEmail("");
      setName("");
      setPassword("");
      setOpen(false);
      props.onDone();
    } catch (e) {
      props.onToast({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-dashed border-line px-3 py-2 text-[12.5px] text-fg-dim transition hover:border-accent-dim hover:text-fg"
        >
          + 直接开一个号（不用等对方注册）
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border border-line bg-panel p-4">
      <div className="mb-3 text-[12.5px] font-medium text-fg">新建账号</div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="邮箱"
          className="rounded-lg border border-line bg-ink px-3 py-2 text-[12.5px] outline-none focus:border-accent/60"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="昵称（可空）"
          className="rounded-lg border border-line bg-ink px-3 py-2 text-[12.5px] outline-none focus:border-accent/60"
        />
        <input
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="初始密码（至少 8 位）"
          className="rounded-lg border border-line bg-ink px-3 py-2 text-[12.5px] outline-none focus:border-accent/60"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "user" | "admin")}
          className="rounded-lg border border-line bg-ink px-3 py-2 text-[12.5px] outline-none focus:border-accent/60"
        >
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-[#1a1206] disabled:opacity-50"
        >
          {busy ? "创建中…" : "创建"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-line px-3.5 py-2 text-[12.5px] text-fg-dim">
          取消
        </button>
      </div>
    </form>
  );
}
