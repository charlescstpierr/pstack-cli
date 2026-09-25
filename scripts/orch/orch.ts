#!/usr/bin/env bun
// Local, single-writer bookkeeping. This script never starts or resumes agents.
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const help = `Usage: bun scripts/orch/orch.ts --store <dir> <command> [arguments]
Commands:
  init
  unit add <id> --track <track> [--brief <path>]
  unit set <id> --state <state> [--branch <name>] [--pr <number>] [--sha <sha>] [--worker <name>] [--worktree <path>]
  unit list [--state <state>] [--track <track>]
  ledger record <pr> <sha> <verdict> --evidence <path> [--verifier <name>]
  ledger check <pr> <sha>
  inbox push <agent> <unit> <status> [--report <path>]
  inbox drain
  gate park <id> --question <text> --options <text> --default <text>
  gate list
  gate resolve <id> --answer <text>
  status
Options: --store <dir> (or ORCH_STORE), --help
Output: JSON on stdout; errors on stderr. ledger check exits 2 when absent.
`;
const unitFields = ["id", "track", "state", "branch", "pr", "sha", "brief", "worker", "worktree"] as const;
const ledgerFields = ["pr", "sha", "verdict", "evidence", "verifier", "ts"] as const;
type Unit = Record<(typeof unitFields)[number], string>;
type Receipt = Record<(typeof ledgerFields)[number], string>;
type Gate = { id: string; question: string; options: string; default: string; answer?: string };
type Pointer = { agent: string; unit: string; status: string; report: string; ts: string };
const verdicts = new Set(["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"]);

