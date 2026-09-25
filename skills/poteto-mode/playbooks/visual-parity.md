### Visual parity

**You own pixel-exact equivalence. The baseline is the spec. You do not touch it.** Equivalence is verified by image diff, not by eye.

1. Establish the baseline first, before any migration: a visual regression harness that screenshots the current component across its states, plus the target when matching two implementations. Drive the surface through `control-ui` if installed for this CLI, otherwise a browser automation tool scripted from the shell, and diff with an image tool that reports a pixel count (pixelmatch, ImageMagick `compare -metric AE`, or the harness's own). No baseline, no parity claim. A blocking prerequisite, not a follow-up.
2. Anti-shortcut clauses, stated and held: no harness modifications, no baseline tampering, no component restructuring to make a diff pass. If the baseline looks wrong, stop and ask, don't edit it.
3. Migrate one component at a time. Parallelize across worktrees, one owner per component (the **separate-before-serializing-shared-state** principle skill):

   ```bash
   pstack-cli delegate --task-id <id> --role "feature, refactoring" --cwd "<worktree-for-component>" --prompt "<component, baseline path, diff command that must report 0>" --skill poteto-mode
   ```

   Send every owner's `delegate` before collecting any; each gets a sibling pane. Configure the role once with `pstack-cli setup --role "feature, refactoring" --kind <cli> --model <model>`; `pstack-cli tasks` lists the running owners. Shared primitives migrate first as a blocking phase, before any component owner launches.
4. Verify each component against its baseline via image diff on the matching surface. A nonzero diff is a fail. Investigate the pixel delta. Loop per component until the diff is zero: rerun the diff command after each change, and if an owner delegate settles with a nonzero diff, read it with `pstack-cli collect <id>` and relaunch a fresh delegate with the delta described, instead of accepting its summary. There's no built-in loop command; you drive the iteration and stop at zero, never at "close enough".
5. Run **Opening a PR** (`pstack-cli playbook opening-a-pr`) per component or per safe batch.

**Reply:** components migrated, the diff result for each, the baseline harness location, what's left.
