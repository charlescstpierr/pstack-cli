import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCommand, UPSTREAM_BUDGET_RECOMMENDATIONS, UPSTREAM_MODEL_RECOMMENDATIONS, UPSTREAM_SETUP_SOURCE } from "./index";
import { loadConfig, UPSTREAM_ROLE_NAMES } from "./config";
import type { ArgvRunner, RunResult } from "./herdr";
import { readRun, saveRun } from "./store";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))));
const lookup = (executable: string) => executable === "pi" || executable === "codex" ? `C:/bin/${executable}` : null;
const json = (type: string, fields: object): RunResult => ({
  exitCode: 0, stdout: JSON.stringify({ result: { type, ...fields } }), stderr: "",
});

test("pinned upstream role and budget values are complete and remain recommendations", () => {
  expect(UPSTREAM_ROLE_NAMES.map((role) => UPSTREAM_MODEL_RECOMMENDATIONS[role])).toEqual([
    ["grok-4.7-xhigh-fast"], ["grok-4.7-xhigh-fast"], ["grok-4.7-xhigh-fast"],
    ["grok-4.7-xhigh-fast"], ["claude-opus-5-5-max"], ["claude-opus-5-5-max"],
    ["grok-4.7-xhigh-fast"], ["claude-opus-5-5-max"], ["grok-4.7-xhigh-fast"],
    ["claude-opus-5-5-max"], ["gpt-5.6-sol-max"], ["claude-opus-5-5-max"],
    ["claude-opus-5-5-max", "gpt-5.6-sol-max", "grok-4.7-xhigh-fast"],
    ["claude-opus-5-5-max", "gpt-5.6-sol-max", "grok-4.7-xhigh-fast"],
    ["grok-4.7-xhigh-fast"],
    ["claude-opus-5-5-max", "gpt-5.6-sol-max", "grok-4.7-xhigh-fast"],
    ["claude-opus-5-5-max", "gpt-5.6-sol-max", "grok-4.7-xhigh-fast"],
  ]);
  expect(UPSTREAM_BUDGET_RECOMMENDATIONS).toEqual([
    "unlimited, keep max", "large, xhigh reasoning", "medium, high reasoning", "small, medium reasoning",
  ]);
});

test("setup shows upstream recommendations before and after prior configuration without changing selections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const path = join(directory, "config.json");
  const dependencies = { lookup, configPath: path };
  const first = await handleCommand(["setup", "--role", "how explorer", "--kind", "pi", "--model", "sonnet"], dependencies);
  const second = await handleCommand(["setup", "--role", "bug-fix", "--kind", "codex", "--model", "gpt-6"], dependencies);
  for (const output of [first, second]) {
    expect(output).toContain(UPSTREAM_SETUP_SOURCE);
    for (const role of UPSTREAM_ROLE_NAMES) {
      const line = output.split("\n").find((row) => row.startsWith(`${role} | `));
      expect(line?.split(" | ")[1]).toBe(UPSTREAM_MODEL_RECOMMENDATIONS[role].join(", "));
    }
    for (const budget of UPSTREAM_BUDGET_RECOMMENDATIONS) expect(output.split("\n")).toContain(budget);
  }
  expect(first.split("\n").find((line) => line.startsWith("bug-fix | "))?.split(" | ")[2]).toBe("unconfigured");
  expect(second.split("\n").find((line) => line.startsWith("how explorer | "))?.split(" | ")[2]).toBe("pi sonnet");
  expect(second.split("\n").find((line) => line.startsWith("bug-fix | "))?.split(" | ")[2]).toBe("codex gpt-6");
  expect((await loadConfig(path)).roles).toEqual({
    "how explorer": { kind: "pi", model: "sonnet" }, "bug-fix": { kind: "codex", model: "gpt-6" },
  });
});

test("setup help and setup distinguish upstream defaults from an unverified local model choice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const path = join(directory, "config.json");
  const dependencies = { lookup, configPath: path };
  const help = await handleCommand(["setup", "--help"], dependencies);
  const configured = await handleCommand(["setup", "--role", "bug-fix", "--kind", "codex", "--model", "gpt-5.4"], dependencies);
  const columns = (text: string) => text.split("\n").find((line) => line.startsWith("bug-fix | "))?.split(" | ");
  expect(columns(help)).toEqual(["bug-fix", "grok-4.7-xhigh-fast", "unconfigured"]);
  expect(columns(configured)).toEqual(["bug-fix", "grok-4.7-xhigh-fast", "codex gpt-5.4"]);
  expect(help).toContain(UPSTREAM_SETUP_SOURCE);
  expect(configured).toContain(UPSTREAM_SETUP_SOURCE);
  expect((await loadConfig(path)).roles["bug-fix"]).toEqual({ kind: "codex", model: "gpt-5.4" });
});

