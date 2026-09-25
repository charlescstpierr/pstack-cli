import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  agentGet, agentList, agentPrompt, agentRead, agentStart, agentWait, HerdrError, workspaceCreate,
  type ArgvRunner, type RunResult,
} from "./herdr";

const previousBin = process.env.HERDR_BIN_PATH;
beforeEach(() => { delete process.env.HERDR_BIN_PATH; });
afterEach(() => {
  if (previousBin === undefined) delete process.env.HERDR_BIN_PATH;
  else process.env.HERDR_BIN_PATH = previousBin;
});

function mock(expected: string[], response: RunResult): ArgvRunner {
  return async (argv) => {
    expect(argv).toEqual(expected);
    return response;
  };
}

function success(type: string, fields: object): RunResult {
  return { exitCode: 0, stdout: JSON.stringify({ id: "cli:test", result: { type, ...fields } }), stderr: "" };
}

const worker = {
  workspace: { workspace_id: "w7", label: "worker-a" },
  tab: { tab_id: "w7:t1", workspace_id: "w7" },
  root_pane: { pane_id: "w7:p1", workspace_id: "w7" },
};
const running = {
  name: "worker-a", agent: "codex", agent_status: "idle" as const,
  pane_id: "w7:p1", workspace_id: "w7", terminal_id: "terminal-7", interactive_ready: true,
};

test("creates a fresh workspace and returns its root pane without focusing", async () => {
  process.env.HERDR_BIN_PATH = "C:/mock/herdr.exe";
  expect(await workspaceCreate("C:/repo with spaces", "worker-a", mock(
    ["C:/mock/herdr.exe", "workspace", "create", "--cwd", "C:/repo with spaces", "--label", "worker-a", "--no-focus"],
    success("workspace_created", worker),
  ))).toEqual(worker);
});

test("separate workers use different workspace root panes; model argv is passed unchanged", async () => {
  delete process.env.HERDR_BIN_PATH;
  const second = {
    workspace: { workspace_id: "w8", label: "worker-b" },
    tab: { tab_id: "w8:t1", workspace_id: "w8" },
    root_pane: { pane_id: "w8:p1", workspace_id: "w8" },
  };
  const calls: string[][] = [];
  const responses = [success("workspace_created", worker), success("workspace_created", second)];
  const create: ArgvRunner = async (argv) => {
    calls.push(argv);
    const response = responses[calls.length - 1];
    if (!response) throw new Error("Unexpected workspace call");
    return response;
  };
  const [a, b] = await Promise.all([
    workspaceCreate("C:/repo", "worker-a", create),
    workspaceCreate("C:/repo", "worker-b", create),
  ]);
  expect(calls).toEqual([
    ["herdr", "workspace", "create", "--cwd", "C:/repo", "--label", "worker-a", "--no-focus"],
    ["herdr", "workspace", "create", "--cwd", "C:/repo", "--label", "worker-b", "--no-focus"],
  ]);
  expect(a.root_pane.pane_id).not.toBe(b.root_pane.pane_id);
  expect(await agentStart("worker-a", "codex", a, ["-m", "gpt 5"], mock(
    ["herdr", "agent", "start", "worker-a", "--kind", "codex", "--pane", "w7:p1", "--", "-m", "gpt 5"],
    success("agent_started", { agent: running, argv: ["codex", "-m", "gpt 5"] }),
  ))).toEqual(running);
  expect((await agentStart("worker-b", "pi", b, [], mock(
    ["herdr", "agent", "start", "worker-b", "--kind", "pi", "--pane", "w8:p1", "--"],
    success("agent_started", { agent: { ...running, agent: "pi", name: "worker-b", pane_id: "w8:p1", workspace_id: "w8" }, argv: ["pi"] }),
  ))).pane_id).toBe("w8:p1");
});

test("resumes a named agent whose startup blocker clears without launching it twice", async () => {
  const calls: string[][] = [];
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    return calls.length === 1
      ? { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: { code: "agent_not_ready", message: "blocked during startup" } }) }
      : success("agent_info", { agent: running });
  };

  expect(await agentStart("worker-a", "codex", worker, [], runner)).toEqual(running);
  expect(calls).toEqual([
    ["herdr", "agent", "start", "worker-a", "--kind", "codex", "--pane", "w7:p1", "--"],
    ["herdr", "agent", "wait", "worker-a", "--until", "idle", "--until", "done", "--timeout", "30000"],
  ]);
});

