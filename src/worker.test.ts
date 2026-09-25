import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAsset, runWorker } from "./worker";
import { readRun } from "./store";
import type { ArgvRunner, RunResult } from "./herdr";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))));

function json(type: string, fields: object): RunResult {
  return { exitCode: 0, stdout: JSON.stringify({ result: { type, ...fields } }), stderr: "" };
}

test("loads actual skill and playbook files, rejects invalid asset names", async () => {
  expect(await loadAsset("skill", "poteto-mode")).toContain("# Poteto mode");
  expect(await loadAsset("playbook", "feature")).toContain("### Feature");
  await expect(loadAsset("skill", "../config")).rejects.toThrow("Invalid skill name");
  await expect(loadAsset("playbook", "absent")).rejects.toThrow("Unknown playbook");
});

test("a startup timeout preserves the blocked agent identity for read and recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-worker-"));
  directories.push(directory);
  const calls: string[][] = [];
  let name = "";
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    if (argv[2] === "create") {
      name = argv[argv.indexOf("--label") + 1] ?? "";
      return json("workspace_created", {
        workspace: { workspace_id: "w1", label: name },
        tab: { tab_id: "w1:t1", workspace_id: "w1" },
        root_pane: { pane_id: "w1:p1", workspace_id: "w1" },
      });
    }
    if (argv[2] === "start") return { exitCode: 1, stdout: "", stderr: JSON.stringify({
      error: { code: "agent_not_ready", message: "startup blocked" },
    }) };
    if (argv[2] === "wait") return { exitCode: 1, stdout: "", stderr: JSON.stringify({
      error: { code: "timeout", message: "timed out waiting for agent status" },
    }) };
    if (argv[2] === "get") return json("agent_info", { agent: {
      name, agent: "claude", workspace_id: "w1", pane_id: "w1:p1",
      terminal_id: "terminal-1", agent_status: "blocked", launch_pending: true,
    } });
    throw new Error(`Unexpected command ${argv.join(" ")}`);
  };
  const role = { role: "judgment and prose" as const, kind: "claude" as const,
    model: "sonnet", executable: "claude", modelArgs: ["--model", "sonnet"] };

  await expect(runWorker({ role, cwd: "C:/repo", prompt: "First prompt",
    runsDirectory: directory }, runner)).rejects.toThrow(/workspace=w1.*pstack-/);

  expect((await readRun(directory, name)).status).toBe("blocked");
  expect(calls.map((call) => call[2])).toEqual(["create", "start", "wait", "get"]);
});

test("independent async workers enter distinct panes and prompt with actual skill bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-worker-"));
  directories.push(directory);
  const skill = await loadAsset("skill", "bro");
  const calls: string[][] = [];
  const pending: Array<() => void> = [];
  let bothPrompted!: () => void;
  const prompted = new Promise<void>((resolve) => { bothPrompted = resolve; });
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    const [, group, action, name] = argv;
    if (group === "workspace") {
      const label = argv[argv.indexOf("--label") + 1]!;
      return json("workspace_created", {
        workspace: { workspace_id: label, label }, tab: { tab_id: `${label}:t`, workspace_id: label },
        root_pane: { pane_id: `${label}:p`, workspace_id: label },
      });
    }
    if (action === "start" || action === "prompt") {
      const agent = { name, agent: "codex", agent_status: action === "start" ? "idle" : "done",
        pane_id: `${name}:p`, workspace_id: name, terminal_id: `${name}:term` };
      if (action === "prompt") {
        expect([`${skill}\n\nfirst`, `${skill}\n\nsecond`]).toContain(argv[4]);
        await new Promise<void>((resolve) => {
          pending.push(resolve);
          if (pending.length === 2) bothPrompted();
        });
      }
      return json(action === "start" ? "agent_started" : "agent_prompted", { agent });
    }
    if (action === "read") return { exitCode: 0, stdout: `transcript ${name.split(":")[0]}\n`, stderr: "" };
    throw new Error(`Unexpected argv ${argv}`);
  };
  const role = { role: "feature, refactoring" as const, kind: "codex" as const,
    model: "gpt-6", executable: "codex", modelArgs: ["-m", "gpt-6"] };
  const requests = ["first", "second"].map((prompt) => runWorker({ role, cwd: "C:/repo", prompt,
    skill: "bro", runsDirectory: directory }, runner));
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([prompted, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("prompts did not overlap")), 3000);
    })]);
  } finally { clearTimeout(timer!); }
  expect(calls.filter((call) => call[2] === "prompt").map((call) => call[4]).sort())
    .toEqual([`${skill}\n\nfirst`, `${skill}\n\nsecond`]);
  pending.forEach((resolve) => resolve());
  const workers = await Promise.all(requests);
  expect(workers[0]!.name).toMatch(/^pstack-[a-f0-9]{24}$/);
  expect(workers[0]!.name).not.toBe(workers[1]!.name);
  for (const worker of workers) {
    expect(worker.paneId).toBe(`${worker.name}:p`);
    expect(worker.output).toBe(`transcript ${worker.name}\n`);
    expect((await readRun(directory, worker.name)).status).toBe("done");
    expect(calls).toContainEqual([process.env.HERDR_BIN_PATH || "herdr", "agent", "start", worker.name, "--kind", "codex", "--pane", worker.paneId, "--", "-m", "gpt-6"]);
  }
});