test("bare setup always displays Lauren Tan's recommendations, including a saved selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const dependencies = { lookup, configPath: join(directory, "config.json") };

  const before = await handleCommand(["setup"], dependencies);
  await handleCommand(["setup", "--role", "how explorer", "--kind", "pi", "--model", "sonnet"], dependencies);
  const after = await handleCommand(["setup"], dependencies);

  expect(before).toContain(`how explorer | ${UPSTREAM_MODEL_RECOMMENDATIONS["how explorer"].join(", ")} | unconfigured`);
  expect(after).toContain(`how explorer | ${UPSTREAM_MODEL_RECOMMENDATIONS["how explorer"].join(", ")} | pi sonnet`);
  expect(await handleCommand(["setup", "--config", dependencies.configPath], { lookup }))
    .toContain(`how explorer | ${UPSTREAM_MODEL_RECOMMENDATIONS["how explorer"].join(", ")} | pi sonnet`);
  expect(await handleCommand(["--help"], dependencies)).toContain("Usage: pstack-cli");
});

test("setup saves a master separately and keeps Lauren Tan's recommendations visible", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const path = join(directory, "config.json");
  const dependencies = { lookup, configPath: path };

  await handleCommand(["setup", "--role", "how explorer", "--kind", "pi", "--model", "sonnet"], dependencies);
  const output = await handleCommand(["setup", "--master", "codex", "--model", "gpt-6-sol"], dependencies);

  expect((await loadConfig(path)).master).toEqual({ kind: "codex", model: "gpt-6-sol" });
  expect((await loadConfig(path)).roles["how explorer"]).toEqual({ kind: "pi", model: "sonnet" });
  expect(output).toContain(UPSTREAM_SETUP_SOURCE);
  expect(output).toContain(`how explorer | ${UPSTREAM_MODEL_RECOMMENDATIONS["how explorer"].join(", ")} | pi sonnet`);
});

test("status does not attribute a reused agent name to a stale run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const runsDirectory = join(directory, "runs");
  await saveRun(runsDirectory, {
    name: "pstack-old", workspaceId: "w7", paneId: "w7:p1", terminalId: "term-old",
    cwd: "C:/repo", role: "how explorer", kind: "pi", model: "sonnet", status: "done",
  });
  const runner: ArgvRunner = async () => json("agent_list", {
    agents: [{
      name: "pstack-old", agent: "pi", agent_status: "working", workspace_id: "w7",
      pane_id: "w7:p1", terminal_id: "term-new",
    }],
  });

  const status = await handleCommand(["status"], {
    lookup, runner, configPath: join(directory, "config.json"),
  });

  expect(status).toContain("pstack-old role=how explorer workspace=w7 pane=w7:p1 status=not_running");
});

