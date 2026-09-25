import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { agentGet, agentRead, agentStart, promptAndSettle, HerdrError, runHerdr, workspaceCreate } from "./herdr";
import type { AgentInfo, ArgvRunner } from "./herdr";
import type { ResolvedRole } from "./config";
import { saveRun } from "./store";
import type { WorkerRecord } from "./store";

const assetName = /^[a-z0-9][a-z0-9-]*$/;

export async function loadAsset(kind: "skill" | "playbook", name: string): Promise<string> {
  if (!assetName.test(name)) throw new Error(`Invalid ${kind} name ${JSON.stringify(name)}`);
  const path = kind === "skill"
    ? `../skills/${name}/SKILL.md`
    : `../skills/poteto-mode/playbooks/${name}.md`;
  try {
    return await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Unknown ${kind} ${JSON.stringify(name)}`);
    }
    throw error;
  }
}

export interface WorkerRequest {
  role: ResolvedRole;
  cwd: string;
  prompt: string;
  skill?: string;
  runsDirectory: string;
}

/** Stable Herdr identity alongside the store's existing record fields. */
export interface WorkerResult extends WorkerRecord {
  readonly workspace_id: string;
  readonly pane_id: string;
  readonly terminal_id: string;
  readonly output: string;
}

export async function runWorker(request: WorkerRequest, runner: ArgvRunner = runHerdr): Promise<WorkerResult> {
  const { role, cwd, skill, runsDirectory } = request;
  const prompt = skill ? `${await loadAsset("skill", skill)}\n\n${request.prompt}` : request.prompt;
  const name = `pstack-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const workspace = await workspaceCreate(cwd, name, runner);
  const recordFor = (agent: AgentInfo): WorkerRecord => ({
    name, workspaceId: workspace.workspace.workspace_id, paneId: agent.pane_id,
    terminalId: agent.terminal_id, cwd, role: role.role, kind: role.kind,
    model: role.model, status: agent.agent_status,
  });
  let started: AgentInfo;
  try {
    started = await agentStart(name, role.kind, workspace, role.modelArgs, runner);
  } catch (error) {
    if (!(error instanceof HerdrError) || error.code !== "timeout") throw error;
    const pending = await agentGet(name, runner);
    if (!pending || pending.name !== name || pending.agent !== role.kind ||
        pending.workspace_id !== workspace.workspace.workspace_id ||
        pending.pane_id !== workspace.root_pane.pane_id) throw error;
    await saveRun(runsDirectory, recordFor(pending));
    throw new HerdrError("agent_not_ready",
      `CLI startup was not confirmed. Worker ${name} workspace=${pending.workspace_id} pane=${pending.pane_id} is still in Herdr. Check pstack-cli read ${name} and finish any CLI startup prompt there; the first task was not sent.`,
      error.exitCode);
  }
  const base = recordFor(started);
  await saveRun(runsDirectory, base);
  const { agent: settled, unconfirmed } = await promptAndSettle({ started, text: prompt, echo: request.prompt }, runner);
  const record = { ...base, status: settled.agent_status };
  await saveRun(runsDirectory, record);
  return {
    ...record,
    workspace_id: record.workspaceId,
    pane_id: record.paneId,
    terminal_id: record.terminalId,
    output: `${unconfirmed ? "Prompt status unconfirmed. Check read NAME before resuming.\n" : ""}${await agentRead(started.pane_id, 80, runner)}`,
  };
}
