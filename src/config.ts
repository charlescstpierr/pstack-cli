export const AGENT_KINDS = ["claude", "codex", "opencode", "pi"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

const AGENT_EXECUTABLES: Readonly<Record<AgentKind, string>> = {
  claude: "claude",
  codex: "codex",
  opencode: "opencode",
  pi: "pi",
};

/** Exact role labels used by upstream pstack's setup-pstack configuration. */
export const UPSTREAM_ROLE_NAMES = [
  "feature, refactoring",
  "bug-fix",
  "perf-issue",
  "hillclimb",
  "judgment and prose",
  "hardest tasks",
  "how explorer",
  "how explainer",
  "why investigators",
  "why synthesizer",
  "reflect tooling",
  "reflect judgment, divergent, synthesizer",
  "arena runners",
  "arena cross-judge pool",
  "swarm workers",
  "architect runners",
  "interrogate reviewers",
] as const;

export type RoleName = (typeof UPSTREAM_ROLE_NAMES)[number];

/** Stable programmatic names for the upstream role labels. */
export const ROLE_MAPPING = {
  featureRefactoring: "feature, refactoring",
  bugFix: "bug-fix",
  perfIssue: "perf-issue",
  hillclimb: "hillclimb",
  judgmentAndProse: "judgment and prose",
  hardestTasks: "hardest tasks",
  howExplorer: "how explorer",
  howExplainer: "how explainer",
  whyInvestigators: "why investigators",
  whySynthesizer: "why synthesizer",
  reflectTooling: "reflect tooling",
  reflectJudgment: "reflect judgment, divergent, synthesizer",
  arenaRunners: "arena runners",
  arenaCrossJudgePool: "arena cross-judge pool",
  swarmWorkers: "swarm workers",
  architectRunners: "architect runners",
  interrogateReviewers: "interrogate reviewers",
} as const satisfies Readonly<Record<string, RoleName>>;

export interface RoleSelection {
  kind: AgentKind;
  model: string;
}

export interface PstackConfig {
  roles: Partial<Record<RoleName, RoleSelection>>;
  master?: RoleSelection;
}

export interface ResolvedRole extends RoleSelection {
  role: RoleName;
  executable: string;
  modelArgs: string[];
}

export type ExecutableLookup = (executable: string) => string | null | undefined;
export type ConfigReader = (path: string) => Promise<string>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === "string" && (AGENT_KINDS as readonly string[]).includes(value);
}

function isRoleName(value: string): value is RoleName {
  return (UPSTREAM_ROLE_NAMES as readonly string[]).includes(value);
}

function parseSelection(role: string, value: unknown): RoleSelection {
  if (!isRecord(value)) throw new ConfigError(`Role ${JSON.stringify(role)} must be an object`);
  if (!isAgentKind(value.kind)) {
    throw new ConfigError(`Role ${JSON.stringify(role)} has unsupported kind ${JSON.stringify(value.kind)}`);
  }
  if (typeof value.model !== "string" || value.model.trim() === "") {
    throw new ConfigError(`Role ${JSON.stringify(role)} must select a non-empty model`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "kind" && key !== "model")) {
    throw new ConfigError(`Role ${JSON.stringify(role)} contains unsupported fields`);
  }
  return { kind: value.kind, model: value.model };
}

/** Parse the JSON configuration without supplying model or provider defaults. */
export function parseConfig(json: string): PstackConfig {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ConfigError("Configuration is not valid JSON");
  }

  if (!isRecord(value) || !isRecord(value.roles)) {
    throw new ConfigError("Configuration must contain a roles object");
  }
  if (Object.keys(value).some((key) => key !== "roles" && key !== "master")) {
    throw new ConfigError("Configuration contains unsupported fields");
  }

  const roles: Partial<Record<RoleName, RoleSelection>> = {};
  for (const [name, selection] of Object.entries(value.roles)) {
    if (!isRoleName(name)) throw new ConfigError(`Unknown upstream role ${JSON.stringify(name)}`);
    roles[name] = parseSelection(name, selection);
  }
  return { roles, ...("master" in value ? { master: parseSelection("master", value.master) } : {}) };
}

const readUserConfig: ConfigReader = (path) => Bun.file(path).text();

/** Load JSON from the caller-selected user configuration path. */
export async function loadConfig(path: string, read: ConfigReader = readUserConfig): Promise<PstackConfig> {
  try {
    return parseConfig(await read(path));
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Unable to read configuration ${JSON.stringify(path)}: ${message}`);
  }
}

const lookupExecutable: ExecutableLookup = (executable) => Bun.which(executable);

/** Discover every supported CLI present on PATH, retaining the fixed kind order. */
export function detectInstalledAgents(lookup: ExecutableLookup = lookupExecutable): AgentKind[] {
  return AGENT_KINDS.filter((kind) => lookup(AGENT_EXECUTABLES[kind]) != null);
}

export function modelArgs(kind: AgentKind, model: string): string[] {
  return kind === "claude" || kind === "pi" ? ["--model", model] : ["-m", model];
}

/** Resolve only the explicit selection for a role; an unavailable CLI is never substituted. */
export function resolveRole(
  config: PstackConfig,
  role: RoleName,
  installed: readonly AgentKind[] = detectInstalledAgents(),
): ResolvedRole {
  const selection = config.roles[role];
  if (!selection) throw new ConfigError(`No selection configured for role ${JSON.stringify(role)}`);
  if (!installed.includes(selection.kind)) {
    throw new ConfigError(`Role ${JSON.stringify(role)} selects unavailable CLI ${JSON.stringify(selection.kind)}`);
  }
  return {
    role,
    ...selection,
    executable: AGENT_EXECUTABLES[selection.kind],
    modelArgs: modelArgs(selection.kind, selection.model),
  };
}
