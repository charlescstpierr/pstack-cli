import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AGENT_KINDS, UPSTREAM_ROLE_NAMES } from "./config";
import type { AgentKind, RoleName } from "./config";
import type { MasterRecord } from "./master";

type TaskBase = {
  readonly id: string;
  readonly masterName: string;
  readonly workspaceId: string;
  readonly masterPaneId: string;
  readonly masterTerminalId: string;
  readonly workerName: string;
  readonly role: RoleName;
  readonly kind: AgentKind;
  readonly model: string;
  readonly cwd: string;
  readonly resultPath: string;
};

export type TaskRecord = TaskBase & (
  | { readonly state: "reserved" }
  | { readonly state: "split"; readonly workerPaneId: string }
  | { readonly state: "started" | "submitting" | "working" | "blocked" | "unknown" | "done";
      readonly workerPaneId: string; readonly workerTerminalId: string }
);

const taskId = /^[a-z][a-z0-9-]{0,19}$/;
const runningStates = ["started", "submitting", "working", "blocked", "unknown", "done"] as const;

export function taskDirectory(master: MasterRecord): string {
  return join(dirname(master.configPath), "tasks", master.name);
}

function taskPath(master: MasterRecord, id: string): string {
  if (!taskId.test(id)) throw new Error(`Invalid task id ${JSON.stringify(id)}`);
  return join(taskDirectory(master), `${id}.json`);
}

function parseTask(value: unknown): TaskRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !("id" in value && typeof value.id === "string" && taskId.test(value.id)) ||
      !("masterName" in value && typeof value.masterName === "string") ||
      !("workspaceId" in value && typeof value.workspaceId === "string") ||
      !("masterPaneId" in value && typeof value.masterPaneId === "string") ||
      !("masterTerminalId" in value && typeof value.masterTerminalId === "string") ||
      !("workerName" in value && typeof value.workerName === "string") ||
      !("role" in value && UPSTREAM_ROLE_NAMES.some((role) => role === value.role)) ||
      !("kind" in value && AGENT_KINDS.some((kind) => kind === value.kind)) ||
      !("model" in value && typeof value.model === "string") ||
      !("cwd" in value && typeof value.cwd === "string") ||
      !("resultPath" in value && typeof value.resultPath === "string") ||
      !("state" in value && typeof value.state === "string")) {
    throw new Error("Invalid Pstack task record");
  }
  const role = UPSTREAM_ROLE_NAMES.find((item) => item === value.role);
  const kind = AGENT_KINDS.find((item) => item === value.kind);
  if (!role || !kind) throw new Error("Invalid Pstack task role");
  const base: TaskBase = {
    id: value.id, masterName: value.masterName, workspaceId: value.workspaceId,
    masterPaneId: value.masterPaneId, masterTerminalId: value.masterTerminalId,
    workerName: value.workerName, role, kind, model: value.model,
    cwd: value.cwd, resultPath: value.resultPath,
  };
  if (value.state === "reserved") return { ...base, state: "reserved" };
  if (!("workerPaneId" in value && typeof value.workerPaneId === "string")) {
    throw new Error("Invalid Pstack task pane");
  }
  if (value.state === "split") return { ...base, state: "split", workerPaneId: value.workerPaneId };
  const state = runningStates.find((item) => item === value.state);
  if (!state || !("workerTerminalId" in value && typeof value.workerTerminalId === "string")) {
    throw new Error("Invalid Pstack task state");
  }
  return { ...base, state, workerPaneId: value.workerPaneId, workerTerminalId: value.workerTerminalId };
}

export async function reserveTask(master: MasterRecord, value: TaskRecord): Promise<boolean> {
  const destination = taskPath(master, value.id);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(destination, `${JSON.stringify(value)}\n`, { flag: "wx" });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
}

export async function saveTask(master: MasterRecord, value: TaskRecord): Promise<void> {
  const destination = taskPath(master, value.id);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx" });
  await rename(temporary, destination);
}

export async function readTask(master: MasterRecord, id: string): Promise<TaskRecord> {
  const value: unknown = JSON.parse(await readFile(taskPath(master, id), "utf8"));
  const task = parseTask(value);
  if (task.id !== id || task.masterName !== master.name ||
      task.workspaceId !== master.workspaceId || task.masterPaneId !== master.paneId ||
      task.masterTerminalId !== master.terminalId) throw new Error(`Task ${id} does not belong to this master`);
  return task;
}

export async function listTasks(master: MasterRecord): Promise<readonly TaskRecord[]> {
  const names = await readdir(taskDirectory(master)).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  return Promise.all(names.filter((name) => name.endsWith(".json"))
    .sort().map((name) => readTask(master, name.slice(0, -5))));
}