test("argv detect, setup, status, skill, playbook and read use the selected config and adapter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const path = join(directory, "config.json");
  const calls: string[][] = [];
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    if (argv[2] === "list") return json("agent_list", { agents: [] });
    if (argv[2] === "get") return json("agent_info", { agent: {
      name: "worker-a", agent: "pi", agent_status: "idle", workspace_id: "w1",
      pane_id: "w1:p1", terminal_id: "terminal-a",
    } });
    if (argv[2] === "read") return { exitCode: 0, stdout: "pane text\n", stderr: "" };
    throw new Error(`Unexpected argv ${argv}`);
  };
  const dependencies = { lookup, runner, configPath: path };
  expect(await handleCommand(["detect"], dependencies)).toBe("codex\npi");
  expect(await handleCommand(["setup", "--role", "how explorer", "--kind", "pi", "--model", "sonnet", "--config", path], dependencies))
    .toContain("how explorer | grok-4.7-xhigh-fast | pi sonnet");
  expect(await handleCommand(["setup", "--role", "bug-fix", "--kind", "codex", "--model", "gpt-6"], dependencies))
    .toContain("bug-fix | grok-4.7-xhigh-fast | codex gpt-6");
  expect((await loadConfig(path)).roles).toEqual({ "how explorer": { kind: "pi", model: "sonnet" },
    "bug-fix": { kind: "codex", model: "gpt-6" } });
  expect(await handleCommand(["status"], dependencies)).toContain("how explorer: pi sonnet");
  expect(await handleCommand(["skill", "how"], dependencies)).toContain("name: how");
  expect(await handleCommand(["playbook", "feature"], dependencies)).toContain("### Feature");
  await saveRun(join(directory, "runs"), {
    name: "worker-a", workspaceId: "w1", paneId: "w1:p1", terminalId: "terminal-a",
    cwd: "C:/repo", role: "how explorer", kind: "pi", model: "sonnet", status: "idle",
  });
  expect(await handleCommand(["read", "worker-a", "--config", path], { lookup, runner })).toBe("pane text\n");
  expect(calls).toEqual([[process.env.HERDR_BIN_PATH || "herdr", "agent", "list"],
    [process.env.HERDR_BIN_PATH || "herdr", "agent", "get", "w1:p1"],
    [process.env.HERDR_BIN_PATH || "herdr", "agent", "read", "w1:p1", "--source", "recent-unwrapped", "--lines", "80"]]);
  expect(await handleCommand(["status", "--config", path], { lookup, runner }))
    .toContain("worker-a role=how explorer workspace=w1 pane=w1:p1 status=not_running");
});

test("argv run resolves model, creates a workspace, prompts and reports live status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const path = join(directory, "config.json");
  const calls: string[][] = [];
  let name = "";
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    const action = argv[2];
    if (action === "create") {
      name = argv[argv.indexOf("--label") + 1]!;
      return json("workspace_created", { workspace: { workspace_id: "w1", label: name },
        tab: { tab_id: "t1", workspace_id: "w1" }, root_pane: { pane_id: "p1", workspace_id: "w1" } });
    }
    const agent = { name, agent: "pi", agent_status: action === "prompt" ? "blocked" : "idle",
      workspace_id: "w1", pane_id: "p1", terminal_id: "term1" };
    if (action === "start") return json("agent_started", { agent });
    if (action === "prompt") return json("agent_prompted", { agent });
    if (action === "read") return { exitCode: 0, stdout: "waiting for approval\n", stderr: "" };
    if (action === "list") return json("agent_list", { agents: [agent] });
    throw new Error(`Unexpected argv ${argv}`);
  };
  const dependencies = { lookup, runner, configPath: path };
  await handleCommand(["setup", "--role", "how explorer", "--kind", "pi", "--model", "sonnet"], dependencies);
  const output = await handleCommand(["run", "--role", "how explorer", "--cwd", "C:/repo here",
    "--prompt", "Explain this", "--skill", "bro", "--config", path], dependencies);
  expect(output).toBe(`${name} workspace=w1 pane=p1 status=blocked\nwaiting for approval\n`);
  expect(calls[0]).toEqual([process.env.HERDR_BIN_PATH || "herdr", "workspace", "create", "--cwd", "C:/repo here", "--label", name, "--no-focus"]);
  expect(calls[1]).toEqual([process.env.HERDR_BIN_PATH || "herdr", "agent", "start", name, "--kind", "pi", "--pane", "p1", "--", "--model", "sonnet"]);
  expect(calls[2]![4]).toContain("name: bro");
  expect(calls[2]![4]).toEndWith("Explain this");
  expect(await handleCommand(["status"], dependencies)).toContain(`${name} role=how explorer workspace=w1 pane=p1 status=idle`);
});

