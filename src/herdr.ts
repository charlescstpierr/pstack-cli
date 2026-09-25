/** The CLI receives argv directly, without shell interpolation. */
export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ArgvRunner = (argv: string[]) => Promise<RunResult>;

export interface WorkspaceRoot {
  workspace: { workspace_id: string; label: string };
  tab: { tab_id: string; workspace_id: string };
  root_pane: { pane_id: string; workspace_id: string };
}

export interface SplitPane {
  readonly pane_id: string;
  readonly workspace_id: string;
  readonly tab_id: string;
}

export type AgentStatus = "working" | "blocked" | "done" | "idle" | "unknown";

function isAgentStatus(value: unknown): value is AgentStatus {
  return value === "working" || value === "blocked" || value === "done" ||
    value === "idle" || value === "unknown";
}

export interface AgentInfo {
  name?: string | null;
  agent?: string | null;
  agent_status: AgentStatus;
  workspace_id: string;
  pane_id: string;
  terminal_id: string;
  interactive_ready?: boolean;
  [key: string]: unknown;
}

export type AgentKind =
  | "pi" | "claude" | "codex" | "gemini" | "cursor" | "devin"
  | "agy" | "cline" | "omp" | "mastracode" | "opencode"
  | "copilot" | "kimi" | "kiro" | "droid" | "amp" | "grok"
  | "hermes" | "kilo" | "qodercli" | "qwen" | "letta"
  | "maki" | "muse";

export class HerdrError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

