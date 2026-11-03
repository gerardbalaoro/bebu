import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { spawn } from "bun";

test("Varlock loads the credential pair from .env and rejects incomplete credentials without leaking values", async () => {
  const directory = await mkdtemp(nodePath.join(tmpdir(), "bebu-env-"));
  const module = new URL("credentials.ts", import.meta.url).href;
  const schema = await readFile(new URL("../../.env.schema", import.meta.url), "utf-8");

  const script = `import { loadCredentials } from ${JSON.stringify(module)};
    try { const result = await loadCredentials(); console.log(JSON.stringify({ configured: Boolean(result), matches: result?.username === 'fixture@example.com' && result?.password === 'fixture-password' })); }
    catch (error) { console.error(error.message); process.exitCode=1; }`;

  const run = async () => {
    const child = spawn({
      cmd: [
        "node",
        "--import",
        import.meta.resolve("@oxc-node/core/register"),
        "--input-type=module",
        "-e",
        script,
      ],
      cwd: directory,
      env: { ...process.env, BEBU_PASSWORD: undefined, BEBU_USERNAME: undefined },
      stderr: "pipe",
      stdout: "pipe",
    });

    return {
      code: await child.exited,
      errors: await new Response(child.stderr).text(),
      output: await new Response(child.stdout).text(),
    };
  };

  try {
    await writeFile(nodePath.join(directory, ".env.schema"), schema);
    await writeFile(
      nodePath.join(directory, ".env"),
      "BEBU_USERNAME=fixture@example.com\nBEBU_PASSWORD=fixture-password\n"
    );
    const configured = await run();
    expect(configured.code).toBe(0);
    expect(JSON.parse(configured.output)).toEqual({ configured: true, matches: true });
    await writeFile(nodePath.join(directory, ".env"), "BEBU_PASSWORD=fixture-password\n");
    const incomplete = await run();
    expect(incomplete.code).toBe(1);
    expect(incomplete.errors).toContain("Set both");
    expect(incomplete.errors).not.toContain("fixture-password");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
