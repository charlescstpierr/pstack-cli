import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config";
import { handleCommand, UPSTREAM_SETUP_SOURCE } from "./index";
import type { ArgvRunner, RunResult } from "./herdr";
import { runOnboarding } from "./onboard";
import { listRuns } from "./store";

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
    ask: answers(["99", "2", "1", "", "gpt-6-sol", "n"]),
    print: () => {},
    execute,
    configPath,
  });

  expect((await loadConfig(configPath)).roles).toEqual({
    "bug-fix": { kind: "codex", model: "gpt-6-sol" },
  });
  expect(await Bun.file(join(directory, "runs")).exists()).toBe(false);
});

test("onboarding starts the selected CLI in the requested folder when the user opts in", async () => {
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
    if (argv[2] === "read") return { exitCode: 0, stdout: "Réponse de l'agent\n", stderr: "" };
    throw new Error(`Unexpected Herdr command ${argv.join(" ")}`);
  };
  const printed: string[] = [];
  const execute = (argv: string[]) => handleCommand(argv, {
    lookup: (executable) => executable === "opencode" ? "C:/bin/opencode" : null,
    runner, configPath,
  });

  await runOnboarding({
    ask: answers(["2", "1", "openai/gpt-6-sol", "o", "dossier-absent", directory, "Corrige le bogue"]),
    print: (line) => printed.push(line),
    execute,
    configPath,
  });

  expect(calls[0]).toEqual([process.env.HERDR_BIN_PATH || "herdr", "workspace", "create",
    "--cwd", directory, "--label", name, "--no-focus"]);
  expect(calls[1]).toEqual([process.env.HERDR_BIN_PATH || "herdr", "agent", "start",
    name, "--kind", "opencode", "--pane", "pane", "--", "-m", "openai/gpt-6-sol"]);
  expect(calls[2]).toContain("Corrige le bogue");
  expect(printed.join("\n")).toContain("Réponse de l'agent");
  expect((await listRuns(join(directory, "runs")))[0]?.name).toBe(name);
});
