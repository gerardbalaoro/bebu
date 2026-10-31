import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { captureExecute } from "@crustjs/testing";
import { z } from "zod";

import { createApp } from "./app.ts";

test("source generation produces a complete installable skill without a build directory", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-skills-"));
  const previousDirectory = process.cwd();

  try {
    process.chdir(directory);
    const result = await captureExecute(createApp(), ["skills", "generate"]);
    expect(result.exitCode).toBe(0);
    const generated = z.object({ files: z.array(z.string()) }).parse(JSON.parse(result.stdout));
    expect(generated.files.length).toBeGreaterThan(0);

    const generatedFiles = await Promise.all(
      generated.files.map(async (file) => await stat(nodePath.join(directory, "skills", file)))
    );

    for (const file of generatedFiles) {
      expect(file.isFile()).toBe(true);
    }

    const installed = await captureExecute(createApp(), ["skills", "install"]);
    expect(installed.exitCode).toBe(0);

    const statResult1 = await stat(
      nodePath.join(directory, ".agents", "skills", "bebu", "SKILL.md")
    );

    expect(statResult1.isFile()).toBe(true);

    const metadata = await stat(
      nodePath.join(directory, ".agents", "skills", "bebu", "agents", "openai.yaml")
    );

    expect(metadata.isFile()).toBe(true);
    const lstatResult = await lstat(nodePath.join(directory, ".agents", "skills", "bebu"));
    expect(lstatResult.isSymbolicLink()).toBe(false);
  } finally {
    process.chdir(previousDirectory);
    await rm(directory, { force: true, recursive: true });
  }
});

test("generation refreshes its managed local copy and preserves custom files", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-skills-sync-"));
  const previousDirectory = process.cwd();

  try {
    process.chdir(directory);
    const installed = await captureExecute(createApp(), ["skills", "install"]);
    expect(installed.exitCode).toBe(0);
    const local = nodePath.join(directory, ".agents", "skills", "bebu");
    await writeFile(
      nodePath.join(local, "commands", "transactions", "delete.md"),
      "outdated reference"
    );
    await writeFile(nodePath.join(local, "local-notes.md"), "custom notes");
    const otherSkill = nodePath.join(directory, ".agents", "skills", "custom");
    await mkdir(otherSkill);
    await writeFile(nodePath.join(otherSkill, "SKILL.md"), "custom skill");

    const result = await captureExecute(createApp(), ["skills", "generate"]);
    expect(result.exitCode).toBe(0);
    expect(
      await readFile(nodePath.join(local, "commands", "transactions", "delete.md"), "utf-8")
    ).toBe(
      await readFile(
        nodePath.join(directory, "skills", "bebu", "commands", "transactions", "delete.md"),
        "utf-8"
      )
    );
    expect(await readFile(nodePath.join(local, "local-notes.md"), "utf-8")).toBe("custom notes");
    expect(await readFile(nodePath.join(otherSkill, "SKILL.md"), "utf-8")).toBe("custom skill");

    const commands = nodePath.join(local, "commands");
    await rm(commands, { recursive: true });
    const external = nodePath.join(directory, "external-commands");
    await mkdir(external);
    await writeFile(nodePath.join(external, "bebu.md"), "external reference");
    await symlink(external, commands, "dir");
    const linkedResult = await captureExecute(createApp(), ["skills", "generate"]);
    expect(linkedResult.exitCode).toBe(0);
    expect(await readFile(nodePath.join(external, "bebu.md"), "utf-8")).toBe("external reference");
  } finally {
    process.chdir(previousDirectory);
    await rm(directory, { force: true, recursive: true });
  }
});

test("generation leaves another source and linked skill copies untouched", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-skills-isolation-"));
  const previousDirectory = process.cwd();

  try {
    process.chdir(directory);
    const local = nodePath.join(directory, ".agents", "skills", "bebu");
    await mkdir(local, { recursive: true });
    await writeFile(nodePath.join(local, "SKILL.md"), "another source");
    const unmanagedResult = await captureExecute(createApp(), ["skills", "generate"]);
    expect(unmanagedResult.exitCode).toBe(0);
    expect(await readFile(nodePath.join(local, "SKILL.md"), "utf-8")).toBe("another source");
    await writeFile(
      nodePath.join(directory, "skills-lock.json"),
      JSON.stringify({
        skills: { bebu: { source: "./other-skills", sourceType: "local" } },
        version: 1,
      })
    );
    const otherSourceResult = await captureExecute(createApp(), ["skills", "generate"]);
    expect(otherSourceResult.exitCode).toBe(0);
    expect(await readFile(nodePath.join(local, "SKILL.md"), "utf-8")).toBe("another source");

    await rm(local, { recursive: true });
    const linked = nodePath.join(directory, "external-skill");
    await mkdir(linked);
    await writeFile(nodePath.join(linked, "SKILL.md"), "external skill");
    await symlink(linked, local, "dir");
    await writeFile(
      nodePath.join(directory, "skills-lock.json"),
      JSON.stringify({
        skills: { bebu: { source: "./skills", sourceType: "local" } },
        version: 1,
      })
    );
    const linkedResult = await captureExecute(createApp(), ["skills", "generate"]);
    expect(linkedResult.exitCode).toBe(0);
    expect(await readFile(nodePath.join(linked, "SKILL.md"), "utf-8")).toBe("external skill");
  } finally {
    process.chdir(previousDirectory);
    await rm(directory, { force: true, recursive: true });
  }
});
