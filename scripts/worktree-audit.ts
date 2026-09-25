#!/usr/bin/env bun
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface WorktreeAuditResult { output: string; warnings: string[]; }
interface WorktreeRow { path: string; size: number; age: string; merged: string; dirty: string; remote: string; pr: string; lastChat: string; bucket: string; }

async function git(cwd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { stdout: stdout.trim(), exitCode };
}

async function pathSize(path: string): Promise<number> {
  let total = 0;
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = `${current}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) total += (await stat(child)).size;
    }
  };
  try { await visit(path); } catch { return total; }
  return total;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["K", "M", "G", "T"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}${units[unit]}`;
}

async function recentChat(store: string | undefined, worktree: string): Promise<{ date: string; recent: boolean }> {
  if (!store) return { date: "-", recent: false };
  const matches: number[] = [];
  const terms = [worktree.replaceAll("\\", "/"), worktree.replaceAll("/", "\\")];
  const scan = async (directory: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await scan(path);
      else if (entry.isFile()) {
        try {
          const content = await readFile(path, "utf8");
          if (terms.some((term) => content.includes(`${term}/`) || content.includes(`${term}\"`))) matches.push((await stat(path)).mtimeMs);
        } catch { /* Skip unreadable and non-text session files. */ }
      }
    }
  };
  await scan(store);
  const newest = Math.max(0, ...matches);
  if (!newest) return { date: "-", recent: false };
  return { date: new Date(newest).toISOString().slice(0, 10), recent: Date.now() - newest <= 4 * 86_400_000 };
}

function dirtyCount(porcelain: string): string {
  if (!porcelain) return "clean";
  const lines = porcelain.split("\n").filter(Boolean);
  const tracked = lines.filter((line) => !line.startsWith("??")).length;
  return tracked ? `wip:${tracked}` : `scratch:${lines.length}`;
}

async function pullRequests(repo: string): Promise<Array<{ number: number; state: string; headRefName: string }>> {
  try {
    const child = Bun.spawn(["gh", "pr", "list", "--author", "@me", "--state", "all", "--limit", "1000", "--json", "number,state,headRefName"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return exitCode === 0 ? JSON.parse(output) : [];
  } catch { return []; }
}

/** Audits linked worktrees only. It never invokes a destructive git or filesystem command. */
export async function auditWorktrees(repoArgument?: string, sessionStore = process.env.SESSION_STORE_DIR): Promise<WorktreeAuditResult> {
  const initial = resolve(repoArgument || process.cwd());
  const root = await git(initial, ["rev-parse", "--show-toplevel"]);
  if (root.exitCode !== 0 || !root.stdout) throw new Error("not in a git repo; pass a repo path");
  const repo = root.stdout;
  const listed = await git(repo, ["worktree", "list", "--porcelain"]);
  const worktrees = listed.stdout.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
  const main = worktrees[0];
  const warnings: string[] = [];
  if ((await git(repo, ["fetch", "origin", "main", "--quiet"])).exitCode !== 0) warnings.push("warn: could not fetch origin/main; merged column may be stale");
  const prs = await pullRequests(repo);
  const now = Date.now();
  const rows: WorktreeRow[] = [];
  for (const worktree of worktrees) {
    if (worktree === main) continue;
    const head = await git(worktree, ["rev-parse", "HEAD"]);
    const timestamp = await git(worktree, ["log", "-1", "--format=%ct", "HEAD"]);
    const seconds = Number(timestamp.stdout);
    const age = Number.isFinite(seconds) && seconds > 0 ? `${Math.floor((now / 1000 - seconds) / 86_400)}d` : "?";
    const merged = (await git(repo, ["merge-base", "--is-ancestor", head.stdout, "origin/main"])).exitCode === 0 ? "YES" : "no";
    const dirty = dirtyCount((await git(worktree, ["status", "--porcelain"])).stdout);
    const branch = await git(worktree, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    let remote = "detached";
    if (branch.exitCode === 0 && branch.stdout) {
      if ((await git(worktree, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch.stdout}`])).exitCode === 0) {
        const remoteHead = await git(worktree, ["rev-parse", `origin/${branch.stdout}`]);
        remote = remoteHead.stdout === head.stdout ? "pushed" : `ahead${(await git(worktree, ["rev-list", "--count", `origin/${branch.stdout}..HEAD`])).stdout}`;
      } else remote = "no-remote";
    }
    const matchingPr = branch.stdout ? prs.find((pr) => pr.headRefName === branch.stdout) : undefined;
    const pr = matchingPr ? `#${matchingPr.number}/${matchingPr.state}` : "-";
    const chat = await recentChat(sessionStore, worktree);
    const bucket = dirty.startsWith("wip:") ? "hold-wip" : pr.includes("OPEN") ? "hold-open-pr" : chat.recent ? "verify-recent-chat" : merged === "YES" || pr !== "-" ? "safe" : "review";
    rows.push({ path: worktree, size: await pathSize(worktree), age, merged, dirty, remote, pr, lastChat: chat.date, bucket });
  }
  rows.sort((a, b) => b.size - a.size);
  const lines = ["SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE", ...rows.map((row) => [formatSize(row.size), row.age, row.merged, row.dirty, row.remote, row.pr, row.lastChat, row.bucket, row.path].join("\t"))];
  return { output: lines.join("\n"), warnings };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { console.log("Usage: bun scripts/worktree-audit.ts [repo-path] [session-store-dir]"); return 0; }
  if (argv.length > 2) { console.error("Usage: bun scripts/worktree-audit.ts [repo-path] [session-store-dir]"); return 2; }
  try {
    const result = await auditWorktrees(argv[0], argv[1]);
    for (const warning of result.warnings) console.error(warning);
    console.log(result.output);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
