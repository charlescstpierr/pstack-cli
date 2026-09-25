import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCommand } from "./index";
import type { ArgvRunner, RunResult } from "./herdr";
import { getLiveMaster, readMaster } from "./master";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))));

const json = (type: string, fields: object): RunResult => ({
  exitCode: 0, stdout: JSON.stringify({ result: { type, ...fields } }), stderr: "",
});

test("chat starts a persistent selected CLI in a root pane and reattaches by identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-master-"));
  directories.push(directory);
  const configPath = join(directory, "config.json");
  let name = "";
  const calls: string[][] = [];
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    if (argv[1] === "workspace" && argv[2] === "create") {
      name = argv[argv.indexOf("--label") + 1] ?? "";
      return json("workspace_created", { workspace: { workspace_id: "w-main", label: name },
        tab: { tab_id: "w-main:t1", workspace_id: "w-main" },
        root_pane: { pane_id: "w-main:p1", workspace_id: "w-main" } });
    }
    const agent = { name, agent: "opencode", workspace_id: "w-main",
      pane_id: "w-main:p1", terminal_id: "term-main",
      agent_status: argv[2] === "prompt" ? "done" : "idle" };
    if (argv[2] === "start") return json("agent_started", { agent });
    if (argv[2] === "prompt") return json("agent_prompted", { agent });
    if (argv[2] === "focus") return json("agent_info", { agent });
    if (argv[2] === "get") return json("agent_info", { agent });
    throw new Error(`Unexpected Herdr call ${argv.join(" ")}`);
  };
  const dependencies = { runner, configPath,
    lookup: (executable: string) => executable === "opencode" ? "C:/bin/opencode" : null };
  await handleCommand(["setup", "--master", "opencode", "--model", "openai/gpt-6-sol"], dependencies);

  const started = await handleCommand(["chat", "--cwd", directory], dependencies);
  const attached = await handleCommand(["chat", name], dependencies);

  expect(started).toMatch(/^pstack-master-[0-9a-f]{16} workspace=w-main pane=w-main:p1 status=done$/);
  expect(attached).toBe(`${name} workspace=w-main pane=w-main:p1 status=idle`);
  expect(calls.filter((call) => call[2] === "create")).toHaveLength(1);
  expect(calls.find((call) => call[2] === "start")).toEqual([
    process.env.HERDR_BIN_PATH || "herdr", "agent", "start", name,
    "--kind", "opencode", "--pane", "w-main:p1", "--", "-m", "openai/gpt-6-sol",
  ]);
  expect(calls.filter((call) => call[2] === "prompt")).toHaveLength(1);
  expect((await readMaster(configPath, name)).terminalId).toBe("term-main");
});

test("chat refuses to attach when another process replaces the master's terminal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-master-"));
  directories.push(directory);
  const configPath = join(directory, "config.json");
  const name = "pstack-master-1234567890abcdef";
  const { saveMaster } = await import("./master");
  await saveMaster({ name, workspaceId: "w1", paneId: "w1:p1", terminalId: "old",
    cwd: directory, configPath, kind: "claude", model: "sonnet", status: "idle" });
  const runner: ArgvRunner = async () => json("agent_info", { agent: {
    name, workspace_id: "w1", pane_id: "w1:p1", terminal_id: "replacement",
    agent: "claude", agent_status: "idle",
  } });

  await expect(getLiveMaster(configPath, name, runner)).rejects.toThrow(/changed identity/);
});
