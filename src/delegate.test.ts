import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { handleCommand } from "./index";
import type { ArgvRunner, RunResult } from "./herdr";
import { readMaster, saveMaster } from "./master";
import { readTask, saveTask } from "./tasks";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))));
const json = (type: string, fields: object): RunResult => ({
  exitCode: 0, stdout: JSON.stringify({ result: { type, ...fields } }), stderr: "",
});

test("a master delegates into one sibling pane and collects a report only after completion", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pstack-delegate-"));
  directories.push(cwd);
  const configPath = join(cwd, "config.json");
  const name = "pstack-master-1234567890abcdef";
  await saveMaster({ name, workspaceId: "w1", paneId: "w1:p1", terminalId: "main-term",
    cwd, configPath, kind: "claude", model: "sonnet", status: "idle" });
  const calls: string[][] = [];
  let workerName = "";
  let workerStatus: "working" | "idle" = "working";
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    const action = argv[2];
    const primary = { name, agent: "claude", agent_status: "idle",
      workspace_id: "w1", pane_id: "w1:p1", terminal_id: "main-term" };
    const worker = { name: workerName, agent: "opencode", agent_status: workerStatus,
      workspace_id: "w1", pane_id: "w1:p2", terminal_id: "worker-term" };
    if (action === "get") return json("agent_info", { agent: argv[3] === "w1:p1" ? primary : worker });
    if (action === "split") return json("pane_info", { pane: {
      pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1",
    } });
    if (action === "wait-output") return json("output_matched", {
      pane_id: "w1:p2", matched_line: "Ask anything…",
    });
    if (action === "start") {
      workerName = argv[3] ?? "";
      return json("agent_started", { agent: { ...worker, name: workerName, agent_status: "idle" } });
    }
    if (action === "prompt") return json("agent_prompted", { agent: worker });
    if (action === "close") return json("ok", {});
    throw new Error(`Unexpected Herdr call ${argv.join(" ")}`);
  };
  const dependencies = { runner, configPath,
    context: { paneId: "w1:p1", workspaceId: "w1" },
    lookup: (exe: string) => exe === "opencode" ? "C:/bin/opencode" : null };
  await handleCommand(["setup", "--role", "how explorer", "--kind", "opencode",
    "--model", "openai/gpt-6-sol"], dependencies);

  const first = await handleCommand(["delegate", "--task-id", "hash", "--role", "how explorer",
    "--prompt", "Compute the checksum", "--cwd", "."], dependencies);
  const repeated = await handleCommand(["delegate", "--task-id", "hash", "--role", "how explorer",
    "--prompt", "Compute something different"], dependencies);
  const pending = await handleCommand(["collect", "hash"], dependencies);
  const resultPath = join(cwd, ".pstack", "tasks", name, "hash.md");
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, "SHA256=abcdef\n");
  workerStatus = "idle";
  const completed = await handleCommand(["collect", "hash"], dependencies);
  const closed = await handleCommand(["dismiss", "hash"], dependencies);

  expect(first).toMatch(/^hash status=working pane=w1:p2 agent=pt-/);
  expect(repeated).toContain("hash status=exists pane=w1:p2");
  expect(pending).toContain("hash status=working");
  expect(completed).toContain("hash status=done pane=w1:p2");
  expect(completed).toContain("SHA256=abcdef");
  expect(closed).toContain("hash status=closed pane=w1:p2");
  expect(calls.filter((call) => call[2] === "split")).toHaveLength(1);
  expect(calls.filter((call) => call[2] === "prompt")).toHaveLength(1);
  expect(calls.filter((call) => call[2] === "close")).toHaveLength(1);
});