test("prompt waits for exactly idle, done, or blocked with a timeout", async () => {
  expect((await agentPrompt("worker-a", "Check this diff", 120000, mock(
    ["herdr", "agent", "prompt", "worker-a", "Check this diff", "--wait", "--until", "idle", "--until", "done", "--until", "blocked", "--timeout", "120000"],
    success("agent_prompted", { agent: { ...running, agent_status: "blocked" } }),
  ))).agent_status).toBe("blocked");
});

test("wait listens for activity without submitting another prompt", async () => {
  expect(await agentWait("w7:p1", ["working", "done", "blocked"], 30000, mock(
    ["herdr", "agent", "wait", "w7:p1", "--until", "working", "--until", "done", "--until", "blocked", "--timeout", "30000"],
    success("agent_info", { agent: { ...running, agent_status: "working" } }),
  ))).toMatchObject({ agent_status: "working", terminal_id: "terminal-7" });
});

test("read returns plain terminal output, and list parses the agents array", async () => {
  expect(await agentRead("worker-a", 120, mock(
    ["herdr", "agent", "read", "worker-a", "--source", "recent-unwrapped", "--lines", "120"],
    { exitCode: 0, stdout: "actual output\n", stderr: "" },
  ))).toBe("actual output\n");
  expect(await agentList(mock(["herdr", "agent", "list"], success("agent_list", { agents: [running] })))).toEqual([running]);
});

test("get returns an identified agent or null only for a missing name", async () => {
  expect(await agentGet("worker-a", mock(["herdr", "agent", "get", "worker-a"],
    success("agent_info", { agent: running })))).toEqual(running);
  const failure = (code: string): RunResult => ({ exitCode: 1, stdout: "", stderr: JSON.stringify({ error: { code, message: code } }) });
  expect(await agentGet("worker-a", mock(["herdr", "agent", "get", "worker-a"], failure("agent_not_found")))).toBeNull();
  await expect(agentGet("worker-a", mock(["herdr", "agent", "get", "worker-a"], failure("offline"))))
    .rejects.toThrow(new HerdrError("offline", "offline", 1));
  await expect(agentGet("worker-a", mock(["herdr", "agent", "get", "worker-a"],
    success("agent_info", { agent: { ...running, terminal_id: null } })))).rejects.toThrow(HerdrError);
});

test("JSON CLI error and nonzero exit are reported, including read errors", async () => {
  const failure: RunResult = { exitCode: 1, stdout: "", stderr: JSON.stringify({ id: "cli:agent:prompt", error: { code: "timeout", message: "timed out" } }) };
  await expect(agentPrompt("worker-a", "task", 100, mock(
    ["herdr", "agent", "prompt", "worker-a", "task", "--wait", "--until", "idle", "--until", "done", "--until", "blocked", "--timeout", "100"], failure,
  ))).rejects.toThrow(new HerdrError("timeout", "timed out", 1));
  await expect(agentRead("worker-a", 80, mock(
    ["herdr", "agent", "read", "worker-a", "--source", "recent-unwrapped", "--lines", "80"], failure,
  ))).rejects.toThrow(new HerdrError("timeout", "timed out", 1));
  await expect(agentList(mock(["herdr", "agent", "list"], { exitCode: 2, stdout: "", stderr: "invalid syntax" })))
    .rejects.toThrow(new HerdrError("herdr_exit", "invalid syntax", 2));
  await expect(agentList(mock(["herdr", "agent", "list"], { exitCode: 1, stdout: JSON.stringify({ error: { code: "offline", message: "not running" } }), stderr: "" })))
    .rejects.toThrow(new HerdrError("offline", "not running", 1));
});

test("rejects malformed success and a response for a different pane", async () => {
  await expect(workspaceCreate("C:/repo", "worker-a", mock(
    ["herdr", "workspace", "create", "--cwd", "C:/repo", "--label", "worker-a", "--no-focus"],
    success("workspace_created", { ...worker, root_pane: { pane_id: "w8:p1", workspace_id: "w8" } }),
  ))).rejects.toThrow(HerdrError);
  await expect(agentStart("worker-a", "codex", worker, [], mock(
    ["herdr", "agent", "start", "worker-a", "--kind", "codex", "--pane", "w7:p1", "--"],
    success("agent_started", { agent: { ...running, pane_id: "w8:p1" } }),
  ))).rejects.toThrow(HerdrError);
  await expect(agentList(mock(["herdr", "agent", "list"], { exitCode: 0, stdout: "not json", stderr: "" })))
    .rejects.toThrow(HerdrError);
});