function cell(value: string): string {
  if (/[\t\r\n]/.test(value)) throw new Error("fields must be single-line values");
  return value;
}
function flag(args: string[], allowed: string[]): { positional: string[]; options: Record<string, string> } {
  const positional: string[] = [], options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (!allowed.includes(name) || name in options || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error(`invalid option ${arg}`);
      options[name] = cell(args[++i]!);
      if (!options[name]) throw new Error(`empty option ${arg}`);
    } else { if (!arg) throw new Error("empty argument"); positional.push(cell(arg)); }
  }
  return { positional, options };
}
function shape(args: string[], expected: number, required: string[], allowed: string[] = required) {
  const parsed = flag(args, allowed);
  if (parsed.positional.length !== expected || required.some(k => !(k in parsed.options))) throw new Error("invalid arguments; run --help");
  return parsed;
}
function number(value: string): string {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("PR must be a positive integer");
  return value;
}
async function atomic(path: string, data: string) {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try { await writeFile(temp, data, { flag: "wx" }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
async function tsv<T extends string>(path: string, fields: readonly T[]): Promise<Record<T, string>[]> {
  const lines = (await readFile(path, "utf8")).replace(/\n$/, "").split("\n");
  if (lines.shift() !== fields.join("\t")) throw new Error(`invalid header: ${path}`);
  return lines.filter(Boolean).map(line => {
    const values = line.replace(/\r$/, "").split("\t");
    if (values.length !== fields.length) throw new Error(`invalid row: ${path}`);
    return Object.fromEntries(fields.map((field, i) => [field, values[i]])) as Record<T, string>;
  });
}
async function saveTsv<T extends string>(path: string, fields: readonly T[], rows: Record<T, string>[]) {
  await atomic(path, fields.join("\t") + "\n" + rows.map(row => fields.map(f => cell(row[f])).join("\t")).join("\n") + (rows.length ? "\n" : ""));
}
async function json<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }
async function saveJson(path: string, data: unknown) { await atomic(path, JSON.stringify(data, null, 2) + "\n"); }
async function initialize(store: string) {
  await mkdir(join(store, "inbox", "drained"), { recursive: true });
  for (const [name, text] of [["units.tsv", unitFields.join("\t") + "\n"], ["ledger.tsv", ledgerFields.join("\t") + "\n"], ["gates.json", "[]\n"]]) {
    try { await writeFile(join(store, name), text, { flag: "wx" }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
}
async function lock(store: string): Promise<() => Promise<void>> {
  await mkdir(store, { recursive: true });
  const path = join(store, ".orch.lock");
  const token = `${process.pid}:${randomUUID()}`;
  const take = async () => { const handle = await open(path, "wx"); try { await handle.writeFile(token); } finally { await handle.close(); } };
  try { await take(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const holder = await readFile(path, "utf8").catch(() => "");
    const pid = Number(holder.split(":")[0]);
    let dead = false;
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); }
      catch (error) { dead = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    }
    if (!dead) throw new Error(`store locked by ${holder || "unknown writer"}`);
    // Rename the stale inode, never unlink a newly acquired writer's lock.
    const stale = join(store, `.orch.stale.${randomUUID()}`);
    await rename(path, stale);
    try { await take(); } finally { await rm(stale, { force: true }); }
  }
  return async () => {
    if (await readFile(path, "utf8").catch(() => "") === token) await rm(path);
  };
}
function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}
async function execute(store: string, command: string[], args: string[]): Promise<unknown> {
  const unitsPath = join(store, "units.tsv"), ledgerPath = join(store, "ledger.tsv"), gatesPath = join(store, "gates.json");
  const name = command.join(" ");
  if (name === "init") { shape(args, 0, []); await initialize(store); return { store }; }
  if (name === "unit add") {
    const { positional: [id], options: o } = shape(args, 1, ["track"], ["track", "brief"]);
    const rows = await tsv(unitsPath, unitFields);
    if (rows.some(u => u.id === id)) throw new Error(`unit already exists: ${id}`);
    const row: Unit = { id: id!, track: o.track!, state: "pending", branch: "", pr: "", sha: "", brief: o.brief ?? "", worker: "", worktree: "" };
    rows.push(row); await saveTsv(unitsPath, unitFields, rows); return row;
  }
  if (name === "unit set") {
    const { positional: [id], options: o } = shape(args, 1, ["state"], ["state", "branch", "pr", "sha", "worker", "worktree"]);
    const rows = await tsv(unitsPath, unitFields), row = rows.find(u => u.id === id);
    if (!row) throw new Error(`unknown unit: ${id}`);
    if (o.pr) number(o.pr);
    Object.assign(row, o); await saveTsv(unitsPath, unitFields, rows); return row;
  }
  if (name === "unit list") {
    const { options: o } = shape(args, 0, [], ["state", "track"]);
    return (await tsv(unitsPath, unitFields)).filter(u => (!o.state || u.state === o.state) && (!o.track || u.track === o.track));
  }
  if (name === "ledger record") {
    const { positional: [pr, sha, verdict], options: o } = shape(args, 3, ["evidence"], ["evidence", "verifier"]);
    number(pr!); if (!verdicts.has(verdict!)) throw new Error(`invalid verdict: ${verdict}`);
    const rows = await tsv(ledgerPath, ledgerFields);
    const receipt: Receipt = { pr: pr!, sha: sha!, verdict: verdict!, evidence: o.evidence!, verifier: o.verifier ?? "", ts: new Date().toISOString() };
    rows.push(receipt); await saveTsv(ledgerPath, ledgerFields, rows); return receipt;
  }
  if (name === "ledger check") {
    const { positional: [pr, sha] } = shape(args, 2, []); number(pr!);
    const row = (await tsv(ledgerPath, ledgerFields)).filter(r => r.pr === pr && r.sha === sha).at(-1);
    if (!row) { console.log(JSON.stringify({ found: false, pr, sha })); process.exitCode = 2; return undefined; }
    return row;
  }
  if (name === "inbox push") {
    const { positional: [agent, unit, status], options: o } = shape(args, 3, [], ["report"]);
    const pointer: Pointer = { agent: agent!, unit: unit!, status: status!, report: o.report ?? "", ts: new Date().toISOString() };
    await atomic(join(store, "inbox", `${Date.now()}-${randomUUID()}.json`), JSON.stringify(pointer) + "\n"); return pointer;
  }
  if (name === "inbox drain") {
    shape(args, 0, []);
    const names = (await readdir(join(store, "inbox"))).filter(n => n.endsWith(".json")).sort();
    const rows: Pointer[] = [];
    for (const name of names) {
      const from = join(store, "inbox", name);
      const row = await json<Pointer>(from);
      await rename(from, join(store, "inbox", "drained", name));
      rows.push(row);
    }
    return rows;
  }
  if (name === "gate park") {
    const { positional: [id], options: o } = shape(args, 1, ["question", "options", "default"]);
    const rows = await json<Gate[]>(gatesPath);
    if (rows.some(g => g.id === id)) throw new Error(`gate already exists: ${id}`);
    const row = { id: id!, question: o.question!, options: o.options!, default: o.default! };
    rows.push(row); await saveJson(gatesPath, rows); return row;
  }
  if (name === "gate list") { shape(args, 0, []); return (await json<Gate[]>(gatesPath)).filter(g => !g.answer); }
  if (name === "gate resolve") {
    const { positional: [id], options: o } = shape(args, 1, ["answer"]);
    const rows = await json<Gate[]>(gatesPath), row = rows.find(g => g.id === id && !g.answer);
    if (!row) throw new Error(`unknown open gate: ${id}`);
    row.answer = o.answer; await saveJson(gatesPath, rows); return row;
  }
  if (name === "status") {
    shape(args, 0, []);
    const units = await tsv(unitsPath, unitFields), ledger = await tsv(ledgerPath, ledgerFields), gates = await json<Gate[]>(gatesPath);
    const pendingInbox = (await readdir(join(store, "inbox"))).filter(n => n.endsWith(".json")).length;
    return { units, ledger, gates, summary: { unitStates: counts(units.map(u => u.state)), ledgerVerdicts: counts(ledger.map(r => r.verdict)), openGates: gates.filter(g => !g.answer).map(g => g.id), pendingInbox } };
  }
  throw new Error(`unknown command: ${name || "(none)"}; run --help`);
}

export async function main(argv: string[]): Promise<number> {
  try {
    if (argv.includes("--help") || argv.includes("-h")) { console.log(help); return 0; }
    const args = [...argv]; let store = process.env.ORCH_STORE;
    const index = args.indexOf("--store");
    if (index !== -1) { if (!args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error("--store needs a directory"); store = args[index + 1]; args.splice(index, 2); }
    if (!store) throw new Error("set --store <dir> or ORCH_STORE");
    const command = args[0] === "unit" || args[0] === "ledger" || args[0] === "inbox" || args[0] === "gate" ? args.splice(0, 2) : args.splice(0, 1);
    const dir = resolve(store), release = await lock(dir);
    try {
      const result = await execute(dir, command, args);
      if (result !== undefined) console.log(JSON.stringify(result, null, 2));
      return Number(process.exitCode || 0);
    } finally { await release(); }
  } catch (error) { console.error(`orch: ${(error as Error).message}`); return 1; }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
