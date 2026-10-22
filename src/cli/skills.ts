import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { defineCommand } from "@crustjs/core";
import type { AnyCrust } from "@crustjs/core";
import { writeSkills } from "@crustjs/skills";
import { z } from "zod";

import metadata from "../../package.json" with { type: "json" };

const executeFile = promisify(execFile);
export const packagedSkills = fileURLToPath(new URL("../../skills", import.meta.url));
const generatedSyntaxSection = /## Command Documentation Authority\n\n.*?(?=\n---)/su;

const openaiMetadata = `interface:
  display_name: "Beyond Budget"
  short_description: "Read and change Beyond Budget accounts and transactions"
  default_prompt: "Use $bebu to review my Beyond Budget accounts and transactions."
`;

const skillInstructions = `# bebu

Before you use the app, read [the login and write rules](commands/bebu.md).

## Run commands

If bebu is installed, use the command signatures as written.
Otherwise, replace the initial bebu with npx --yes github:gerardbalaoro/bebu.
A global CLI installation is not required.

## Choose a command

1. Find the command for the task in the command reference.
2. Read the Type column. Only runnable commands accept direct execution. A group without an action contains other commands.
3. Before you use or explain a command, read its linked reference.
4. Use only the arguments, flags, aliases, and defaults in that reference.
5. If a feature is absent, report that the reference does not document it.

## Command reference

`;

export const generateSkills = async (app: AnyCrust, output = "skills") => {
  const outDir = nodePath.resolve(output);

  const files = await writeSkills({
    app,
    description:
      "Use for Beyond Budget sign-in, balance and history queries, account configuration, and transaction creation, metadata changes, or deletion.",
    outDir,
    version: metadata.version,
  });

  await Promise.all(
    files.map(async (file) => {
      const path = nodePath.join(outDir, file);
      let content = await readFile(path, "utf-8");

      if (file.replaceAll("\\", "/") === "bebu/SKILL.md") {
        const heading = content.indexOf("\n# bebu\n");
        const table = content.indexOf("| Command | Type | Description | Documentation |");

        if (heading === -1 || table === -1) {
          throw new Error("The generated skill format changed. Update the bebu skill template");
        }

        content = `${content.slice(0, heading)}\n${skillInstructions}${content.slice(table)}`;
      } else {
        content = content.replace(
          generatedSyntaxSection,
          "## Supported syntax\n\nUse only the arguments, flags, aliases, and defaults in this reference.\nIf a feature is absent, report that the reference does not document it.\n"
        );
        content = content.replaceAll("[Skill Overview]", "[Skill overview]");
      }

      await writeFile(path, content);
    })
  );

  const metadataFile = "bebu/agents/openai.yaml";
  const metadataPath = nodePath.join(outDir, metadataFile);
  await mkdir(nodePath.dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, openaiMetadata);

  return { files: [...files, metadataFile], outDir };
};

export const installSkills = async (
  source: string,
  workspace: string,
  agents: readonly string[] = [],
  signal?: AbortSignal
) => {
  const cli = fileURLToPath(import.meta.resolve("skills/bin/cli.mjs"));
  const targets = [...new Set(["universal", ...agents])];
  let output: string;

  try {
    const result = await executeFile(
      process.execPath,
      [
        cli,
        "add",
        nodePath.resolve(source),
        "--skill",
        "bebu",
        "--agent",
        ...targets,
        "--copy",
        "--yes",
        "--json",
      ],
      {
        cwd: workspace,
        env: { ...process.env, DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" },
        maxBuffer: 1_000_000,
        signal,
        windowsHide: true,
      }
    );

    output = result.stdout;
  } catch {
    signal?.throwIfAborted();
    throw new Error(
      "The skill copy failed. Make sure that the package contains the bebu skill. Make sure that the destination accepts writes"
    );
  }

  return z
    .array(
      z.object({
        agents: z.array(z.string()),
        mode: z.literal("copy"),
        name: z.literal("bebu"),
        path: z.string(),
        status: z.literal("installed"),
      })
    )
    .min(1)
    .parse(JSON.parse(output));
};

export const createSkillsCommand = (getApp: () => AnyCrust) => {
  const generate = async (output: string) => await generateSkills(getApp(), output);

  return defineCommand(
    "skills",
    { description: "Generate or install the bebu agent skill" },
    (command) =>
      command
        .add(
          defineCommand(
            "generate",
            { description: "Generate the bebu skill and command reference" },
            (leaf) =>
              leaf
                .flags({
                  default: "skills",
                  description: "Replace this output directory. Its name must be skills",
                  name: "out",
                  type: "string",
                })
                .action(async ({ flags, stdout }) =>
                  stdout(JSON.stringify(await generate(flags.out)))
                )
          )
        )
        .add(
          defineCommand(
            "install",
            { description: "Generate and copy the bebu skill into .agents/skills in this project" },
            (leaf) =>
              leaf.action(async ({ stdout }) => {
                const generated = await generate("skills");
                const result = await installSkills(generated.outDir, process.cwd());
                stdout(JSON.stringify(result));
              })
          )
        )
  );
};
