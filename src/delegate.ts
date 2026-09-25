import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ConfigError, loadConfig, resolveRole } from "./config";
import type { AgentKind, RoleName } from "./config";
import { agentGet, agentRead, agentStart, agentSubmit, agentWait, HerdrError,
  paneClose, paneSplit, paneWaitOutput, runHerdr } from "./herdr";
import type { AgentInfo, ArgvRunner, WorkspaceRoot } from "./herdr";
import { readMaster, sameMaster } from "./master";
import type { MasterRecord } from "./master";
import { listTasks, readTask, reserveTask, saveTask } from "./tasks";
import type { TaskRecord } from "./tasks";
import { loadAsset } from "./worker";

export type CallerContext = { readonly paneId: string; readonly workspaceId: string };
export type TaskOutcome = { readonly task: TaskRecord; readonly status: string; readonly body?: string };

export interface DelegateRequest {
  readonly id: string;
  readonly role: RoleName;
  readonly prompt: string;
  readonly cwd?: string;
  readonly skill?: string;
  readonly installed?: readonly AgentKind[];
}

export async function currentMaster(
  configPath: string, runner: ArgvRunner = runHerdr, context?: CallerContext,
): Promise<MasterRecord> {
  const paneId = context?.paneId ?? process.env.HERDR_PANE_ID;
  const workspaceId = context?.workspaceId ?? process.env.HERDR_WORKSPACE_ID;
  if ((!context && process.env.HERDR_ENV !== "1") || !paneId || !workspaceId) {
    throw new ConfigError("Delegation requires the primary CLI running inside a Herdr pane");
  }
  const agent = await agentGet(paneId, runner);
  if (!agent?.name?.startsWith("pstack-master-") || agent.workspace_id !== workspaceId) {
    throw new HerdrError("master_mismatch", "Current pane does not contain a Pstack master", 0);
  }
  const master = await readMaster(configPath, agent.name);
  if (!sameMaster(agent, master)) {
    throw new HerdrError("master_mismatch", "Current pane changed Pstack master identity", 0);
  }
  return master;
}

function sameWorker(agent: AgentInfo, task: TaskRecord): boolean {
  return task.state !== "reserved" && task.state !== "split" &&
    agent.name === task.workerName && agent.workspace_id === task.workspaceId &&
    agent.pane_id === task.workerPaneId && agent.terminal_id === task.workerTerminalId &&
    agent.agent === task.kind;
}

export async function delegate(
  master: MasterRecord, request: DelegateRequest, runner: ArgvRunner = runHerdr,
): Promise<TaskOutcome> {
  const config = await loadConfig(master.configPath);
  const role = resolveRole(config, request.role, request.installed);
  const cwd = request.cwd ? resolve(master.cwd, request.cwd) : master.cwd;
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new ConfigError("Worker --cwd must resolve to an existing directory");
  }
  const resultPath = join(cwd, ".pstack", "tasks", master.name, `${request.id}.md`);
  const reserved: TaskRecord = {
    id: request.id, masterName: master.name, workspaceId: master.workspaceId,
    masterPaneId: master.paneId, masterTerminalId: master.terminalId,
    workerName: `pt-${master.name.slice(-6)}-${request.id}`,
    role: request.role, kind: role.kind, model: role.model, cwd, resultPath, state: "reserved",
  };
  if (!await reserveTask(master, reserved)) {
    return { task: await readTask(master, request.id), status: "exists" };
  }

  const pane = await paneSplit(master.paneId, cwd, runner);
  if (pane.workspace_id !== master.workspaceId) {
    throw new HerdrError("invalid_response", "Worker pane is outside the master's workspace", 0);
  }
  const split: TaskRecord = { ...reserved, workerPaneId: pane.pane_id, state: "split" };
  await saveTask(master, split);
  const workspace: WorkspaceRoot = {
    workspace: { workspace_id: master.workspaceId, label: master.name },
    tab: { tab_id: pane.tab_id, workspace_id: master.workspaceId },
    root_pane: { pane_id: pane.pane_id, workspace_id: master.workspaceId },
  };
  let started: AgentInfo;
  try {
    started = await agentStart(reserved.workerName, role.kind, workspace, role.modelArgs, runner);
  } catch (error) {
    if (!(error instanceof HerdrError) || (error.code !== "timeout" && error.code !== "agent_not_ready")) throw error;
    const pending = await agentGet(reserved.workerName, runner);
    if (!pending || pending.name !== reserved.workerName || pending.agent !== role.kind ||
        pending.workspace_id !== master.workspaceId || pending.pane_id !== pane.pane_id) throw error;
    const blocked: TaskRecord = { ...split, workerTerminalId: pending.terminal_id, state: "blocked" };
    await saveTask(master, blocked);
    return { task: blocked, status: "blocked", body: "Worker CLI is not ready; no brief was submitted." };
  }
  const ready: TaskRecord = { ...split, workerTerminalId: started.terminal_id, state: "started" };
  await saveTask(master, ready);
  if (role.kind === "opencode") {
    try {
      await paneWaitOutput(ready.workerPaneId, "Ask anything", runner);
    } catch (error) {
      if (!(error instanceof HerdrError) || error.code !== "timeout") throw error;
      return { task: ready, status: "unknown", body: "OpenCode input did not appear; no brief was submitted." };
    }
  }
  const brief = request.skill ? `${await loadAsset("skill", request.skill)}\n\n${request.prompt}` : request.prompt;
  await mkdir(dirname(resultPath), { recursive: true });
  const text = `${brief}\n\nWrite your complete result as Markdown to "${resultPath}" before finishing. Create its parent directory if needed. Then reply with PSTACK_DONE ${request.id}.`;
  const submitting: TaskRecord = { ...ready, state: "submitting" };
  await saveTask(master, submitting);
  let submitted: AgentInfo;
  try {
    submitted = await agentSubmit(ready.workerName, text, runner);
  } catch (error) {
    if (!(error instanceof HerdrError) ||
        !["agent_prompt_stalled", "timeout", "agent_blocked"].includes(error.code)) throw error;
    const state = error.code === "agent_blocked" ? "blocked" : "unknown";
    const uncertain: TaskRecord = { ...ready, state };
    await saveTask(master, uncertain);
    return { task: uncertain, status: state };
  }
  if (!sameWorker(submitted, submitting)) {
    throw new HerdrError("invalid_response", "Submitted worker changed identity", 0);
  }
  const state = submitted.agent_status === "blocked" ? "blocked" : "working";
  const active: TaskRecord = { ...ready, state };
  await saveTask(master, active);
  return { task: active, status: state };
}

