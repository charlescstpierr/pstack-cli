import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditWorktrees } from "./worktree-audit";

async function command(cwd: string, args: string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (await child.exited) throw new Error(await new Response(child.stderr).text());
}

test("auditWorktrees reports dirty linked worktrees without deleting them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-audit-"));
  const repo = join(directory, "repo");
  const linked = join(directory, "linked tree");
  try {
    await command(directory, ["init", "repo"]);
    await command(repo, ["config", "user.email", "test@example.com"]);
    await command(repo, ["config", "user.name", "Test"]);
    await writeFile(join(repo, "README.md"), "base\n");
    await command(repo, ["add", "README.md"]);
    await command(repo, ["commit", "-m", "initial"]);
    await command(repo, ["worktree", "add", "-b", "feature", linked]);
    await writeFile(join(linked, "README.md"), "changed\n");
    const result = await auditWorktrees(repo);
    expect(result.output).toContain("DIRTY\tREMOTE");
    expect(result.output).toContain("wip:1");
    expect(result.output).toContain("hold-wip");
    expect(result.output).toContain(linked.replaceAll("\\", "/"));
    expect(await Bun.file(join(linked, "README.md")).text()).toBe("changed\n");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);
