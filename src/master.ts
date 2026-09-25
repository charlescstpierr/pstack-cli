import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_KINDS, modelArgs } from "./config";
import type { AgentKind, RoleSelection } from "./config";
import { agentFocus, agentGet, agentStart, promptAndSettle, HerdrError, runHerdr, workspaceCreate } from "./herdr";
import type { AgentInfo, AgentStatus, ArgvRunner } from "./herdr";

export interface MasterRecord {
  readonly name: string;
  readonly workspaceId: string;
  readonly paneId: string;
  readonly terminalId: string;
  readonly cwd: string;
  readonly configPath: string;
  readonly kind: AgentKind;
  readonly model: string;
  readonly status: AgentStatus;
}

export interface MasterRequest {
  readonly selection: RoleSelection;
  readonly cwd: string;
  readonly configPath: string;
}

const masterName = /^pstack-master-[0-9a-f]{16}$/;
const statuses = ["working", "blocked", "done", "idle", "unknown"] as const;

function filePath(configPath: string, name: string): string {
  if (!masterName.test(name)) throw new Error(`Invalid master name ${JSON.stringify(name)}`);
  return join(dirname(configPath), "masters", `${name}.json`);
}

export async function saveMaster(record: MasterRecord): Promise<void> {
  const destination = filePath(record.configPath, record.name);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(record)}\n`);
  await rename(temporary, destination);
}

export async function readMaster(configPath: string, name: string): Promise<MasterRecord> {
  const value: unknown = JSON.parse(await Bun.file(filePath(configPath, name)).text());
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !("name" in value && value.name === name) ||
      !("workspaceId" in value && typeof value.workspaceId === "string") ||
      !("paneId" in value && typeof value.paneId === "string") ||
      !("terminalId" in value && typeof value.terminalId === "string") ||
      !("cwd" in value && typeof value.cwd === "string") ||
      !("configPath" in value && value.configPath === configPath) ||
      !("model" in value && typeof value.model === "string")) {
    throw new Error(`Invalid master record ${JSON.stringify(name)}`);
  }
  const kind = "kind" in value ? AGENT_KINDS.find((item) => item === value.kind) : undefined;
  const status = "status" in value ? statuses.find((item) => item === value.status) : undefined;
  if (!kind || !status) throw new Error(`Invalid master record ${JSON.stringify(name)}`);
  return {
    name, workspaceId: value.workspaceId, paneId: value.paneId, terminalId: value.terminalId,
    cwd: value.cwd, configPath, kind, model: value.model, status,
  };
}

export function sameMaster(agent: AgentInfo, record: MasterRecord): boolean {
  return agent.name === record.name && agent.workspace_id === record.workspaceId &&
    agent.pane_id === record.paneId && agent.terminal_id === record.terminalId &&
    agent.agent === record.kind;
}

export async function startMaster(request: MasterRequest, runner: ArgvRunner = runHerdr): Promise<MasterRecord> {
  const { selection, cwd, configPath } = request;
  const name = `pstack-master-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const workspace = await workspaceCreate(cwd, name, runner);
  const recordFor = (agent: AgentInfo): MasterRecord => ({
    name, workspaceId: workspace.workspace.workspace_id, paneId: agent.pane_id,
    terminalId: agent.terminal_id, cwd, configPath,
    kind: selection.kind, model: selection.model, status: agent.agent_status,
  });
  let started: AgentInfo;
  try {
    started = await agentStart(name, selection.kind, workspace, modelArgs(selection.kind, selection.model), runner);
  } catch (error) {
    if (!(error instanceof HerdrError) || error.code !== "timeout") throw error;
    const pending = await agentGet(name, runner);
    if (!pending || pending.name !== name || pending.agent !== selection.kind ||
        pending.workspace_id !== workspace.workspace.workspace_id ||
        pending.pane_id !== workspace.root_pane.pane_id) throw error;
    await saveMaster(recordFor(pending));
    throw new HerdrError("agent_not_ready",
      `Master ${name} workspace=${pending.workspace_id} pane=${pending.pane_id} is still starting. Check its Herdr pane; no bootstrap was sent.`,
      error.exitCode);
  }
  const record = recordFor(started);
  await saveMaster(record);

  const entryName = import.meta.url.endsWith(".ts") ? "index.ts" : "index.js";
  const entry = join(dirname(fileURLToPath(import.meta.url)), entryName);
  const skills = join(dirname(dirname(entry)), "skills");
  const marker = `PSTACK_MASTER_BOOT_${name}`;
  const bootstrap = `${marker}\nYou are the primary Pstack agent talking to the human in this CLI. Read "${join(skills, "pstack-master", "SKILL.md")}" and "${join(skills, "poteto-mode", "SKILL.md")}" using your file tool now, and follow their real workflows. Workers are other CLI processes in sibling Herdr panes, never native subagents. For every pstack-cli command in those skills, run bun "${entry}" with the same arguments and --config "${configPath}" when accepted. Do not delegate before the human asks for work. Report whether both files were read, then wait for the human. ${marker}`;
  const { agent: settled } = await promptAndSettle({ started, text: bootstrap, echo: marker }, runner);
  if (!sameMaster(settled, record)) {
    throw new HerdrError("invalid_response", "Master identity changed during bootstrap", 0);
  }
  const updated = { ...record, status: settled.agent_status };
  await saveMaster(updated);
  const focused = await agentFocus(name, runner);
  if (!sameMaster(focused, record)) {
    throw new HerdrError("invalid_response", "Focused master changed identity", 0);
  }
  return updated;
}

export async function getLiveMaster(configPath: string, name: string, runner: ArgvRunner = runHerdr): Promise<MasterRecord | null> {
  const record = await readMaster(configPath, name);
  const live = await agentGet(record.paneId, runner);
  if (!live) return null;
  if (!sameMaster(live, record)) throw new HerdrError("master_mismatch", `Master ${name} changed identity`, 0);
  return { ...record, status: live.agent_status };
}

export async function attachMasterTerminal(name: string): Promise<number> {
  const attached = Bun.spawn([process.env.HERDR_BIN_PATH || "herdr", "agent", "attach", name],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return attached.exited;
}