test("a stalled initial submission can finish through the activity wait without a second prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-worker-"));
  directories.push(directory);
  let name = "";
  let waits = 0;
  const calls: string[][] = [];
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    const action = argv[2];
    if (action === "create") {
      name = argv[argv.indexOf("--label") + 1]!;
      return json("workspace_created", {
        workspace: { workspace_id: "w1", label: name },
        tab: { tab_id: "w1:t1", workspace_id: "w1" },
        root_pane: { pane_id: "w1:p1", workspace_id: "w1" },
      });
    }
    const agent = { name, agent: "claude", agent_status: "idle", workspace_id: "w1",
      pane_id: "w1:p1", terminal_id: "terminal-1", interactive_ready: true };
    if (action === "start") return json("agent_started", { agent });
    if (action === "prompt") return { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: {
      code: "agent_prompt_stalled", message: "no observed work after submission",
    } }) };
    if (action === "wait") return json("agent_info", { agent: {
      ...agent, agent_status: ++waits === 1 ? "working" : "done",
    } });
    if (action === "get") return json("agent_info", { agent });
    if (action === "read") return { exitCode: 0, stdout: "ready\n", stderr: "" };
    throw new Error(`Unexpected argv ${argv}`);
  };
  const role = { role: "judgment and prose" as const, kind: "claude" as const,
    model: "sonnet", executable: "claude", modelArgs: ["--model", "sonnet"] };
  const worker = await runWorker({ role, cwd: "C:/repo", prompt: "PSTACK_OK", runsDirectory: directory }, runner);
  expect(worker.output).toBe("ready\n");
  expect(worker.status).toBe("done");
  expect((await readRun(directory, name)).status).toBe("done");
  expect(calls.map((call) => call[2])).toEqual(["create", "start", "prompt", "wait", "wait", "read"]);
  expect(calls[3]![3]).toBe("w1:p1");
});

