import { expect, test } from "bun:test";

import { allocationSettings } from "./allocation-settings.ts";

test("allocation preferences use native omission defaults without overriding explicit choices", () => {
  expect(allocationSettings({})).toEqual({
    allowPartial: true,
    ignoreAvailable: false,
    overwrite: false,
  });
  expect(allocationSettings({ config: {} })).toEqual({
    allowPartial: true,
    ignoreAvailable: false,
    overwrite: false,
  });
  expect(
    allocationSettings({
      config: {
        allowPartialAllocationEnabled: false,
        ignorePendingAllocationAmountEnabled: true,
        overwriteCurrentAllocationEnabled: true,
      },
    })
  ).toEqual({ allowPartial: false, ignoreAvailable: true, overwrite: true });
});

test("malformed allocation preferences cannot silently become default preferences", () => {
  for (const user of [
    { config: null },
    { config: { allowPartialAllocationEnabled: null } },
    { config: { overwriteCurrentAllocationEnabled: "false" } },
    { config: { ignorePendingAllocationAmountEnabled: 1 } },
  ]) {
    expect(() => allocationSettings(user)).toThrow();
  }
});
