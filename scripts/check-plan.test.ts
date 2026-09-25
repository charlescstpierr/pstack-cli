import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RULE = "Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.";
const LANES = "Ten lanes on the swarm worker role at the PR head";

async function runCheckPlan(path: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(["bun", join(import.meta.dir, "check-plan.ts"), path], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout, stderr };
}

function validPlan(): string {
  const lanes = Array.from({ length: 10 }, (_, index) => `- [ ] Lane ${index + 1}. Run a scenario. Save \`lane-${index + 1}.png\`. Pass when it succeeds.`).join("\n");
  return `# Example plan

## How to read this

One box is one unit of work. It names the evidence. Check a box only when its evidence exists.
Read \`skills/poteto-mode/playbooks/autopilot-full.md\` before work.
${RULE}

## Program checklist

### Arm the program
Keep the goal file current.
### Spawn owners
Assign owners.
### PR mechanics
Run \`git show origin/main:\` before work.
### Verdict and merge
Post a status message.
### Boot recipe
Use a 30-minute audit.

## Deliver the feature (PR-1)

**Depends on.** None.

**Files.**

- [ ] Edit \`src/example.ts\`.

**Build.**

- [ ] Add the behavior.

**You see.**

- [ ] Observe the result.

**Verify, unit.** ${RULE}

- [ ] Run \`bun test\`.

**Verify, live.** ${RULE} ${LANES}

${lanes}

**Verify, perf.** ${RULE}

- [ ] Metric. Record duration.
- [ ] Probe. Run the command.
- [ ] Baseline. Record trunk.
- [ ] Rule. Fail above budget.

**Review gate.** None. PR-1 is not review-gated.

**Merge.**

- [ ] Merge after verification.

## Close the program

- [ ] Report completion.

## Appendix A. Prototype evidence

No prototype was needed.
`;
}

test("checkPlan accepts the required plan structure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-plan-"));
  try {
    const path = join(directory, "valid.md");
    await writeFile(path, validPlan());
    const result = await runCheckPlan(path);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1 PR sections, 0 problems");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);

test("checkPlan rejects a missing required structural token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-plan-"));
  try {
    const path = join(directory, "missing.md");
    await writeFile(path, validPlan().replace("## Program checklist", "## Checklist"));
    const result = await runCheckPlan(path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${path}:1: no "## Program checklist" section`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);