test("collect refuses a replaced worker terminal without reading its contents", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pstack-delegate-"));
  directories.push(cwd);
  const configPath = join(cwd, "config.json");
  const name = "pstack-master-1234567890abcdef";
  await saveMaster({ name, workspaceId: "w1", paneId: "w1:p1", terminalId: "main-term",
    cwd, configPath, kind: "claude", model: "sonnet", status: "idle" });
  const calls: string[][] = [];
  let workerName = "";
  let replaced = false;
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    const primary = { name, agent: "claude", agent_status: "idle",
      workspace_id: "w1", pane_id: "w1:p1", terminal_id: "main-term" };
    const worker = { name: workerName, agent: "opencode", agent_status: "idle",
      workspace_id: "w1", pane_id: "w1:p2", terminal_id: replaced ? "replacement" : "worker-term" };
    if (argv[2] === "get") return json("agent_info", { agent: argv[3] === "w1:p1" ? primary : worker });
    if (argv[2] === "split") return json("pane_info", { pane: {
      pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1",
    } });
    if (argv[2] === "wait-output") return json("output_matched", {
      pane_id: "w1:p2", matched_line: "Ask anything…",
    });
    if (argv[2] === "start") {
      workerName = argv[3] ?? "";
      return json("agent_started", { agent: worker });
    }
    if (argv[2] === "prompt") return json("agent_prompted", { agent: { ...worker, agent_status: "working" } });
    throw new Error(`Unexpected Herdr call ${argv.join(" ")}`);
  };
  const dependencies = { runner, configPath,
    context: { paneId: "w1:p1", workspaceId: "w1" },
    lookup: (exe: string) => exe === "opencode" ? "C:/bin/opencode" : null };
  await handleCommand(["setup", "--role", "how explorer", "--kind", "opencode",
    "--model", "openai/gpt-6-sol"], dependencies);
  await handleCommand(["delegate", "--task-id", "audit", "--role", "how explorer",
    "--prompt", "Inspect"], dependencies);
  replaced = true;

  expect(await handleCommand(["collect", "audit"], dependencies)).toContain("audit status=mismatch");
  expect(calls.filter((call) => call[2] === "read" || call[2] === "close")).toHaveLength(0);
});

test("a stalled submission reserves its ID and never opens or prompts a second worker", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pstack-delegate-"));
  directories.push(cwd);
  const configPath = join(cwd, "config.json");
  const name = "pstack-master-1234567890abcdef";
  await saveMaster({ name, workspaceId: "w1", paneId: "w1:p1", terminalId: "main-term",
    cwd, configPath, kind: "claude", model: "sonnet", status: "idle" });
  const calls: string[][] = [];
  let workerName = "";
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    const primary = { name, agent: "claude", agent_status: "idle",
      workspace_id: "w1", pane_id: "w1:p1", terminal_id: "main-term" };
    if (argv[2] === "get") return json("agent_info", { agent: primary });
    if (argv[2] === "split") return json("pane_info", { pane: {
      pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1",
    } });
    if (argv[2] === "start") {
      workerName = argv[3] ?? "";
      return json("agent_started", { agent: {
        name: workerName, agent: "opencode", agent_status: "idle",
        workspace_id: "w1", pane_id: "w1:p2", terminal_id: "worker-term",
      } });
    }
    if (argv[2] === "wait-output") return json("output_matched", {
      pane_id: "w1:p2", matched_line: "Ask anything…",
    });
    if (argv[2] === "prompt") return {
      exitCode: 1, stdout: "", stderr: JSON.stringify({
        error: { code: "agent_prompt_stalled", message: "No activity observed after submission" },
      }),
    };
    throw new Error(`Unexpected Herdr call ${argv.join(" ")}`);
  };
  const dependencies = { runner, configPath,
    context: { paneId: "w1:p1", workspaceId: "w1" },
    lookup: (exe: string) => exe === "opencode" ? "C:/bin/opencode" : null };
  await handleCommand(["setup", "--role", "how explorer", "--kind", "opencode",
    "--model", "openai/gpt-6-sol"], dependencies);

  const first = await handleCommand(["delegate", "--task-id", "stalled", "--role", "how explorer",
    "--prompt", "Inspect"], dependencies);
  const again = await handleCommand(["delegate", "--task-id", "stalled", "--role", "how explorer",
    "--prompt", "Inspect"], dependencies);

  expect(first).toContain("stalled status=unknown");
  expect(again).toContain("stalled status=exists");
  expect(calls.filter((call) => call[2] === "split")).toHaveLength(1);
  expect(calls.filter((call) => call[2] === "prompt")).toHaveLength(1);
});

