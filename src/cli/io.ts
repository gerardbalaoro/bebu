import { readFile } from "node:fs/promises";

import { defineFlag } from "@crustjs/core";
import { z } from "zod";

export const compactFlag = defineFlag("compact", {
  description: "Return JSON without indentation",
  type: "boolean",
});

export const print = <T>(stdout: (value: string) => void, value: T, compact?: boolean): void => {
  stdout(JSON.stringify(value, null, compact ? 0 : 2));
};

export const payload = async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
  let source = "";

  if (path === "-") {
    process.stdin.setEncoding("utf-8");

    for await (const chunk of process.stdin) {
      const text = z.string().safeParse(chunk);

      if (!text.success) {
        throw new TypeError("Expected text on stdin");
      }

      source += text.data;
    }
  } else {
    source = await readFile(path, "utf-8");
  }

  const value: unknown = JSON.parse(source);

  return schema.parse(value);
};

export const errorMessage = (error: Error): string => {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("\n");
  }

  return error.message;
};