test("resume after restart prompts the stored agent and returns its transcript", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const configPath = join(directory, "config.json");
  const name = "pstack-saved";
  const record = { name, workspaceId: "w7", paneId: "p1", terminalId: "t7", cwd: "C:/repo",
    role: "how explorer" as const, kind: "pi" as const, model: "sonnet", status: "working" as const };
  await saveRun(join(directory, "runs"), record);
  const agent = { name, workspace_id: "w7", pane_id: "p1", terminal_id: "t7", agent: "pi" };
  const calls: string[][] = [];
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    if (argv[2] === "get") return json("agent_info", { agent: { ...agent, agent_status: "idle" } });
    if (argv[2] === "prompt") return json("agent_prompted", { agent: { ...agent, agent_status: "blocked" } });
    if (argv[2] === "read") return { exitCode: 0, stdout: "continued transcript\n", stderr: "" };
    if (argv[2] === "list") return json("agent_list", { agents: [{ ...agent, agent_status: "blocked" }] });
    throw new Error(`Unexpected argv ${argv}`);
  };
  expect(await handleCommand(["resume", name, "--prompt", "Continue", "--config", configPath], { lookup, runner }))
    .toBe("continued transcript\n");
  expect(calls.slice(0, 3)).toEqual([
    [process.env.HERDR_BIN_PATH || "herdr", "agent", "get", "p1"],
    [process.env.HERDR_BIN_PATH || "herdr", "agent", "prompt", "p1", "Continue", "--wait", "--until", "idle", "--until", "done", "--until", "blocked", "--timeout", "120000"],
    [process.env.HERDR_BIN_PATH || "herdr", "agent", "read", "p1", "--source", "recent-unwrapped", "--lines", "80"],
  ]);
  expect((await readRun(join(directory, "runs"), name)).status).toBe("blocked");
  expect(await handleCommand(["status"], { lookup, runner, configPath }))
    .toContain(`${name} role=how explorer workspace=w7 pane=p1 status=blocked`);
});

test("resume rejects missing and name-reused agents before any prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const configPath = join(directory, "config.json");
  const name = "pstack-saved";
  const record = { name, workspaceId: "w7", paneId: "p1", terminalId: "t7", cwd: "C:/repo",
    role: "how explorer" as const, kind: "pi" as const, model: "sonnet", status: "working" as const };
  await saveRun(join(directory, "runs"), record);
  const original = { name, workspace_id: "w7", pane_id: "p1", terminal_id: "t7", agent: "pi", agent_status: "working" };
  for (const [agent, outcome] of [
    [null, "stopped"],
    [{ ...original, name: "other" }, "mismatch"],
    [{ ...original, workspace_id: "w8" }, "mismatch"],
    [{ ...original, pane_id: "p2" }, "mismatch"],
    [{ ...original, terminal_id: "new-terminal" }, "mismatch"],
    [{ ...original, agent: "codex" }, "mismatch"],
  ] as const) {
    const calls: string[][] = [];
    const runner: ArgvRunner = async (argv) => {
      calls.push(argv);
      if (argv[2] === "get") return agent
        ? json("agent_info", { agent })
        : { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: { code: "agent_not_found", message: "gone" } }) };
      if (argv[2] === "list") return json("agent_list", { agents: agent ? [agent] : [] });
      throw new Error(`Unexpected argv ${argv}`);
    };
    expect(await handleCommand(["resume", name, "--prompt", "Never send"], { lookup, runner, configPath }))
      .toBe(`${name} status=${outcome}`);
    expect(await handleCommand(["read", name, "--config", configPath], { lookup, runner }))
      .toBe(`${name} status=${outcome}`);
    expect(calls).toEqual([
      [process.env.HERDR_BIN_PATH || "herdr", "agent", "get", "p1"],
      [process.env.HERDR_BIN_PATH || "herdr", "agent", "get", "p1"],
    ]);
    expect((await readRun(join(directory, "runs"), name)).status).toBe("working");
    expect(await handleCommand(["status"], { lookup, runner, configPath }))
      .toContain(`${name} role=how explorer workspace=w7 pane=p1 status=not_running`);
  }
});

test("missing role and unavailable CLI fail before creating a workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-cli-"));
  directories.push(directory);
  const path = join(directory, "config.json");
  const runner: ArgvRunner = async () => { throw new Error("Herdr must not be called"); };
  const dependencies = { lookup, runner, configPath: path };
  await handleCommand(["setup", "--role", "bug-fix", "--kind", "codex", "--model", "gpt-6"], dependencies);
  await expect(handleCommand(["run", "--role", "how explorer", "--cwd", "C:/repo", "--prompt", "task"], dependencies))
    .rejects.toThrow('No selection configured for role "how explorer"');
  await expect(handleCommand(["run", "--role", "bug-fix", "--cwd", "C:/repo", "--prompt", "task"],
    { ...dependencies, lookup: () => null })).rejects.toThrow('selects unavailable CLI "codex"');
  await expect(handleCommand(["setup", "--role", "bug-fix", "--kind", "claude", "--model", "opus"], dependencies))
    .rejects.toThrow('Unavailable CLI "claude"');
});
