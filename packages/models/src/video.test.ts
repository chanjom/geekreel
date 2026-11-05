import { expect, test } from "bun:test";
import { collectVideoImagesWithRoles } from "./blobs";
import { jwtHs256 } from "./video";

test("可灵 JWT 是三段 HS256", () => {
  const token = jwtHs256({ iss: "ak", exp: 100 }, "secret");
  const parts = token.split(".");
  expect(parts).toHaveLength(3);
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
  expect(payload.iss).toBe("ak");
});

test("多张图必须标角色，否则方舟整单 400", () => {
  const blob = (n: number) => ({ mime: "image/png", data: new Uint8Array([n, n + 1, n + 2, n + 3]) });
  const many = collectVideoImagesWithRoles({
    image: blob(1),
    lastFrame: blob(5),
    refs: [blob(9)],
  });
  expect(many.map((x) => x.role)).toEqual(["first_frame", "last_frame", "reference_image"]);
  // 只有一张时不带 role，1.0 系列不认这个字段
  const one = collectVideoImagesWithRoles({ image: blob(1) });
  expect(one).toHaveLength(1);
  expect(one[0]!.role).toBeUndefined();
  // 首帧和尾帧是同一张，去重后仍是一张，不带角色
  const same = collectVideoImagesWithRoles({ image: blob(1), lastFrame: blob(1) });
  expect(same).toHaveLength(1);
  expect(same[0]!.role).toBeUndefined();
});
