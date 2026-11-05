import { describe, expect, test } from "bun:test";
import { extractJsonObject, stripCodeFence } from "./json";

describe("stripCodeFence", () => {
  test("带 json 标记的围栏取中间", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("不带标记的围栏也认", () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("没有围栏原样返回（去掉首尾空白）", () => {
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe("extractJsonObject", () => {
  test("模型先讲一句废话再给 JSON", () => {
    expect(extractJsonObject('好的，这是方案：\n{"title":"外卖"}')).toBe('{"title":"外卖"}');
  });

  test("围栏 + 前后废话", () => {
    expect(extractJsonObject('好\n```json\n{"episodeCount":3}\n```\n以上')).toBe('{"episodeCount":3}');
  });

  test("花括号里套花括号，取最外层", () => {
    const text = '{"cast":{"name":"阿杰"},"n":1}';
    expect(extractJsonObject(text)).toBe(text);
  });

  test("字符串里有右花括号不会提前截断", () => {
    const text = '{"story":"他说 } 然后走了","n":1}';
    expect(extractJsonObject(text)).toBe(text);
    expect(JSON.parse(extractJsonObject(text)).n).toBe(1);
  });

  test("压根没有花括号原样返回，交给上层报错", () => {
    expect(extractJsonObject("我不想拍这个")).toBe("我不想拍这个");
  });

  test("只有左花括号也不瞎切", () => {
    expect(extractJsonObject('{"a":1')).toBe('{"a":1');
  });
});
