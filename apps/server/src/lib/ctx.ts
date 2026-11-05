import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 当前执行流的用户身份。
 *
 * 为什么要有这个：端点解析（resolveEndpoint）、素材入库、用量记账这些底层函数
 * 被 30 多处调用，逐个加 userId 参数既容易漏、又把业务代码污染得没法看。
 * 用 AsyncLocalStorage 把"我是谁"挂在执行流上，底层按需读取：
 *   - HTTP 请求：attachUser 中间件里 run 住整个请求
 *   - 后台任务：jobQueue 执行 handler 时按 job.ownerId run
 * 单机模式下永远是本机管理员，行为与旧版一致。
 */
export interface RequestScope {
  userId: string;
}

export const reqScope = new AsyncLocalStorage<RequestScope>();

export function currentUserId(): string | undefined {
  return reqScope.getStore()?.userId;
}

export function runAs<T>(userId: string | null | undefined, fn: () => T): T {
  if (!userId) return fn();
  return reqScope.run({ userId }, fn);
}
