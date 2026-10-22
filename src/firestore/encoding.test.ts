import { expect, test } from "bun:test";

import { decode, encode, fieldPath } from "./encoding.ts";

test("wire conversion preserves timestamp types and integers beyond JS precision", () => {
  expect(encode(new Date("2026-01-01T00:00:00Z"))).toEqual({
    timestampValue: "2026-01-01T00:00:00.000Z",
  });
  expect(decode({ integerValue: "9007199254740993" })).toBe("9007199254740993");
  expect(() => encode(Number.NaN)).toThrow();
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Exercise the required argument with an invalid runtime value.
  expect(() => encode(undefined)).toThrow();
});

test("field masks quote numeric IDs and embedded dots without changing their meaning", () => {
  expect(fieldPath("data", "1abc", "x.y")).toBe("data.`1abc`.`x.y`");
});
