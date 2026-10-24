import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // Preserve the installed skills and their upstream content hashes.
  ignorePatterns: [...(ultracite.ignorePatterns ?? []), ".agents/skills/**"],
  printWidth: 100,
  proseWrap: "always",
});