test("a stalled submission never resends an echoed prompt or prompts a replacement pane", async () => {
  for (const caseName of ["echoed", "replaced"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "pstack-worker-"));
    directories.push(directory);
    let name = "";
    const calls: string[][] = [];
    const runner: ArgvRunner = async (argv) => {
      calls.push(argv);
      if (argv[2] === "create") {
        name = argv[argv.indexOf("--label") + 1]!;
        return json("workspace_created", {
          workspace: { workspace_id: "w1", label: name },
          tab: { tab_id: "w1:t1", workspace_id: "w1" },
          root_pane: { pane_id: "w1:p1", workspace_id: "w1" },
        });
      }
      const agent = { name, agent: "claude", agent_status: "idle", workspace_id: "w1",
        pane_id: "w1:p1", terminal_id: "terminal-1", interactive_ready: true };
      if (argv[2] === "start") return json("agent_started", { agent });
      if (argv[2] === "prompt") return { exitCode: 1, stdout: "", stderr: JSON.stringify({
        error: { code: "agent_prompt_stalled", message: "no observed work after submission" },
      }) };
      if (argv[2] === "wait") return { exitCode: 1, stdout: "", stderr: JSON.stringify({
        error: { code: "timeout", message: "timed out waiting for agent status" },
      }) };
      if (argv[2] === "read") return { exitCode: 0, stdout: "PSTACK_OK\n", stderr: "" };
      if (argv[2] === "get") return json("agent_info", { agent: {
        ...agent, terminal_id: caseName === "echoed" ? "terminal-1" : "replacement",
      } });
      throw new Error(`Unexpected argv ${argv}`);
    };
    const role = { role: "judgment and prose" as const, kind: "claude" as const,
      model: "sonnet", executable: "claude", modelArgs: ["--model", "sonnet"] };
    if (caseName === "echoed") {
      const worker = await runWorker({ role, cwd: "C:/repo", prompt: "PSTACK_OK", runsDirectory: directory }, runner);
      expect(worker.status).toBe("unknown");
      expect(worker.output).toContain("PSTACK_OK\n");
    } else {
      await expect(runWorker({ role, cwd: "C:/repo", prompt: "PSTACK_OK", runsDirectory: directory }, runner))
        .rejects.toThrow("no observed work after submission");
    }
    expect(calls.filter((call) => call[2] === "prompt")).toHaveLength(1);
    expect(calls.filter((call) => call[2] === "get")).toHaveLength(1);
    expect((await readRun(directory, name)).status).toBe(caseName === "echoed" ? "unknown" : "idle");
  }
});

test("resends only after Herdr's activity wait expires and the same idle pane has no prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-worker-"));
  directories.push(directory);
  let name = "";
  let prompts = 0;
  const calls: string[][] = [];
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    const action = argv[2];
    if (action === "create") {
      name = argv[argv.indexOf("--label") + 1]!;
      return json("workspace_created", {
        workspace: { workspace_id: "w1", label: name },
        tab: { tab_id: "w1:t1", workspace_id: "w1" },
        root_pane: { pane_id: "w1:p1", workspace_id: "w1" },
      });
    }
    const agent = { name, agent: "opencode", agent_status: "idle", workspace_id: "w1",
      pane_id: "w1:p1", terminal_id: "terminal-1", interactive_ready: true };
    if (action === "start") return json("agent_started", { agent });
    if (action === "prompt") return ++prompts === 1
      ? { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: {
        code: "agent_prompt_stalled", message: "no observed work after submission",
      } }) }
      : json("agent_prompted", { agent: { ...agent, agent_status: "done" } });
    if (action === "wait") return { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: {
      code: "timeout", message: "timed out waiting for agent status",
    } }) };
    if (action === "get") return json("agent_info", { agent });
    if (action === "read") return { exitCode: 0, stdout: "ready\n", stderr: "" };
    throw new Error(`Unexpected argv ${argv}`);
  };
  const role = { role: "bug-fix" as const, kind: "opencode" as const,
    model: "openai/gpt-6-sol", executable: "opencode", modelArgs: ["-m", "openai/gpt-6-sol"] };
  const worker = await runWorker({ role, cwd: "C:/repo", prompt: "PSTACK_OK", runsDirectory: directory }, runner);
  expect(worker.status).toBe("done");
  expect((await readRun(directory, name)).status).toBe("done");
  expect(calls.map((call) => call[2])).toEqual(["create", "start", "prompt", "wait", "get", "read", "prompt", "read"]);
  expect(calls[3]).toEqual([process.env.HERDR_BIN_PATH || "herdr", "agent", "wait", "w1:p1",
    "--until", "working", "--until", "done", "--until", "blocked", "--timeout", "30000"]);
  expect(calls[6]![3]).toBe("w1:p1");
});
