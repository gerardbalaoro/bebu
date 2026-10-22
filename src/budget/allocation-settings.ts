import { z } from "zod";

import type { Data } from "../firestore/encoding.ts";

const configSchema = z.object({
  allowPartialAllocationEnabled: z.boolean().default(true),
  ignorePendingAllocationAmountEnabled: z.boolean().default(false),
  overwriteCurrentAllocationEnabled: z.boolean().default(false),
});

// Native ConfigDto decoder 49071 supplies omission defaults. The caller must first read the
// authenticated user's document. A failed read is not a default user (51034 -> 51360).
export const allocationSettings = (user: Data) => {
  const config = configSchema.parse(user.config === undefined ? {} : user.config);

  return {
    allowPartial: config.allowPartialAllocationEnabled,
    ignoreAvailable: config.ignorePendingAllocationAmountEnabled,
    overwrite: config.overwriteCurrentAllocationEnabled,
  };
};
