#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

import { OxcTransformer } from "@oxc-node/core";

const sourceRoot = new URL("src/", import.meta.url).href;
const transformer = new OxcTransformer(import.meta.dirname);

// Oxc's default loader skips node_modules. Include our source so packed installations also work.
registerHooks({
  load(url, context, nextLoad) {
    if (!(url.startsWith(sourceRoot) && url.endsWith(".ts"))) {
      return nextLoad(url, context);
    }

    const filename = fileURLToPath(url);

    return {
      format: "module",
      shortCircuit: true,
      source: transformer.transform(filename, readFileSync(filename)).source(),
    };
  },
});

await import("./src/main.ts");
