import type { ApiResp } from "@vw/core";

/** 带业务码的接口错误：前端可按 code 分支（如 unverified / expired / exists） */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** 统一 API 客户端：解包 { ok, data, error }，失败抛 ApiError */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  let json: ApiResp<T> | null = null;
  try {
    json = (await res.json()) as ApiResp<T>;
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok || !json || json.ok === false) {
    if (res.status === 401) window.dispatchEvent(new Event("vw:unauth"));
    const message = json && json.ok === false ? json.error : `请求失败 (${res.status})`;
    const code = json && json.ok === false ? json.code : undefined;
    throw new ApiError(message, res.status, code);
  }
  return json.data;
}

export function apiJson<T>(path: string, method: "post" | "put" | "patch" | "delete", body?: unknown): Promise<T> {
  return api<T>(path, {
    method: method.toUpperCase(),
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
