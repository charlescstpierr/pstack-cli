---
name: no-comments
description: "Run Comment Sicko as a separate agent, fix accepted findings, and offer encodings for claimed constraints. Use for 'no-comments', 'kill the comments', or a comment sweep over a diff."
---

# No comments

Run Comment Sicko. Act on accepted findings.

Defer to Comment Sicko's fresh perspective. It runs as its own CLI agent, so its perspective is fresh by construction: it has none of this session's context beyond the scope you pass.

## Scope

Use the caller's files or diff. Otherwise use the current diff against the base branch, default `main`, including the working tree.

## Steps

1. Launch Comment Sicko as a Herdr-backed worker. Its persona and rules live in [`references/comment-sicko.md`](references/comment-sicko.md). Build the prompt from that file verbatim, then append the scope (file list, or the diff command and base branch). Do not restate its rules in your own words.

   ```bash
   pstack-cli run --role "judgment and prose" --cwd "<checkout>" --prompt "$(cat skills/no-comments/references/comment-sicko.md)

   Scope: <files or 'git diff main...HEAD plus the working tree'>. Delete comments in scope, then report."
   pstack-cli read <worker>
   ```

   Comment Sicko writes to the checkout it is given, so run it in a worktree or on a branch you can diff and revert. `run` returns when it settles; if it settles `blocked` on an approval prompt, answer from the scope or restart it with a tighter brief. An unconfigured role fails; run the `setup-pstack` skill first.

2. Inspect its report and diff. Reject application-code edits, scope escapes, exception-protected deletions, misstated `MUST KILL` reasons, and flags that treat kept intentional code as guilty. Reshape flags on our-code surprises stay actionable. Do not restore those comments. A keep survives only with proof it is about something we cannot change. Audit missed scoped lint and TypeScript suppressions. Correctness or safety suppressions stay actionable `MUST KILL`s. Restore deletions only with exact exceptions and scoped proof. Before accepting thin `IMPORTANT` or `do not remove` kills or keeps, run the **how** or **why** skill (`pstack-cli skill how`, `pstack-cli skill why`) on their symbol. If a kill is ambiguous, do not restore. If a keep is refuted or still ambiguous, delete it. Revert and rerun one rejected report with the failure named in the new prompt. Reject a second, report it open, and fail `no-comments`.
3. Fix trivial accepted flags directly by deleting a dead path, dropping a parameter, or using the real API. If any fix needs a shape, run the **architect** skill (`pstack-cli skill architect`) once for the accepted set and surrounding code. Stop at the sketch. Architect shapes. Step 4 implements.
4. Implement the smallest root-cause fix in scope. Remove every named workaround. If the root cause is out of scope, land the smallest in-scope fix and report the rest open. The **principle-fix-root-causes** and **principle-redesign-from-first-principles** skills guide intent only. Neither authorizes widening the fence nor fixing instances outside it. Never bolt on symptom guards.
5. Constraint comments say `do not remove`, `do not change wording`, or `talk to X before changing`. Leave keeps about things we cannot change. Offer the cheapest in-scope type, runtime, test, or CI lint. Wait for interactive approval. Unattended and eval require caller pre-approval. If approved, encode then delete. Otherwise delete, report the constraint open, and sketch out-of-scope work.
6. Report the deletion count, restored comments, reruns, architect sketch, fixes, encoding offers, encodings, unenforced constraints, and other open work.

---
Adapted from the `pstack` plugin by Cursor (no-comments and the Comment Sicko agent). See the root LICENSE for attribution and terms.
