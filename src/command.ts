import { mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_KINDS, ConfigError, detectInstalledAgents, loadConfig, parseConfig, resolveRole, UPSTREAM_ROLE_NAMES } from "./config";
import type { AgentKind, ExecutableLookup, PstackConfig, RoleName } from "./config";
import { agentGet, agentList, agentPrompt, agentRead, runHerdr } from "./herdr";
import type { AgentInfo, ArgvRunner } from "./herdr";
import { listRuns, readRun, saveRun } from "./store";
import type { WorkerRecord } from "./store";
import { loadAsset, runWorker } from "./worker";

/** Pinned to Lauren Tan's setup-pstack/SKILL.md at cursor/plugins commit 78f46dacbafc71fd7d937bfc2c26da914f1bc09b. */
export const UPSTREAM_SETUP_SOURCE = "https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/setup-pstack/SKILL.md";

export const UPSTREAM_MODEL_RECOMMENDATIONS = {
  "feature, refactoring": ["grok-4.7-xhigh-fast"],
  "bug-fix": ["grok-4.7-xhigh-fast"],
  "perf-issue": ["grok-4.7-xhigh-fast"],
  hillclimb: ["grok-4.7-xhigh-fast"],
  "judgment and prose": ["claude-opus-5-5-max"],
  "hardest tasks": ["claude-opus-5-5-max"],
  "how explorer": ["grok-4.7-xhigh-fast"],
  "how explainer": ["claude-opus-5-5-max"],
  "why investigators": ["grok-4.7-xhigh-fast"],
  "why synthesizer": ["claude-opus-5-5-max"],
  "reflect tooling": ["gpt-5.6-sol-max"],
  "reflect judgment, divergent, synthesizer": ["claude-opus-5-5-max"],
  "arena runners": ["claude-opus-5-5-max", "gpt-5.6-sol-max", "grok-4.7-xhigh-fast"],
  "arena cross-judge pool": ["claude-opus-5-5-max", "gpt-5.6-sol-max", "grok-4.7-xhigh-fast"],
  "swarm workers": ["grok-4.7-xhigh-fast"],
  "architect runners": ["claude-opus-5-5-max", "gpt-5.6-sol-max", "grok-4.7-xhigh-fast"],
  "interrogate reviewers": ["claude-opus-5-5-max", "gpt-5.6-sol-max", "grok-4.7-xhigh-fast"],
} as const satisfies Readonly<Record<RoleName, readonly string[]>>;

export const UPSTREAM_BUDGET_RECOMMENDATIONS = [
  "unlimited, keep max", "large, xhigh reasoning", "medium, high reasoning", "small, medium reasoning",
] as const;

const SETUP_HELP = "Usage: pstack-cli setup [--config PATH] | setup --role ROLE --kind KIND --model MODEL [--config PATH]\n" +
  "Detecting an installed CLI verifies only that its executable is on PATH. It does not verify model access.\n" +
  "--model is saved exactly as supplied; confirm it works for your CLI and account before relying on a run.\n" +
  "Lauren Tan's pinned Cursor defaults are recommendations, not local model IDs. See pstack-cli skill setup-pstack.";

function setupRecommendations(config: PstackConfig): string {
  const lines = [
    `Lauren Tan's upstream setup-pstack recommendations (${UPSTREAM_SETUP_SOURCE})`,
    "Cursor model slugs below are recommendations only, not confirmed available in any installed CLI.",
    "Role | Upstream recommendation(s) | Saved local CLI/model (not verified)",
  ];
  for (const name of UPSTREAM_ROLE_NAMES) {
    const selection = config.roles[name];
    lines.push(`${name} | ${UPSTREAM_MODEL_RECOMMENDATIONS[name].join(", ")} | ${selection ? `${selection.kind} ${selection.model}` : "unconfigured"}`);
  }
  lines.push("Budget recommendations (do not change configured models):", ...UPSTREAM_BUDGET_RECOMMENDATIONS);
  return lines.join("\n");
}

export interface CommandDependencies {
  runner?: ArgvRunner;
  lookup?: ExecutableLookup;
  configPath?: string;
}

export function defaultConfigPath(): string {
  const root = process.env.APPDATA || (process.env.XDG_CONFIG_HOME || join(homedir(), ".config"));
  return join(root, "pstack-cli", "config.json");
}

function options(argv: string[], required: readonly string[], optional: readonly string[] = []): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || ![...required, ...optional].includes(flag.slice(2)) ||
        !value || value.startsWith("--") || result[flag.slice(2)] !== undefined) {
      throw new Error(`Invalid argument ${JSON.stringify(flag)}`);
    }
    result[flag.slice(2)] = value;
  }
  for (const key of required) if (!result[key]) throw new Error(`Missing --${key}`);
  return result;
}

function roleName(value: string): RoleName {
  const match = UPSTREAM_ROLE_NAMES.find((role) => role === value);
  if (!match) throw new ConfigError(`Unknown upstream role ${JSON.stringify(value)}`);
  return match;
}

function agentKind(value: string): AgentKind {
  const match = AGENT_KINDS.find((kind) => kind === value);
  if (!match) throw new ConfigError(`Unsupported CLI kind ${JSON.stringify(value)}`);
  return match;
}

async function currentConfig(path: string): Promise<PstackConfig> {
  return await Bun.file(path).exists() ? loadConfig(path) : parseConfig('{"roles":{}}');
}

function sameWorker(agent: AgentInfo, record: WorkerRecord): boolean {
  return agent.name === record.name && agent.workspace_id === record.workspaceId &&
    agent.pane_id === record.paneId && agent.terminal_id === record.terminalId &&
    agent.agent === record.kind;
}

