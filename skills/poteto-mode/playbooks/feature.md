### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. Run the **how** skill over the affected subsystem (`pstack-cli skill how`).
2. Run the **architect** skill for parallel design exploration (`pstack-cli skill architect`).
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing with the `feature, refactoring` role and a specific scope:

   ```bash
   pstack-cli run --role "feature, refactoring" --cwd "<worktree>" --prompt "<brief>" --skill poteto-mode
   ```

   The brief names file paths, the data shape and its organizing structure per **principle-model-the-domain** (a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic), and success criteria. `run` refuses an unconfigured role; set it once with `pstack-cli setup --role "feature, refactoring" --kind <cli> --model <model>`. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead (`pstack-cli skill arena`) so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). A delegate forbidden to spawn satisfies this by owning the diff directly with the same review separation. No "standing by" reply that waits on a nested agent; `run` returns when the delegate settles, then you read it with `pstack-cli read <worker>`. Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
5. Verify on the matching surface. Use `control-cli` or `control-ui` if installed, otherwise script the surface directly. "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Rebase into small, ordered commits. Stack follow-ups.
   Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, run the **interrogate** skill before shipping (`pstack-cli skill interrogate`).
8. Run **Opening a PR** (`pstack-cli playbook opening-a-pr`).

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Each parallel delegate gets its own worktree as `--cwd`. Rewrite the checkpoint at phase boundaries. Spawn a fresh delegate with consolidated scope rather than re-prompting an interrupted one.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
