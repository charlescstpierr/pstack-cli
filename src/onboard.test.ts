import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { handleCommand, UPSTREAM_SETUP_SOURCE } from "./index";
import type { ArgvRunner, RunResult } from "./herdr";
import { readMaster } from "./master";
import { runOnboarding } from "./onboard";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))));

function answers(values: string[]): (question: string) => Promise<string> {
  return async () => {
    const answer = values.shift();
    if (answer === undefined) throw new Error("Unexpected question");
    return answer;
  };
}

const json = (type: string, fields: object): RunResult => ({
  exitCode: 0, stdout: JSON.stringify({ result: { type, ...fields } }), stderr: "",
});

test("onboarding shows recommendations and stops before asking when no CLI is installed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-init-"));
  directories.push(directory);
  const printed: string[] = [];
  const configPath = join(directory, "config.json");
  const execute = (argv: string[]) => handleCommand(argv, { lookup: () => null, configPath });

  await runOnboarding({ ask: answers([]), print: (line) => printed.push(line), execute, configPath });

  expect(printed.join("\n")).toContain(UPSTREAM_SETUP_SOURCE);
  expect(await Bun.file(configPath).exists()).toBe(false);
});

test("onboarding configures a chosen Codex role after correcting invalid answers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-init-"));
  directories.push(directory);
  const configPath = join(directory, "config.json");
  const execute = (argv: string[]) => handleCommand(argv, {
    lookup: (executable) => executable === "codex" ? "C:/bin/codex" : null, configPath,
  });

  await runOnboarding({
    ask: answers(["1", "gpt-6-sol", "99", "1", "2", "", "gpt-6-sol", "n"]),
    print: () => {},
    execute,
    configPath,
  });

  expect((await loadConfig(configPath)).roles).toEqual({
    "bug-fix": { kind: "codex", model: "gpt-6-sol" },
  });
  expect((await loadConfig(configPath)).master).toEqual({ kind: "codex", model: "gpt-6-sol" });
  expect(await Bun.file(join(directory, "runs")).exists()).toBe(false);
});

test("onboarding opens the master conversation after configuring two distinct worker CLIs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-init-"));
  directories.push(directory);
  const configPath = join(directory, "config.json");
  const calls: string[][] = [];
  let name = "";
  const runner: ArgvRunner = async (argv) => {
    calls.push(argv);
    if (argv[2] === "create") {
      name = argv[argv.indexOf("--label") + 1] ?? "";
      return json("workspace_created", { workspace: { workspace_id: "w-test", label: name },
        tab: { tab_id: "tab", workspace_id: "w-test" },
        root_pane: { pane_id: "pane", workspace_id: "w-test" } });
    }
    const agent = { name, agent: "opencode", workspace_id: "w-test",
      pane_id: "pane", terminal_id: "terminal",
      agent_status: argv[2] === "prompt" ? "done" : "idle" };
    if (argv[2] === "start") return json("agent_started", { agent });
    if (argv[2] === "prompt") return json("agent_prompted", { agent });
    if (argv[2] === "focus") return json("agent_info", { agent: { ...agent, agent_status: "idle" } });
    throw new Error(`Unexpected Herdr command ${argv.join(" ")}`);
  };
  const printed: string[] = [];
  const execute = (argv: string[]) => handleCommand(argv, {
    lookup: (executable) => executable === "claude" || executable === "opencode"
      ? `C:/bin/${executable}` : null,
    runner, configPath,
  });

  const masterName = await runOnboarding({
    ask: answers(["2", "openai/gpt-6-sol", "1,1", "1,2", "5", "sonnet", "2", "openai/gpt-6-sol",
      "o", "dossier-absent", directory]),
    print: (line) => printed.push(line),
    execute,
    configPath,
  });

  expect(calls[0]).toEqual([process.env.HERDR_BIN_PATH || "herdr", "workspace", "create",
    "--cwd", directory, "--label", name, "--no-focus"]);
  expect(calls[1]).toEqual([process.env.HERDR_BIN_PATH || "herdr", "agent", "start",
    name, "--kind", "opencode", "--pane", "pane", "--", "-m", "openai/gpt-6-sol"]);
  expect(calls.map((call) => call[2])).toEqual(["create", "start", "prompt", "focus"]);
  expect(masterName).toBe(name);
  expect(printed.join("\n")).toContain(`${name} workspace=w-test pane=pane status=done`);
  expect((await readMaster(configPath, name)).kind).toBe("opencode");
  expect((await loadConfig(configPath)).master).toEqual({ kind: "opencode", model: "openai/gpt-6-sol" });
  expect((await loadConfig(configPath)).roles).toEqual({
    "judgment and prose": { kind: "claude", model: "sonnet" },
    "bug-fix": { kind: "opencode", model: "openai/gpt-6-sol" },
  });
  expect(await Bun.file(join(directory, "runs")).exists()).toBe(false);
});

test("onboarding offers only unused roles for later CLIs and saves each choice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-init-"));
  directories.push(directory);
  const configPath = join(directory, "config.json");
  const execute = (argv: string[]) => handleCommand(argv, {
    lookup: (executable) => ["claude", "codex", "opencode"].includes(executable)
      ? `C:/bin/${executable}` : null, configPath,
  });

  await runOnboarding({
    ask: answers(["1", "sonnet", "1,2,3", "2", "sonnet", "2", "gpt-6-sol",
      "2", "openai/gpt-6-sol", "n"]),
    print: () => {},
    execute,
    configPath,
  });

  expect((await loadConfig(configPath)).roles).toEqual({
    "bug-fix": { kind: "claude", model: "sonnet" },
    "perf-issue": { kind: "codex", model: "gpt-6-sol" },
    hillclimb: { kind: "opencode", model: "openai/gpt-6-sol" },
  });
  expect((await loadConfig(configPath)).master).toEqual({ kind: "claude", model: "sonnet" });
});
