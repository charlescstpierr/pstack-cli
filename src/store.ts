import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_KINDS, UPSTREAM_ROLE_NAMES } from "./config";
import type { AgentKind, RoleName } from "./config";
import type { AgentStatus } from "./herdr";

export type WorkerRecord = {
  readonly name: string;
  readonly workspaceId: string;
  readonly paneId: string;
  readonly terminalId: string;
  readonly cwd: string;
  readonly role: RoleName;
  readonly kind: AgentKind;
  readonly model: string;
  readonly status: AgentStatus;
};

export class RunStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStoreError";
  }
}

const runName = /^[a-z][a-z0-9_-]{0,31}$/;
const statuses = ["working", "blocked", "done", "idle", "unknown"] as const;

function isRole(value: unknown): value is RoleName {
  return typeof value === "string" && UPSTREAM_ROLE_NAMES.some((role) => role === value);
}

function isKind(value: unknown): value is AgentKind {
  return typeof value === "string" && AGENT_KINDS.some((kind) => kind === value);
}

function isStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && statuses.some((status) => status === value);
}

function record(value: unknown): WorkerRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RunStoreError("Invalid worker record");
  }
  if (!("name" in value && "workspaceId" in value && "paneId" in value &&
    "terminalId" in value && "cwd" in value && "role" in value &&
    "kind" in value && "model" in value && "status" in value) ||
    typeof value.name !== "string" || !runName.test(value.name) ||
    typeof value.workspaceId !== "string" ||
    typeof value.paneId !== "string" || typeof value.terminalId !== "string" ||
    typeof value.cwd !== "string" || typeof value.model !== "string" ||
    !isRole(value.role) || !isKind(value.kind) || !isStatus(value.status)) {
    throw new RunStoreError("Invalid worker record");
  }
  return {
    name: value.name,
    workspaceId: value.workspaceId,
    paneId: value.paneId,
    terminalId: value.terminalId,
    cwd: value.cwd,
    role: value.role,
    kind: value.kind,
    model: value.model,
    status: value.status,
  };
}

function filePath(directory: string, name: string): string {
  if (!runName.test(name)) throw new RunStoreError(`Invalid agent name: ${name}`);
  return join(directory, `${name}.json`);
}

export async function saveRun(directory: string, value: WorkerRecord): Promise<void> {
  const worker = record(value);
  await mkdir(directory, { recursive: true });
  const destination = filePath(directory, worker.name);
  const temporary = join(directory, `.${worker.name}-${crypto.randomUUID()}.tmp`);
  await Bun.write(temporary, `${JSON.stringify(worker)}\n`);
  await rename(temporary, destination);
}

export async function readRun(directory: string, name: string): Promise<WorkerRecord> {
  const file = Bun.file(filePath(directory, name));
  return record(JSON.parse(await file.text()));
}

export async function listRuns(directory: string): Promise<readonly WorkerRecord[]> {
  const entries = await readdir(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const names = entries.filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map((name) => readRun(directory, name.slice(0, -5))));
}
