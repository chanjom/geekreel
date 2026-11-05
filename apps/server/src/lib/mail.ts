/**
 * 极简邮件发送：只做「发一封验证/重置邮件」这一件事。
 *
 * 三档降级，保证任何环境下链路都不断：
 *   1. 配了 VW_SMTP_HOST：真发（465 走隐式 TLS，25/自定义端口走明文，适合本机 postfix）
 *   2. 没配 SMTP：写进 <dataDir>/outbox/*.eml，控制台打印可点链接
 *   3. 发信失败：退回 2，并把失败原因写进日志，不让用户卡死
 *
 * 不引入 nodemailer，是为了让 `bun install` 少一棵依赖树 —— 这个项目要能被别人一键跑起来。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir, siteName, smtp } from "../config";

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  sent: boolean;
  /** console = 只写日志/落盘；smtp = 真发出去了 */
  via: "smtp" | "outbox";
  note?: string;
}

// ---------------------------------------------------------------------------
// SMTP 客户端（行协议 + 多行回复）
// ---------------------------------------------------------------------------

type SocketLike = {
  write(data: string): number;
  end(): void;
  flush?(): void;
};

function smtpTalk(opts: {
  host: string;
  port: number;
  tls: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string;
  raw: string;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 20_000;

  return new Promise<void>((resolve, reject) => {
    let buf = "";
    let multiline: string[] = [];
    let settled = false;
    let pending: { resolve: (v: string) => void; reject: (e: Error) => void } | null = null;
    const ready: string[] = [];
    let socket: SocketLike | null = null;

    const timer = setTimeout(() => finish(new Error(`SMTP 超时（${timeoutMs}ms）`)), timeoutMs);

    function finish(e?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.end();
      } catch {
        /* 忽略：连接可能已经断了 */
      }
      if (e) reject(e);
      else resolve();
    }

    function onReply(reply: string) {
      if (pending) {
        const p = pending;
        pending = null;
        p.resolve(reply);
      } else {
        ready.push(reply);
      }
    }

    function feed(chunk: string) {
      buf += chunk;
      for (;;) {
        const idx = buf.indexOf("\r\n");
        if (idx < 0) break;
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        multiline.push(line);
        // "250-" 表示这一行后面还有；"250 " 或 "250" 是最后一行的开头
        if (line.length >= 4 && line[3] === "-") continue;
        const reply = multiline.join("\n");
        multiline = [];
        onReply(reply);
      }
    }

    async function cmd(text: string): Promise<string> {
      const p = new Promise<string>((res, rej) => {
        pending = { resolve: res, reject: rej };
      });
      socket!.write(`${text}\r\n`);
      socket!.flush?.();
      return p;
    }

    function expect(reply: string, code: number | number[], what: string) {
      const codes = Array.isArray(code) ? code : [code];
      const got = Number(reply.slice(0, 3));
      if (!codes.includes(got)) throw new Error(`${what} 失败：${reply.replace(/\n/g, " ")}`);
      return reply;
    }

    Bun.connect({
      hostname: opts.host,
      port: opts.port,
      tls: opts.tls ? { serverName: opts.host } : undefined,
      socket: {
        open(s) {
          socket = s as unknown as SocketLike;
        },
        data(_s, data) {
          feed(String(data));
        },
        error(_s, e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        },
        close() {
          finish();
        },
        connectError(_s, e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        },
      },
    })
      .then(async (s) => {
        socket = s as unknown as SocketLike;
        // 等 220 欢迎语
        const waitGreeting = async () => {
          if (ready.length) return ready.shift()!;
          return new Promise<string>((res) => {
            pending = { resolve: res, reject: (e) => finish(e) };
          });
        };
        expect(await waitGreeting(), 220, "连接");

        const ehloName = opts.host.split(".")[0] || "localhost";
        let heloReply: string;
        try {
          heloReply = await cmd(`EHLO ${ehloName}`);
        } catch {
          heloReply = await cmd(`HELO ${ehloName}`);
        }
        expect(heloReply, 250, "EHLO");

        if (opts.user && opts.pass) {
          // AUTH LOGIN：用户名、密码各 base64 一行。国内邮箱的「授权码」就是这里的密码。
          expect(await cmd("AUTH LOGIN"), 334, "AUTH");
          expect(await cmd(Buffer.from(opts.user).toString("base64")), 334, "AUTH 用户名");
          expect(await cmd(Buffer.from(opts.pass).toString("base64")), 235, "AUTH 密码");
        }

        expect(await cmd(`MAIL FROM:<${opts.from}>`), 250, "MAIL FROM");
        expect(await cmd(`RCPT TO:<${opts.to}>`), [250, 251], "RCPT TO");
        expect(await cmd("DATA"), 354, "DATA");
        // 正文：把行首的 "." 转义，再以单独一行 "." 结束
        const body = opts.raw.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
        socket.write(`${body}\r\n.\r\n`);
        socket.flush?.();
        expect(
          await new Promise<string>((res) => {
            pending = { resolve: res, reject: (e) => finish(e) };
          }),
          250,
          "投递",
        );
        try {
          await cmd("QUIT");
        } catch {
          /* QUIT 没回复也算成功 */
        }
        finish();
      })
      .catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

/** 按 RFC 2047 编码非 ASCII 主题，否则中文主题在部分客户端会变乱码 */
function encodeHeader(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=`;
}

function buildRaw(input: MailInput, from: string): string {
  const boundary = `vw-${Date.now().toString(36)}`;
  const html =
    input.html ??
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.7;color:#1c1a16">${input.text
      .split("\n")
      .map((l) => (l.trim() ? `<p style="margin:0 0 10px">${l.replace(/</g, "&lt;")}</p>` : ""))
      .join("")}</div>`;

  return [
    `From: ${encodeHeader(siteName)} <${from}>`,
    `To: <${input.to}>`,
    `Subject: ${encodeHeader(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@geekreel>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.text, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// ---------------------------------------------------------------------------

export function mailConfigured(): boolean {
  return Boolean(smtp.host && smtp.from);
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  const raw = buildRaw(input, smtp.from || `no-reply@${siteName.toLowerCase()}.local`);

  if (mailConfigured()) {
    try {
      await smtpTalk({
        host: smtp.host,
        port: smtp.port,
        tls: smtp.secure,
        user: smtp.user || undefined,
        pass: smtp.pass || undefined,
        from: smtp.from,
        to: input.to,
        raw,
      });
      console.log(`[vw] 邮件已发送 -> ${input.to}：${input.subject}`);
      return { sent: true, via: "smtp" };
    } catch (e) {
      const note = e instanceof Error ? e.message : String(e);
      console.error(`[vw] 邮件发送失败（${note}），已改存发件箱`);
      const p = saveOutbox(input, raw);
      return { sent: false, via: "outbox", note: `${note}；已存到 ${p}` };
    }
  }

  const p = saveOutbox(input, raw);
  console.log(`[vw] 未配置 SMTP，邮件内容已写入 ${p}`);
  return { sent: false, via: "outbox" };
}

function saveOutbox(input: MailInput, raw: string): string {
  const dir = join(dataDir, "outbox");
  mkdirSync(dir, { recursive: true });
  const safeTo = input.to.replace(/[^\w.@-]/g, "_");
  const p = join(dir, `${Date.now()}-${safeTo}.eml`);
  try {
    writeFileSync(p, raw, "utf-8");
  } catch (e) {
    console.error("[vw] 写发件箱失败", e);
  }
  return p;
}

// ---------------------------------------------------------------------------
// 两个场景的邮件模板
// ---------------------------------------------------------------------------

export function resetMail(link: string, minutes: number): { subject: string; text: string; html: string } {
  const subject = `${siteName}：重置登录密码`;
  const text = [
    `有人在 ${siteName} 上申请重置这个邮箱的密码。`,
    "",
    "点开下面的链接设置新密码（链接只能用一次）：",
    link,
    "",
    `链接 ${minutes} 分钟后失效。不是你本人操作的，直接忽略这封邮件即可，密码不会变。`,
  ].join("\n");
  const html = `
  <div style="max-width:520px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,'PingFang SC',sans-serif;background:#0c0d12;padding:32px;border-radius:16px;color:#e7e9ee">
    <div style="font-size:13px;color:#f5b53f;letter-spacing:.08em;text-transform:uppercase">${siteName}</div>
    <h1 style="font-size:20px;margin:12px 0 8px">重置登录密码</h1>
    <p style="color:#9aa0ae;font-size:14px;line-height:1.7;margin:0 0 20px">
      有人在 ${siteName} 上申请重置这个邮箱的密码。点下面的按钮设置新密码，链接 ${minutes} 分钟后失效。
    </p>
    <a href="${link}" style="display:inline-block;background:#f5b53f;color:#14161d;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;text-decoration:none">设置新密码</a>
    <p style="color:#6b7280;font-size:12px;line-height:1.7;margin:22px 0 0">
      按钮点不开就复制这个地址：<br><span style="color:#9aa0ae;word-break:break-all">${link}</span>
    </p>
    <p style="color:#6b7280;font-size:12px;margin:16px 0 0">不是你本人操作的，忽略即可，密码不会变。</p>
  </div>`;
  return { subject, text, html };
}

export function verifyMail(link: string, hours: number): { subject: string; text: string; html: string } {
  const subject = `${siteName}：验证你的邮箱`;
  const text = [
    `欢迎使用 ${siteName}。点开下面的链接验证邮箱（${hours} 小时内有效）：`,
    link,
    "",
    "验证之后就能登录开始做片子了。",
  ].join("\n");
  const html = `
  <div style="max-width:520px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,'PingFang SC',sans-serif;background:#0c0d12;padding:32px;border-radius:16px;color:#e7e9ee">
    <div style="font-size:13px;color:#f5b53f;letter-spacing:.08em;text-transform:uppercase">${siteName}</div>
    <h1 style="font-size:20px;margin:12px 0 8px">验证邮箱</h1>
    <p style="color:#9aa0ae;font-size:14px;line-height:1.7;margin:0 0 20px">
      确认这个邮箱是你的，账号就激活了。链接 ${hours} 小时内有效。
    </p>
    <a href="${link}" style="display:inline-block;background:#f5b53f;color:#14161d;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;text-decoration:none">验证邮箱</a>
    <p style="color:#6b7280;font-size:12px;line-height:1.7;margin:22px 0 0;word-break:break-all">${link}</p>
  </div>`;
  return { subject, text, html };
}