export const runHerdr: ArgvRunner = async (argv) => {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return {
    exitCode,
    stdout,
    stderr,
  };
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorBody(value: unknown): value is { code: string; message: string } {
  return object(value) && typeof value.code === "string" && typeof value.message === "string";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function execute(args: string[], runner: ArgvRunner): Promise<Record<string, unknown>> {
  const { exitCode, stdout, stderr } = await runner([process.env.HERDR_BIN_PATH || "herdr", ...args]);
  const value = parseJson(stdout.trim());
  const errorValue = object(value) && errorBody(value.error) ? value : parseJson(stderr.trim());
  const error = object(errorValue) && errorBody(errorValue.error) ? errorValue.error : undefined;
  if (errorBody(error)) throw new HerdrError(error.code, error.message, exitCode);
  if (exitCode !== 0) {
    throw new HerdrError("herdr_exit", stderr.trim() || stdout.trim() || `Herdr exited with ${exitCode}`, exitCode);
  }
  if (!object(value) || !object(value.result) || typeof value.result.type !== "string") {
    throw new HerdrError("invalid_response", `Invalid Herdr JSON response for ${args.join(" ")}`, exitCode);
  }
  return value.result;
}

async function result(args: string[], type: string, runner: ArgvRunner): Promise<Record<string, unknown>> {
  const value = await execute(args, runner);
  if (value.type !== type) {
    throw new HerdrError("invalid_response", `Expected Herdr ${type}, got ${String(value.type)}`, 0);
  }
  return value;
}

function agent(value: unknown): AgentInfo {
  if (!object(value) || typeof value.pane_id !== "string" ||
      typeof value.workspace_id !== "string" || typeof value.terminal_id !== "string" ||
      !isAgentStatus(value.agent_status)) {
    throw new HerdrError("invalid_response", "Herdr response has no agent identity", 0);
  }
  return {
    pane_id: value.pane_id,
    workspace_id: value.workspace_id,
    terminal_id: value.terminal_id,
    agent_status: value.agent_status,
    ...(typeof value.agent === "string" ? { agent: value.agent } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.interactive_ready === "boolean" ? { interactive_ready: value.interactive_ready } : {}),
  };
}

/** Each call creates a new workspace, whose first tab already owns a root pane. */
export async function workspaceCreate(cwd: string, label: string, runner: ArgvRunner = runHerdr): Promise<WorkspaceRoot> {
  const value = await result(["workspace", "create", "--cwd", cwd, "--label", label, "--no-focus"], "workspace_created", runner);
  const { workspace, tab, root_pane } = value;
  if (!object(workspace) || typeof workspace.workspace_id !== "string" ||
      !object(tab) || typeof tab.tab_id !== "string" ||
      !object(root_pane) || typeof root_pane.pane_id !== "string" ||
      typeof root_pane.workspace_id !== "string" ||
      root_pane.workspace_id !== workspace.workspace_id) {
    throw new HerdrError("invalid_response", "Herdr workspace has no matching root pane", 0);
  }
  return {
    workspace: { workspace_id: workspace.workspace_id, label: typeof workspace.label === "string" ? workspace.label : label },
    tab: { tab_id: tab.tab_id, workspace_id: workspace.workspace_id },
    root_pane: { pane_id: root_pane.pane_id, workspace_id: root_pane.workspace_id },
  };
}

export async function paneSplit(source: string, cwd: string, runner: ArgvRunner = runHerdr): Promise<SplitPane> {
  const value = await result(
    ["pane", "split", "--pane", source, "--direction", "right", "--cwd", cwd, "--no-focus"],
    "pane_info", runner,
  );
  if (!object(value.pane) || typeof value.pane.pane_id !== "string" ||
      typeof value.pane.workspace_id !== "string" || typeof value.pane.tab_id !== "string") {
    throw new HerdrError("invalid_response", "Split returned no pane identity", 0);
  }
  return {
    pane_id: value.pane.pane_id, workspace_id: value.pane.workspace_id, tab_id: value.pane.tab_id,
  };
}

export async function paneClose(paneId: string, runner: ArgvRunner = runHerdr): Promise<void> {
  await result(["pane", "close", paneId], "ok", runner);
}

/** Wait for a visible CLI input prompt, including one already on screen. */
export async function paneWaitOutput(
  paneId: string, marker: string, runner: ArgvRunner = runHerdr,
): Promise<void> {
  const value = await result(
    ["pane", "wait-output", "--match", marker, "--timeout", "30000", paneId],
    "output_matched", runner,
  );
  if (value.pane_id !== paneId || typeof value.matched_line !== "string" ||
      !value.matched_line.includes(marker)) {
    throw new HerdrError("invalid_response", "Pane input prompt changed during readiness wait", 0);
  }
}

/** Start only in the root pane returned by this worker's workspace creation. */
export async function agentStart(
  name: string, kind: AgentKind, workspace: WorkspaceRoot,
  modelArgs: string[] = [], runner: ArgvRunner = runHerdr,
): Promise<AgentInfo> {
  let value: Record<string, unknown>;
  try {
    value = await result(
      ["agent", "start", name, "--kind", kind, "--pane", workspace.root_pane.pane_id, "--", ...modelArgs],
      "agent_started", runner,
    );
  } catch (error) {
    if (!(error instanceof HerdrError) || error.code !== "agent_not_ready") throw error;
    // Herdr retains the named agent when its startup screen is transiently blocked.
    value = await result(
      ["agent", "wait", name, "--until", "idle", "--until", "done", "--timeout", "30000"],
      "agent_info", runner,
    );
  }
  const started = agent(value.agent);
  if (started.pane_id !== workspace.root_pane.pane_id ||
      started.workspace_id !== workspace.workspace.workspace_id ||
      started.agent !== kind) {
    throw new HerdrError("invalid_response", "Started agent is not in the worker's root pane", 0);
  }
  return started;
}

export async function agentPrompt(
  target: string, text: string, timeoutMs: number,
  runner: ArgvRunner = runHerdr,
): Promise<AgentInfo> {
  const value = await result(
    ["agent", "prompt", target, text, "--wait", "--until", "idle", "--until", "done", "--until", "blocked", "--timeout", String(timeoutMs)],
    "agent_prompted", runner,
  );
  return agent(value.agent);
}

/** Acknowledge a worker's first observed activity without waiting for the entire task. */
export async function agentSubmit(target: string, text: string, runner: ArgvRunner = runHerdr): Promise<AgentInfo> {
  const value = await result(
    ["agent", "prompt", target, text, "--wait", "--until", "working", "--until", "done",
      "--until", "blocked", "--timeout", "30000"],
    "agent_prompted", runner,
  );
  return agent(value.agent);
}

/** Wait for actual agent activity without submitting another prompt. */
export async function agentWait(
  target: string, statuses: readonly AgentStatus[], timeoutMs: number,
  runner: ArgvRunner = runHerdr,
): Promise<AgentInfo> {
  const value = await result(
    ["agent", "wait", target, ...statuses.flatMap((status) => ["--until", status]), "--timeout", String(timeoutMs)],
    "agent_info", runner,
  );
  return agent(value.agent);
}

export interface PromptRequest {
  readonly started: AgentInfo;
  readonly text: string;
  readonly echo: string;
}

/** A stalled submission is ambiguous; observe activity before considering one guarded retry. */
export async function promptAndSettle(
  request: PromptRequest,
  runner: ArgvRunner = runHerdr,
): Promise<{ readonly agent: AgentInfo; readonly unconfirmed: boolean }> {
  const { started, text, echo } = request;
  let settled: AgentInfo;
  let unconfirmed = false;
  try {
    settled = await agentPrompt(started.name || started.pane_id, text, 120000, runner);
  } catch (error) {
    if (!(error instanceof HerdrError) || error.code !== "agent_prompt_stalled") throw error;
    try {
      settled = await agentWait(started.pane_id, ["working", "done", "blocked"], 30000, runner);
      if (settled.agent_status === "working") {
        try {
          settled = await agentWait(started.pane_id, ["idle", "done", "blocked"], 120000, runner);
        } catch (waitError) {
          if (!(waitError instanceof HerdrError) || waitError.code !== "timeout") throw waitError;
          settled = { ...settled, agent_status: "unknown" };
          unconfirmed = true;
        }
      }
    } catch (waitError) {
      if (!(waitError instanceof HerdrError) || waitError.code !== "timeout") throw waitError;
      const live = await agentGet(started.pane_id, runner);
      if (!live || live.name !== started.name || live.workspace_id !== started.workspace_id ||
          live.pane_id !== started.pane_id || live.terminal_id !== started.terminal_id ||
          live.agent !== started.agent) throw error;
      const screen = await agentRead(started.pane_id, 80, runner);
      if (screen.includes(echo) || live.agent_status !== "idle" || live.interactive_ready !== true) {
        settled = { ...live, agent_status: "unknown" };
        unconfirmed = true;
      } else {
        settled = await agentPrompt(started.pane_id, text, 120000, runner);
      }
    }
  }
  if (settled.workspace_id !== started.workspace_id || settled.pane_id !== started.pane_id ||
      settled.terminal_id !== started.terminal_id || settled.agent !== started.agent) {
    throw new HerdrError("invalid_response", "Prompted agent changed identity", 0);
  }
  return { agent: settled, unconfirmed };
}

/** A missing name is a stopped worker; other Herdr errors must surface. */
export async function agentGet(target: string, runner: ArgvRunner = runHerdr): Promise<AgentInfo | null> {
  try {
    const value = await result(["agent", "get", target], "agent_info", runner);
    return agent(value.agent);
  } catch (error) {
    if (error instanceof HerdrError && error.code === "agent_not_found") return null;
    throw error;
  }
}

/** Herdr agent read prints terminal text, not a JSON success envelope. */
export async function agentRead(target: string, lines = 80, runner: ArgvRunner = runHerdr): Promise<string> {
  const args = ["agent", "read", target, "--source", "recent-unwrapped", "--lines", String(lines)];
  const { exitCode, stdout, stderr } = await runner([process.env.HERDR_BIN_PATH || "herdr", ...args]);
  const failure = parseJson(stderr.trim());
  const error = object(failure) && errorBody(failure.error) ? failure.error : undefined;
  if (errorBody(error)) throw new HerdrError(error.code, error.message, exitCode);
  if (exitCode !== 0) throw new HerdrError("herdr_exit", stderr.trim() || stdout.trim() || `Herdr exited with ${exitCode}`, exitCode);
  return stdout;
}

export async function agentList(runner: ArgvRunner = runHerdr): Promise<AgentInfo[]> {
  const value = await result(["agent", "list"], "agent_list", runner);
  if (!Array.isArray(value.agents)) throw new HerdrError("invalid_response", "Herdr response has no agents list", 0);
  return value.agents.map(agent);
}

/** Focus the named primary conversation after it is ready. */
export async function agentFocus(target: string, runner: ArgvRunner = runHerdr): Promise<AgentInfo> {
  const value = await result(["agent", "focus", target], "agent_info", runner);
  return agent(value.agent);
}