test("a finished worker without a report cannot be collected as a result", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pstack-delegate-"));
  directories.push(cwd);
  const configPath = join(cwd, "config.json");
  const name = "pstack-master-1234567890abcdef";
  await saveMaster({ name, workspaceId: "w1", paneId: "w1:p1", terminalId: "main-term",
    cwd, configPath, kind: "claude", model: "sonnet", status: "idle" });
  const master = await readMaster(configPath, name);
  await mkdir(join(cwd, "tasks", name), { recursive: true });
  await saveTask(master, {
    id: "absent", masterName: name, workspaceId: "w1",
    masterPaneId: "w1:p1", masterTerminalId: "main-term",
    workerName: "pt-abcdef-absent", workerPaneId: "w1:p2",
    workerTerminalId: "worker-term", role: "how explainer",
    kind: "opencode", model: "openai/gpt-6-sol", cwd,
    resultPath: join(cwd, ".pstack", "tasks", name, "absent.md"),
    state: "working",
  });
  const runner: ArgvRunner = async (argv) => {
    if (argv[2] === "get") return json("agent_info", { agent: argv[3] === "w1:p1"
      ? { name, agent: "claude", workspace_id: "w1", pane_id: "w1:p1",
        terminal_id: "main-term", agent_status: "idle" }
      : { name: "pt-abcdef-absent", agent: "opencode", workspace_id: "w1",
        pane_id: "w1:p2", terminal_id: "worker-term", agent_status: "done" } });
    if (argv[2] === "read") return { exitCode: 0, stdout: "Terminal text without report\n", stderr: "" };
    throw new Error(`Unexpected Herdr call ${argv.join(" ")}`);
  };

  const output = await handleCommand(["collect", "absent"], { configPath, runner,
    context: { paneId: "w1:p1", workspaceId: "w1" } });

  expect(output).toContain("absent status=unknown");
  expect(output).not.toContain("status=done");
  expect((await readTask(master, "absent")).state).toBe("working");
});

test("a worker blocked on CLI startup receives no brief", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pstack-delegate-"));
  directories.push(cwd);
  const configPath = join(cwd, "config.json");
  const name = "pstack-master-1234567890abcdef";
  await saveMaster({ name, workspaceId: "w1", paneId: "w1:p1", terminalId: "main-term",
    cwd, configPath, kind: "claude", model: "sonnet", status: "idle" });
  const calls: string[][] = [];
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    if (argv[2] === "get") return json("agent_info", { agent: argv[3] === "w1:p1"
      ? { name, agent: "claude", workspace_id: "w1", pane_id: "w1:p1",
        terminal_id: "main-term", agent_status: "idle" }
      : { name: "pt-abcdef-startup", agent: "opencode", workspace_id: "w1",
        pane_id: "w1:p2", terminal_id: "worker-term", agent_status: "blocked" } });
    if (argv[2] === "split") return json("pane_info", { pane: {
      pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t1",
    } });
    if (argv[2] === "start") return {
      exitCode: 1, stdout: "", stderr: JSON.stringify({
        error: { code: "agent_not_ready", message: "worker is blocked on login" },
      }),
    };
    if (argv[2] === "wait") return {
      exitCode: 1, stdout: "", stderr: JSON.stringify({
        error: { code: "timeout", message: "worker never passed login" },
      }),
    };
    throw new Error(`Unexpected Herdr call ${argv.join(" ")}`);
  };
  const dependencies = { configPath, runner,
    context: { paneId: "w1:p1", workspaceId: "w1" },
    lookup: (exe: string) => exe === "opencode" ? "C:/bin/opencode" : null };
  await handleCommand(["setup", "--role", "how explorer", "--kind", "opencode",
    "--model", "openai/gpt-6-sol"], dependencies);

  const output = await handleCommand(["delegate", "--task-id", "startup",
    "--role", "how explorer", "--prompt", "Inspect"], dependencies);

  expect(output).toContain("startup status=blocked");
  expect(calls.filter((call) => call[2] === "prompt")).toHaveLength(0);
});
