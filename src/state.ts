import nodePath from "node:path";

import envPaths from "env-paths";

export const dataHome = (): string => {
  const override = process.env.BEBU_HOME;

  return override ? nodePath.resolve(override) : envPaths("bebu", { suffix: "" }).data;
};
