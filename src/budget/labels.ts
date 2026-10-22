import { z } from "zod";

export const LabelsSchema = z.looseObject({
  data: z.record(
    z.string(),
    z.looseObject({
      archived: z.boolean().optional(),
      id: z.string(),
      name: z.string(),
      transactionCount: z.number().optional(),
    })
  ),
});
