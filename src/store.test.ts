import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRuns, readRun, RunStoreError, saveRun, type WorkerRecord } from "./store";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const claude: WorkerRecord = {
  name: "pstack-claude",
  workspaceId: "w9",
  paneId: "w9:p1",
  terminalId: "term-claude",
  cwd: "C:/project",
  role: "judgment and prose",
  kind: "claude",
  model: "sonnet",
  status: "done",
};

test("persists two independent CLI agents across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-store-"));
  directories.push(directory);
  const codex: WorkerRecord = {
    ...claude,
    name: "pstack-codex",
    workspaceId: "wA",
    paneId: "wA:p1",
    terminalId: "term-codex",
    role: "feature, refactoring",
    kind: "codex",
    model: "gpt-6-sol",
  };

  await Promise.all([saveRun(directory, claude), saveRun(directory, codex)]);

  expect(await readRun(directory, claude.name)).toEqual(claude);
  expect(await listRuns(directory)).toEqual([claude, codex]);
});

test("lists an empty store and rejects an invalid name without crossing its directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-store-"));
  directories.push(directory);

  expect(await listRuns(join(directory, "absent"))).toEqual([]);
  await expect(readRun(directory, "../outside")).rejects.toThrow(RunStoreError);
});
