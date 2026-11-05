/**
 * 从模型回复里抠出 JSON。
 *
 * 模型不会老老实实只吐 JSON：可能包在 ```json 里、可能前面带一句"好的，这是方案："。
 * 三种情况都要能取出来；取不出来就原样返回，让上层的 JSON.parse 去报错。
 */

/** 去掉 markdown 代码块围栏（```json … ``` 或 ``` … ```），取中间那段 */
export function stripCodeFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/** 取第一个 { 到最后一个 } 之间的内容；没有花括号就原样返回 */
export function extractJsonObject(text: string): string {
  const raw = stripCodeFence(text);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}