export async function collect(
  master: MasterRecord, id: string, waitMs: number, runner: ArgvRunner = runHerdr,
): Promise<TaskOutcome> {
  const task = await readTask(master, id);
  if (task.state === "reserved" || task.state === "split") return { task, status: "unknown" };
  let live = await agentGet(task.workerPaneId, runner);
  if (!live) return { task, status: "missing" };
  if (!sameWorker(live, task)) return { task, status: "mismatch" };
  if (waitMs > 0 && live.agent_status === "working") {
    try {
      live = await agentWait(task.workerPaneId, ["idle", "done", "blocked"], waitMs, runner);
    } catch (error) {
      if (!(error instanceof HerdrError) || error.code !== "timeout") throw error;
      return { task, status: "working" };
    }
    if (!sameWorker(live, task)) return { task, status: "mismatch" };
  }
  if (live.agent_status === "working") return { task, status: "working" };
  if (live.agent_status === "blocked") {
    const blocked: TaskRecord = { ...task, state: "blocked" };
    await saveTask(master, blocked);
    return { task: blocked, status: "blocked", body: await agentRead(task.workerPaneId, 40, runner) };
  }
  if (live.agent_status !== "idle" && live.agent_status !== "done") return { task, status: "unknown" };
  const result = Bun.file(task.resultPath);
  if (!await result.exists()) {
    return { task, status: "unknown", body: await agentRead(task.workerPaneId, 40, runner) };
  }
  const body = await result.text();
  if (!body.trim()) return { task, status: "unknown" };
  const done: TaskRecord = { ...task, state: "done" };
  await saveTask(master, done);
  return { task: done, status: "done", body };
}

export async function tasks(master: MasterRecord): Promise<readonly TaskRecord[]> {
  return listTasks(master);
}

export async function dismiss(
  master: MasterRecord, id: string, runner: ArgvRunner = runHerdr,
): Promise<TaskOutcome> {
  const task = await readTask(master, id);
  if (task.state !== "done") throw new Error(`Collect task ${id} before dismissing its pane`);
  const live = await agentGet(task.workerPaneId, runner);
  if (!live) return { task, status: "missing" };
  if (!sameWorker(live, task)) return { task, status: "mismatch" };
  if (live.agent_status !== "idle" && live.agent_status !== "done") {
    return { task, status: live.agent_status };
  }
  await paneClose(task.workerPaneId, runner);
  return { task, status: "closed" };
}
