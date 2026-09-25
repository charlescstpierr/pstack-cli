---
name: show-me-your-work
description: "Keep a reviewable decision trail for long-running or unattended work: a TSV log with one row per decision (what, why, evidence, result). Local by default; commit it when a reviewer needs the trail to trust the result. Use for 'show me your work', autonomous or multi-phase runs, Pstack worker runs, or work a human reviews after stepping away."
---

# Show me your work

Keep one canonical log.

## The format

A single TSV file, one row per decision. Cells stay single-line. Evidence is a pointer, not prose.

Copy `references/decision-log-template.tsv` (the header row) to start a clean log. Columns:

- **ts.** ISO8601 timestamp.
- **phase.** The phase or workstream.
- **decision.** What was chosen or done, one line.
- **why.** The reason in plain words. If a principle drove it, say it plainly, not as a jargon tag.
- **evidence.** A link or path that proves it: commit SHA, PR number, `file:line`, or an artifact, trace, or screenshot path. Never a paragraph.
- **result.** The outcome or predicate state: `tests green`, `reverted`, `pixel-diff 0`, `INCONCLUSIVE`, `open`.

An example, plain-spoken so a reviewer reads it at a glance.

```
ts	phase	decision	why	evidence	result
2026-05-24T09:02:00Z	frame	counted the work first, about 100 components and roughly 75 hours	wanted to know the size before starting a long run	commit 3a9f1c2	found 5 things to sort out before starting
2026-05-24T09:40:00Z	harness	took screenshots of the old version before changing anything	so we can compare old against new and catch any visual change	scripts/snapshot.sh, baseline/	saved 120 reference screenshots
2026-05-24T11:15:00Z	widget	moved the widget styles over without changing how it looks	keep the change small and the result identical	commit 7c21e0a, pixel-diff 0	looks identical, tests pass
2026-05-24T12:30:00Z	widget	threw out a helper's work because its screenshots were blank	checked the real files instead of trusting its summary	worktree reset	reverted, tightened the instructions for next time
```

## Logging a row

Write each entry the way you'd tell a teammate what you did. Plain words, concrete actions, no AI speak or abstract jargon (the `unslop` rules apply to log text too).

Use `bun skills/show-me-your-work/scripts/log.ts <logfile> <phase> <decision> <why> <evidence> <result>` from the pstack-cli checkout. It runs on Windows, macOS and Linux, stamps `ts`, writes the header on first use, strips stray tabs/newlines, and prefixes any cell starting with `=`, `+`, `-`, or `@` with a single quote. A bare append works too, but mind those same bytes if cells come from generated or user-supplied text.

Log decision points and checkpoints, not every action: a fork chosen, a unit completed with its verification result, a pivot or revert with its trigger, a blocker surfaced, a gate fixed. For loop runs, one row per iteration. Skip the trivial and self-evident.

A run is one agent session, including its later turns and any summary of it. A pickup, a replacement agent, a new `pstack-cli delegate` or `pstack-cli run` worker, or a new chat starts a new run. When a run adds to a log that already has rows, its first row has phase `start`, and so does its first row after another run's `start` row. So a run that comes back to a log in a later turn first reads the log's last rows to see whether another run wrote since. A `start` row names the `ts` range of the rows before it that this run did not write, and its evidence names this run. Inside Herdr, that's the agent name plus `$HERDR_PANE_ID` (for example `worker-1 w2:p1`); outside Herdr, the CLI's own session id. Use phase `start` for nothing else.

## Where it lives

By default the log is a working artifact, not committed. Keep it at `decisions.tsv` in the work dir, or `.audit/<task-slug>.tsv` when several efforts run at once, and leave it out of git. When a parent starts several Pstack workers in the same repo, give each its own `.audit/<worker-name>.tsv` in the `--prompt` so they don't interleave rows.

Commit it only when the work is ambitious enough that a reviewer needs the trail to trust the result.

## Rules

- Append-only. A wrong call gets a new row that supersedes it. Never edit or delete history.
- Prefer evidence produced by committed scripts over hand-made one-offs (see `pstack-cli skill principle-encode-lessons-in-structure`).

## Audit the log against the transcript

At the end of the run, before handing back, check the log told the truth. Read this run's transcript. A CLI agent keeps it in its own session store, not in a Cursor project folder; find the one for the CLI you're running as and read only the current session, never another project's:

- Claude Code: `~/.claude/projects/<cwd-slug>/*.jsonl`, newest by mtime.
- Codex: `~/.codex/sessions/`, newest by mtime.
- Other kinds: check the CLI's docs or its config dir under `~`. If there's no readable transcript, the Herdr pane scrollback is the fallback: `herdr agent read <your-name> --source recent-unwrapped --lines 2000` (only when `HERDR_ENV=1`).

Walk this run's rows against what actually happened. Each stretch of them begins at one of this run's `start` rows, or at the first row if this run created the log, and ends at the next `start` row of another run:

- Check that every row maps to a real decision or action.
- Check that each row's evidence resolves and shows what the row claims.
- A fork, pivot, or abandoned approach that shaped the work but isn't logged is a gap. Add it.

Correct the log, not the story. The audit never edits or removes a row, even an invented one. When a row records neither a real decision nor a real action, or its claim or evidence is wrong, add a row that supersedes it with what actually happened and a pointer that resolves. This audit doesn't check rows outside this run's stretches. If this run's own work shows one of them is wrong, supersede it like any wrong call.

## Cross-model review of the trail

Before handing back, start a reviewer on a different model family from the one that did the work. Self-review is not a substitute. Use a Pstack role whose configured kind/model differs from yours (check with `pstack-cli status`; set one with `pstack-cli setup --role "interrogate reviewers" --kind KIND --model MODEL` if needed):

```bash
pstack-cli delegate --task-id <id> --role "interrogate reviewers" --cwd "$PWD" --prompt "Read decisions.tsv and the transcript at <path>. Do not redo the work. Flag: decisions with weak or absent evidence; verification claimed without proof in the transcript; choices that look risky in hindsight (premature, scope-creeping, papering over a symptom); gaps a casual skim would miss. Point each flag at a row or moment. Start your reply with the line 'reviewed by <your model name>'."
```

Read the reviewer's answer with `pstack-cli collect <id> --wait <ms>` once it returns a confirmed result. If you're not in a primary pane and `pstack-cli delegate` can't start a worker, say so in the Attention section instead of faking a review.

Every reply for a run that produced a trail ends with an "Attention" section. Lead with the reviewer's model on its own line (`reviewed by <model>`), then list each flag pointing to specific rows or moments. "No flags" is a valid value. The model name is not.

## Reviewing the trail

Read top to bottom, follow the evidence pointers, spot-check. GitHub renders a committed TSV as a table. `column -s$'\t' -t decisions.tsv` renders it in a terminal.

## Composing this skill

Other skills route their audit trail here instead of inventing one. Reference it by name and let it own the format. Don't restate the columns.

---
Adapted from the `pstack` plugin by Cursor (show-me-your-work). See the root LICENSE for attribution and terms.
