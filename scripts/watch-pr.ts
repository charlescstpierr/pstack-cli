/** Read-only PR watcher: all external I/O is through the gh argument vector. */
export type Result = { exitCode: number; stdout: string; stderr: string };
export type Runner = (args: string[], timeoutMs?: number) => Promise<Result>;
export const runGh: Runner = async (args, timeoutMs) => {
  const child = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => child.kill(), timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exitCode };
  } finally { if (timer !== undefined) clearTimeout(timer); }
};
type Row = { pr: number; state: string; mergedAt: string | null; mergeable: string; mergeStateStatus: string;
  reviewDecision: string; isDraft: boolean; checks: { name: string; state: string; bucket: string }[];
  threads: { id: string; author: string | null; body: string; bugbot: boolean }[]; bugbotReviewPasses: number };
type Verdict = { kind: "READY" | "WAITING" | "ADVANCE" | "COMPLETE" | "BLOCKER"; terminal: boolean;
  frontier: number | null; reason: string; rows: Row[]; merged?: number };
const help = `Usage: bun scripts/watch-pr.ts <PR URL | number> [--repo OWNER/REPO] [--status-only | --watch] [--queued-stack --stack-prs N,N] [--timeout SECONDS]
Default: one JSON snapshot. --watch waits for pending checks using gh pr checks --watch.
Queued mode uses a frozen bottom-to-top list and returns WAITING when the merge queue is idle.
The watcher is read-only; rearm it after a merge event. Timeout defaults to 600 seconds.`;
function parse(args: string[]) {
  let repo = "", pr = "", stack = "", watch = false, statusOnly = false, queued = false, timeout = 600;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["--repo", "--pr", "--stack-prs", "--timeout"].includes(a)) {
      const v = args[++i]; if (!v) throw new Error(`${a} requires a value`);
      if (a === "--repo") repo = v;
      if (a === "--pr") pr = v;
      if (a === "--stack-prs") stack = v;
      if (a === "--timeout") timeout = Number(v);
    } else if (a === "--watch") watch = true;
    else if (a === "--queued-stack") queued = true;
    else if (a === "--status-only") statusOnly = true;
    else if (!a.startsWith("-") && !pr) pr = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  const url = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)\/?$/.exec(pr);
  if (url) { if (repo && repo !== `${url[1]}/${url[2]}`) throw new Error("PR URL and --repo disagree"); repo = `${url[1]}/${url[2]}`; pr = url[3]; }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("specify --repo OWNER/REPO or PR URL");
  if (stack && !queued) throw new Error("--stack-prs requires --queued-stack");
  if (watch && statusOnly) throw new Error("--watch and --status-only conflict");
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout must be positive");
  const values = stack ? stack.split(",") : [pr];
  if (values.some((v) => !/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v))) || new Set(values).size !== values.length)
    throw new Error("specify distinct positive PR numbers");
  if (stack && pr && !values.includes(pr)) throw new Error("PR not in stack");
  return { repo, numbers: values.map(Number), watch, queued, timeout };
}
function obj(v: unknown, label: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`invalid ${label}`);
  return v;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
