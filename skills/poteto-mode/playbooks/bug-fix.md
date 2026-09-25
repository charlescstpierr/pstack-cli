### Bug fix

**You own this task. Plan, review, verify.** Delegate investigation and the fix to delegates via `pstack-cli delegate`, stay in the lead.

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.

1. Reproduce it yourself on the matching surface. Use the `control-cli` or `control-ui` skill if one is installed for this CLI (`pstack-cli skill control-cli`, `pstack-cli skill control-ui`); otherwise script the surface directly (run the binary, drive the browser with an automation tool). Do this even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the surface cannot be reached from this machine, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form the candidate hypotheses, then rule them out until one survives. Seed them with the **how** skill over the affected subsystem (`pstack-cli skill how`) and the **why** skill for regression history (`pstack-cli skill why`). Each pass, take the split that cuts the most remaining problem space, get runtime evidence, eliminate. When program state is unclear, add instrumentation or logging and read it as the code runs. Don't guess. A long or stubborn hunt runs as an explicit bounded loop you drive yourself: write the hypothesis list to a scratch file, iterate until one survives or the list is empty, and borrow the wake mechanism from the Autonomous run playbook (`pstack-cli playbook autonomous-run`) if the hunt outlives one sitting. There's no built-in loop command; the loop is you. Confirm the surviving *mechanism* with runtime evidence before the step-3 architect/interrogate fan-out.
3. Plan the fix. If it crosses a function boundary, run the **architect** skill first (`pstack-cli skill architect`). Delegate implementation with the `bug-fix` role and a specific scope (file paths, the mechanism to fix, the repro command that must pass):

   ```bash
   pstack-cli delegate --task-id <id> --role "bug-fix" --cwd "<worktree>" --prompt "<brief>" --skill poteto-mode
   ```

   `delegate` fails if the `bug-fix` role has no model configured; set one with `pstack-cli setup --role "bug-fix" --kind <cli> --model <model>` before the first launch. Give the delegate its own git worktree. Read its result with `pstack-cli collect <id>` and review the diff yourself.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Stage the commits so the failing repro lands before the fix in git history. See the **tdd** skill (`pstack-cli skill tdd`) for the failing-test-first cadence when the bug has a cheap local test path. Skip it when the test would be expensive, integration-heavy, or unclear.
   This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
6. Run **Opening a PR** (`pstack-cli playbook opening-a-pr`).

**Reply:** what was broken, root cause, fix, how you verified. Paste failing-then-passing repro output verbatim.