/** Accepts argv after the executable; returns printable output without exiting the process. */
export async function handleCommand(argv: string[], dependencies: CommandDependencies = {}): Promise<string> {
  const runner = dependencies.runner || runHerdr;
  const installed = detectInstalledAgents(dependencies.lookup);
  const command = argv[0];
  if ((command === "help" || command === "--help") && argv.length === 1) {
    return "Usage: pstack-cli detect | setup [--role ROLE --kind KIND --model MODEL] | run --role ROLE --cwd PATH --prompt TEXT [--skill NAME] | resume NAME --prompt TEXT [--config PATH] | skill NAME | playbook NAME | status [--config PATH] | read NAME [--config PATH]";
  }
  if (command === "detect" && argv.length === 1) return installed.join("\n");
  if (command === "skill" || command === "playbook") {
    if (argv.length !== 2) throw new Error(`Usage: ${command} NAME`);
    return loadAsset(command, argv[1]!);
  }
  if (command === "setup" && (argv.length === 1 || argv[1] === "--help" ||
      (argv.length === 3 && argv[1] === "--config"))) {
    const displayArgs = argv[1] === "--help" ? argv.slice(2) : argv.slice(1);
    const display = options(displayArgs, [], ["config"]);
    return `${SETUP_HELP}\n${setupRecommendations(await currentConfig(display.config || dependencies.configPath || defaultConfigPath()))}`;
  }
  if (command === "read") {
    if (!argv[1] || argv[1].startsWith("--")) throw new Error("Usage: read NAME [--config PATH]");
    const readArgs = options(argv.slice(2), [], ["config"]);
    const runsDirectory = join(dirname(readArgs.config || dependencies.configPath || defaultConfigPath()), "runs");
    const record = await readRun(runsDirectory, argv[1]);
    const live = await agentGet(record.paneId, runner);
    if (!live) return `${record.name} status=stopped`;
    if (!sameWorker(live, record)) return `${record.name} status=mismatch`;
    return agentRead(record.paneId, 80, runner);
  }
  const args = command === "setup" ? options(argv.slice(1), ["role", "kind", "model"], ["config"])
    : command === "run" ? options(argv.slice(1), ["role", "cwd", "prompt"], ["skill", "config"])
    : command === "status" ? options(argv.slice(1), [], ["config"])
    : undefined;
  const path = args?.config || dependencies.configPath || defaultConfigPath();
  if (command === "resume") {
    if (!argv[1] || argv[1].startsWith("--")) throw new Error("Usage: resume NAME --prompt TEXT [--config PATH]");
    const resumeArgs = options(argv.slice(2), ["prompt"], ["config"]);
    const runsDirectory = join(dirname(resumeArgs.config || path), "runs");
    const record = await readRun(runsDirectory, argv[1]);
    const live = await agentGet(record.paneId, runner);
    if (!live) return `${record.name} status=stopped`;
    if (!sameWorker(live, record)) return `${record.name} status=mismatch`;
    const settled = await agentPrompt(record.paneId, resumeArgs.prompt!, 120000, runner);
    if (!sameWorker(settled, record)) throw new Error(`Worker ${record.name} changed identity after prompting`);
    await saveRun(runsDirectory, { ...record, status: settled.agent_status });
    return await agentRead(record.paneId, 80, runner);
  }
  if (command === "setup" && args) {
    const role = roleName(args.role!);
    const kind = agentKind(args.kind!);
    if (!installed.includes(kind)) throw new ConfigError(`Unavailable CLI ${JSON.stringify(kind)}`);
    if (!args.model!.trim()) throw new ConfigError("Model must not be empty");
    const config = await currentConfig(path);
    config.roles[role] = { kind, model: args.model! };
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, `${JSON.stringify(config, null, 2)}\n`);
    await rename(temporary, path);
    return `Saved ${role}: ${kind} ${args.model} (model access not verified)\n${setupRecommendations(config)}`;
  }
  if (command === "run" && args) {
    const role = resolveRole(await loadConfig(path), roleName(args.role!), installed);
    const worker = await runWorker({ role, cwd: args.cwd!, prompt: args.prompt!, skill: args.skill,
      runsDirectory: join(dirname(path), "runs") }, runner);
    return `${worker.name} workspace=${worker.workspace_id} pane=${worker.pane_id} status=${worker.status}\n${worker.output}`;
  }
  if (command === "status" && args) {
    const config = await currentConfig(path);
    const records = await listRuns(join(dirname(path), "runs"));
    const agents = await agentList(runner);
    const lines = [`Installed: ${installed.join(", ") || "none"}`];
    for (const role of UPSTREAM_ROLE_NAMES) {
      const selection = config.roles[role];
      if (selection) lines.push(`${role}: ${selection.kind} ${selection.model}`);
    }
    for (const record of records) {
      const live = agents.find((agent) => sameWorker(agent, record));
      lines.push(`${record.name} role=${record.role} workspace=${record.workspaceId} pane=${record.paneId} status=${live?.agent_status || "not_running"}`);
    }
    return lines.join("\n");
  }
  throw new Error("Usage: pstack-cli detect | setup --role ROLE --kind KIND --model MODEL [--config PATH] | run --role ROLE --cwd PATH --prompt TEXT [--skill NAME] [--config PATH] | resume NAME --prompt TEXT [--config PATH] | skill NAME | playbook NAME | status [--config PATH] | read NAME [--config PATH]");
}