async function json(gh: Runner, args: string[]): Promise<unknown> {
  const r = await gh(args);
  if (r.exitCode !== 0) throw new Error(`gh ${args[0]} failed (${r.exitCode}): ${r.stderr.trim()}`);
  try { return JSON.parse(r.stdout); } catch { throw new Error(`invalid gh ${args[0]} JSON`); }
}
const query = `query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved comments(first:1){nodes{body author{login}}}}}}}}`;
async function snapshot(gh: Runner, repo: string, number: number): Promise<Row> {
  const raw = obj(await json(gh, ["pr", "view", String(number), "--repo", repo, "--json", "state,mergedAt,mergeable,mergeStateStatus,reviewDecision,isDraft"]), "PR");
  if (typeof raw.state !== "string" || typeof raw.mergeable !== "string" ||
      typeof raw.mergeStateStatus !== "string") throw new Error("invalid PR state");
  if (typeof raw.isDraft !== "boolean" || (raw.mergedAt !== null && typeof raw.mergedAt !== "string")) throw new Error("invalid PR merge state");
  const row: Row = { pr: number, state: raw.state, mergedAt: raw.mergedAt, mergeable: raw.mergeable,
    mergeStateStatus: raw.mergeStateStatus, reviewDecision: typeof raw.reviewDecision === "string" ? raw.reviewDecision : "",
    isDraft: raw.isDraft,
    checks: [], threads: [], bugbotReviewPasses: 0 };
  if (row.state !== "OPEN" || row.mergedAt) return row;
  const [owner, name] = repo.split("/");
  const graph = obj(await json(gh, ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `repo=${name}`, "-F", `pr=${number}`]), "GraphQL");
  const threads = obj(obj(obj(obj(graph.data, "data").repository, "repository").pullRequest, "pullRequest").reviewThreads, "reviewThreads");
  const pageInfo = obj(threads.pageInfo, "page info");
  if (pageInfo.hasNextPage !== false || !Array.isArray(threads.nodes)) throw new Error("incomplete review threads");
  const passes = new Set<string>();
  for (const value of threads.nodes) {
    const t = obj(value, "thread");
    const comments = obj(t.comments, "thread comments");
    if (typeof t.id !== "string" || typeof t.isResolved !== "boolean" || !Array.isArray(comments.nodes)) throw new Error("invalid thread");
    const first = comments.nodes[0];
    const comment = first === undefined ? undefined : obj(first, "comment");
    const authorValue = comment?.author === null || comment?.author === undefined ? null : obj(comment.author, "author").login;
    const author = authorValue ?? null;
    const body = comment?.body ?? "";
    if ((author !== null && typeof author !== "string") || typeof body !== "string") throw new Error("invalid comment");
    const bugbot = /bugbot/i.test(author ?? "") || (author === "cursor" && /bugbot|cursor_automation_id|agentic security review/i.test(body));
    if (bugbot) passes.add(body.match(/(?:RUN_ID|CURSOR_AUTOMATION_ID):\s*([\w.:-]+)/)?.[1] ?? "keyless");
    if (!t.isResolved) row.threads.push({ id: t.id, author, body, bugbot });
  }
  row.bugbotReviewPasses = passes.size;
  const r = await gh(["pr", "checks", String(number), "--repo", repo, "--json", "name,state,bucket"]);
  if (![0, 1, 8].includes(r.exitCode)) throw new Error(`gh pr checks failed (${r.exitCode}): ${r.stderr.trim()}`);
  let checks: unknown;
  try { checks = JSON.parse(r.stdout); } catch { throw new Error("invalid checks JSON"); }
  if (!Array.isArray(checks) || !checks.length) throw new Error("checks unavailable");
  row.checks = checks.map((v) => {
    const c = obj(v, "check");
    if (typeof c.name !== "string" || typeof c.state !== "string" || typeof c.bucket !== "string") throw new Error("invalid check");
    return { name: c.name, state: c.state, bucket: c.bucket };
  });
  return row;
}
function classify(rows: Row[], queued: boolean, previous: number | null): Verdict {
  const active = rows.filter((r) => r.state !== "MERGED" && !r.mergedAt);
  if (!active.length) return { kind: queued ? "COMPLETE" : "READY", terminal: true, frontier: null, reason: "merged", rows };
  const frontier = active[0].pr;
  for (const row of active) {
    let reason = "";
    if (row.state !== "OPEN") reason = "closed-without-merge";
    else if (row.mergeable === "CONFLICTING" || ["DIRTY", "CONFLICTING"].includes(row.mergeStateStatus)) reason = "merge-conflicts";
    else if (row.threads.length) reason = "review-threads";
    else if (row.checks.some((c) => ["fail", "cancel"].includes(c.bucket) || ["FAILURE", "ERROR", "ACTION_REQUIRED"].includes(c.state.toUpperCase()))) reason = "failing-checks";
    else if (row.isDraft || row.reviewDecision === "CHANGES_REQUESTED") reason = "merge-gate";
    else if (row.mergeStateStatus === "BLOCKED" && !row.checks.some((c) => c.bucket === "pending" || c.name === "Code Review Gate")) reason = "github-blocked";
    else if (row.checks.some((c) => !["pass", "pending", "skipping"].includes(c.bucket))) reason = "unknown-check-state";
    if (reason) return { kind: "BLOCKER", terminal: true, frontier: row.pr, reason, rows };
  }
  const pending = active.find((r) => r.checks.some((c) => c.bucket === "pending" && c.name !== "Code Review Gate"));
  if (pending) return { kind: "WAITING", terminal: false, frontier: pending.pr, reason: "pending-checks", rows };
  if (active.some((r) => r.checks.some((c) => c.name === "Code Review Gate" && c.bucket === "pending")))
    return { kind: "WAITING", terminal: false, frontier, reason: "owner-approval", rows };
  if (active.some((r) => r.mergeable !== "MERGEABLE" || ["UNKNOWN", "BEHIND", "UNSTABLE", "DRAFT"].includes(r.mergeStateStatus)))
    return { kind: "WAITING", terminal: false, frontier, reason: "mergeability-unknown", rows };
  if (queued && previous !== null && previous !== frontier)
    return { kind: "ADVANCE", terminal: false, frontier, merged: previous, reason: "frontier-merged", rows };
  return { kind: queued ? "WAITING" : "READY", terminal: !queued, frontier, reason: queued ? "merge-queue" : "merge-ready", rows };
}
export async function main(args: string[], gh: Runner = runGh, emit: (line: string) => void = console.log): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) { emit(help); return 0; }
  let options: ReturnType<typeof parse>;
  try { options = parse(args); } catch (error) { console.error(String(error)); return 64; }
  const deadline = Date.now() + options.timeout * 1000;
  let previous: number | null = null;
  try {
    const bounded: Runner = async (argv, limit) => {
      const remaining = Math.min(limit ?? Infinity, deadline - Date.now());
      if (remaining <= 0) throw new Error("watch timeout");
      const result = await gh(argv, remaining);
      if (Date.now() >= deadline && result.exitCode !== 0) throw new Error("watch timeout");
      return result;
    };
    while (true) {
      const rows: Row[] = [];
      for (const number of options.numbers) rows.push(await snapshot(bounded, options.repo, number));
      const verdict = classify(rows, options.queued, previous);
      emit(JSON.stringify(verdict));
      if (verdict.kind === "ADVANCE") { previous = verdict.frontier; if (!options.watch) return 0; continue; }
      previous = verdict.frontier;
      if (!options.watch || verdict.terminal || verdict.reason !== "pending-checks") return verdict.kind === "BLOCKER" ? 2 : 0;
      const remaining = deadline - Date.now();
      if (remaining <= 0) { emit(JSON.stringify({ kind: "WAITING", terminal: true, reason: "timeout", frontier: verdict.frontier, rows })); return 5; }
      const r = await bounded(["pr", "checks", String(verdict.frontier), "--repo", options.repo, "--watch", "--interval", "10"], remaining);
      if (![0, 1].includes(r.exitCode)) {
        if (Date.now() >= deadline) { emit(JSON.stringify({ kind: "WAITING", terminal: true, reason: "timeout", frontier: verdict.frontier, rows })); return 5; }
        throw new Error(`gh pr checks --watch failed (${r.exitCode}): ${r.stderr.trim()}`);
      }
    }
  } catch (error) {
    emit(JSON.stringify({ kind: "BLOCKER", terminal: true, frontier: previous, reason: "status-query", error: String(error) }));
    return 7;
  }
}
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
