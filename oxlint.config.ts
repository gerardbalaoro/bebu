import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import ultracite from "ultracite/oxlint/core";

export default defineConfig({
  extends: [ultracite, antiSlop],
});
