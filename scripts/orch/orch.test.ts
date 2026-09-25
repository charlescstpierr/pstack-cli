import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "orch.ts");
const dirs: string[] = [];
async function store() { const path = await mkdtemp(join(tmpdir(), "orch-")); dirs.push(path); return path; }
async function run(dir: string, ...args: string[]) {
  const proc = Bun.spawn([process.execPath, script, "--store", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr, value: stdout ? JSON.parse(stdout) : undefined };
}
async function ok(dir: string, ...args: string[]) {
  const result = await run(dir, ...args);
  expect(result.code, result.stderr).toBe(0);
  return result.value;
}
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

test("reopens units, receipts, gates and inbox after process restart", async () => {
  const dir = await store();
  await ok(dir, "init");
  await ok(dir, "unit", "add", "u1", "--track", "build", "--brief", "brief.md");
  await ok(dir, "unit", "set", "u1", "--state", "done", "--branch", "build/u1", "--pr", "42", "--sha", "abc", "--worker", "agent1", "--worktree", "tree1");
  await ok(dir, "ledger", "record", "42", "abc", "unit-test-verified", "--evidence", "results.txt");
  await ok(dir, "ledger", "record", "42", "abc", "live-ui-verified", "--evidence", "ui.txt", "--verifier", "reviewer");
  await ok(dir, "inbox", "push", "agent1", "u1", "done", "--report", "report.txt");
  await ok(dir, "inbox", "push", "agent2", "u1", "blocked");
  await ok(dir, "gate", "park", "g1", "--question", "Ship?", "--options", "yes/no", "--default", "no");
  expect((await ok(dir, "unit", "list"))[0]).toMatchObject({ id: "u1", worker: "agent1", sha: "abc" });
  expect((await ok(dir, "ledger", "check", "42", "abc"))).toMatchObject({ verdict: "live-ui-verified", verifier: "reviewer" });
  expect((await run(dir, "ledger", "check", "42", "changed")).code).toBe(2);
  const drained = await ok(dir, "inbox", "drain");
  expect(drained).toHaveLength(2);
  expect(drained.map((p: { report: string }) => p.report)).toContain("report.txt");
  expect(await ok(dir, "inbox", "drain")).toEqual([]);
  expect((await readdir(join(dir, "inbox", "drained"))).length).toBe(2);
  await ok(dir, "gate", "resolve", "g1", "--answer", "yes");
  expect(await ok(dir, "gate", "list")).toEqual([]);
  expect((await ok(dir, "status")).summary).toMatchObject({ unitStates: { done: 1 }, pendingInbox: 0, openGates: [] });
  await ok(dir, "init");
  expect(await ok(dir, "unit", "list", "--state", "done")).toHaveLength(1);
  expect((await readFile(join(dir, "units.tsv"), "utf8"))).toContain("agent1\ttree1");
  expect((await readFile(join(dir, "ledger.tsv"), "utf8"))).toContain("ui.txt");
}, 120_000);

test("a second process cannot write while another holds the store lock", async () => {
  const dir = await store(); await ok(dir, "init");
  await writeFile(join(dir, ".orch.lock"), `${process.pid}:holder`);
  const blocked = await run(dir, "unit", "add", "lost", "--track", "build");
  expect(blocked.code).toBe(1);
  expect(blocked.stderr).toContain("store locked");
  expect(await readFile(join(dir, ".orch.lock"), "utf8")).toBe(`${process.pid}:holder`);
  expect((await readFile(join(dir, "units.tsv"), "utf8")).trim()).toBe("id\ttrack\tstate\tbranch\tpr\tsha\tbrief\tworker\tworktree");
  await rm(join(dir, ".orch.lock"));
  await ok(dir, "unit", "add", "kept", "--track", "build");
  expect(await ok(dir, "unit", "list")).toHaveLength(1);
}, 60_000);

test("parser rejects extra arguments and invalid verdict without writes", async () => {
  const dir = await store(); await ok(dir, "init");
  expect((await run(dir, "unit", "add", "u", "--track", "x", "unexpected")).code).toBe(1);
  expect((await run(dir, "ledger", "record", "1", "a", "pass", "--evidence", "x")).code).toBe(1);
  expect(await ok(dir, "unit", "list")).toEqual([]);
}, 60_000);
