import { describe, expect, test } from "bun:test";
import { main, type Runner } from "./watch-pr.ts";

const pass = { name: "build", state: "SUCCESS", bucket: "pass" };
const pending = { name: "build", state: "IN_PROGRESS", bucket: "pending" };
const fail = { name: "build", state: "FAILURE", bucket: "fail" };
type WatchEvent = {
  kind: string;
  reason: string;
  rows: Array<{ checks: typeof pass[]; bugbotReviewPasses: number }>;
  merged?: number;
};
function fixture(config: { states?: readonly string[]; checks?: readonly (typeof pass)[]; threads?: readonly object[]; mergeStateStatus?: string; reviewDecision?: string; watch?: () => void } = {}) {
  const calls: string[][] = [], lines: WatchEvent[] = [];
  let state = config.states?.[0] ?? "OPEN", index = 0;
  const gh: Runner = async (args) => {
    calls.push(args);
    let value: unknown;
    if (args[0] === "pr" && args[1] === "view") {
      state = config.states?.[Math.min(index++, config.states.length - 1)] ?? state;
      value = { state, mergedAt: state === "MERGED" ? "2026-01-01T00:00:00Z" : null,
        mergeable: "MERGEABLE", mergeStateStatus: config.mergeStateStatus ?? "CLEAN",
        reviewDecision: config.reviewDecision ?? "APPROVED", isDraft: false };
    } else if (args[0] === "api" && args[1] === "graphql") {
      value = { data: { repository: { pullRequest: { reviewThreads: {
        pageInfo: { hasNextPage: false }, nodes: config.threads ?? [],
      } } } } };
    } else if (args[0] === "pr" && args[1] === "checks" && args.includes("--watch")) {
      config.watch?.();
      return { exitCode: 0, stdout: "", stderr: "" };
    } else if (args[0] === "pr" && args[1] === "checks") {
      const checks = config.checks ?? [pass];
      return { exitCode: checks.some((c) => c.bucket === "fail") ? 1 : checks.some((c) => c.bucket === "pending") ? 8 : 0,
        stdout: JSON.stringify(checks), stderr: "" };
    } else throw new Error(`unexpected gh call ${args.join(" ")}`);
    return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
  };
  const emit = (line: string) => lines.push(JSON.parse(line));
  return { gh, lines, calls, emit };
}
const args = ["12", "--repo", "example/project"];

describe("read-only gh watcher", () => {
  test("READY requires passing CI and clear review and merge gates", async () => {
    const f = fixture();
    expect(await main(args, f.gh, f.emit)).toBe(0);
    expect(f.lines[0].kind).toBe("READY");
    expect(f.lines[0].rows[0].checks).toEqual([pass]);
    expect(f.calls.every((c) => c[0] === "pr" && ["view", "checks"].includes(c[1]) || c[0] === "api" && c[1] === "graphql")).toBe(true);
  });
  test("pending CI waits, and --watch uses gh watch then re-reads", async () => {
    const checks = [pending];
    const f = fixture({ checks, watch: () => checks.splice(0, 1, pass) });
    expect(await main([...args, "--watch"], f.gh, f.emit)).toBe(0);
    expect(f.lines.map((v) => v.kind)).toEqual(["WAITING", "READY"]);
    expect(f.calls.some((c) => c.includes("--watch"))).toBe(true);
  });
  test("failed CI, unresolved review and requested changes block independently", async () => {
    for (const [options, reason] of [
      [{ checks: [fail] }, "failing-checks"],
      [{ threads: [{ id: "t", isResolved: false, comments: { nodes: [{ body: "RUN_ID: A", author: { login: "bugbot" } }] } }] }, "review-threads"],
      [{ reviewDecision: "CHANGES_REQUESTED" }, "merge-gate"],
    ] as const) {
      const f = fixture(options);
      expect(await main(args, f.gh, f.emit)).toBe(2);
      expect(f.lines[0].reason).toBe(reason);
      if (reason === "review-threads") expect(f.lines[0].rows[0].bugbotReviewPasses).toBe(1);
    }
  });
  test("empty and unknown checks fail closed, BLOCKED with green checks does not claim ready", async () => {
    const a = fixture({ checks: [] });
    expect(await main(args, a.gh, a.emit)).toBe(7);
    expect(a.lines[0].reason).toBe("status-query");
    const b = fixture({ mergeStateStatus: "BLOCKED" });
    expect(await main(args, b.gh, b.emit)).toBe(2);
    expect(b.lines[0].reason).toBe("github-blocked");
    const c = fixture({ checks: [{ name: "build", state: "MYSTERY", bucket: "mystery" }] });
    expect(await main(args, c.gh, c.emit)).toBe(2);
    expect(c.lines[0].reason).toBe("unknown-check-state");
    const gate = fixture({ checks: [pass, { name: "Code Review Gate", state: "PENDING", bucket: "pending" }], mergeStateStatus: "BLOCKED" });
    expect(await main(args, gate.gh, gate.emit)).toBe(0);
    expect(gate.lines[0].reason).toBe("owner-approval");
  });
  test("queued WAITING, ADVANCE, COMPLETE retain frozen list", async () => {
    const waiting = fixture();
    expect(await main([...args, "--queued-stack", "--stack-prs", "12"], waiting.gh, waiting.emit)).toBe(0);
    expect(waiting.lines[0].reason).toBe("merge-queue");
    // The first snapshot waits for CI; the next read observes an external merge.
    const checks = [pending];
    const f = fixture({ checks, watch: () => checks.splice(0, 1, pass) });
    let reads = 0;
    const gh: Runner = (argv, timeout) => {
      if (argv[0] === "pr" && argv[1] === "view" && argv[2] === "12" && ++reads > 1)
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify({ state: "MERGED", mergedAt: "2026-01-01T00:00:00Z", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", reviewDecision: "APPROVED", isDraft: false }), stderr: "" });
      return f.gh(argv, timeout);
    };
    expect(await main([...args, "--queued-stack", "--stack-prs", "12,13", "--watch"], gh, f.emit)).toBe(0);
    expect(f.lines.map((v) => v.kind)).toEqual(["WAITING", "ADVANCE", "WAITING"]);
    expect(f.lines[1].merged).toBe(12);
    const done = fixture({ states: ["MERGED"] });
    expect(await main([...args, "--queued-stack", "--stack-prs", "12,13"], done.gh, done.emit)).toBe(0);
    expect(done.lines[0].kind).toBe("COMPLETE");
  });
  test("URL selects repo and PR without a cwd", async () => {
    const f = fixture();
    expect(await main(["https://github.com/example/project/pull/12"], f.gh, f.emit)).toBe(0);
    expect(f.calls[0]).toContain("example/project");
  });
});
