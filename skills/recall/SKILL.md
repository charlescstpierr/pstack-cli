---
name: recall
description: "Reconstruct your recent working context from your own session history, live state, and the shared record (user reports, prior fixes, incidents), then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what have I been working on', 'where did I leave off', before starting or resuming work."
---

# Recall

**Before you start or resume work, you rebuild the user's recent working context and hand back a tight capsule of where things stand now and what to do next.**

Keep it tight and on-topic. Read only what the in-scope threads need, then stop.

Your context lives in two records. Your own session history holds what you did and decided. The shared record holds everything that happened around the same code under other names: the symptoms users keep reporting, the fixes that shipped and got reverted, the errors still firing in prod. That second record is what the `why` skill searches, across source control, the issue tracker, chat and issue channels, long-form docs, and error tracking. A feature with a long bug tail keeps most of its story there, so don't reconstruct it from your transcripts alone.

## Where transcripts live

A CLI agent's history is its own session store, one per agent kind. Read only the current workspace's sessions:

- Claude Code: `~/.claude/projects/<cwd-slug>/*.jsonl`, one JSON message per line. The slug is the absolute cwd with path separators turned into `-`.
- Codex: `~/.codex/sessions/` (JSONL, newest by mtime; filter by the `cwd` field).
- Other kinds (opencode, pi): check the CLI's config dir under `~` for its session files.

Order candidates by real modification time (`ls -t`), never by file name. Herdr pane scrollback (`herdr agent read <name> --lines 2000`, only inside Herdr) covers agents still on screen, but it's a fallback, not the archive.

## Steps

1. Classify, then route. One specific prior session to resume is the `session-pickup` playbook (`pstack-cli playbook session-pickup`), not this. Turning habits into a durable skill is `automate-me`. A human-readable summary of your work is a different task. Recall loads working context across recent sessions before you act. If the user already gave you a full state capsule (paths, branch, the change), use it and skip the mining.
2. Lock the scope before searching. Pin the window ("recent" is a real range, default the last 7 days), the topic if named, and the workspace (default the active one. Never read another project's sessions without being asked). State the scope back. Never quietly turn "all" into "recent N".
3. Fan out across your session history. Start parallel Pstack workers on a fast, cheap role, each taking a slice of the corpus:

   ```bash
   pstack-cli delegate --task-id <id> --role "how explorer" --cwd "$PWD" --prompt "Mine these session files for work on <topic>: <list>. Order by mtime (ls -t), never by name. Grep the topic first, read only matching sessions and only their relevant regions. Skip the current session and obvious noise (worker, eval, test sessions). Return one block per session: topic, the user's goal, decisions, open threads, struggles and corrections, artifacts (PRs, tickets, branches). Cite each by session file name."
   ```

   Each worker gets its own sibling pane. Send every slice first, then collect each with `pstack-cli collect <id> --wait <ms>` until it returns a confirmed result. For one or two sessions, skip the fan-out and search directly. The raw transcripts stay in the workers. The main thread gets only their findings. Outside a primary pane, where `delegate` refuses to start,, mine the slices yourself, one at a time.
4. Sweep the shared record whenever the topic names a feature, file, subsystem, area, or bug. This is the default, not a judgment call, and "my work on X" doesn't exempt it. Hand it to the `why` skill's source investigators (`pstack-cli delegate --task-id <id> --role "why investigators" --skill why ...`), but steer their question from "why was this built this way" to "what's the current state, what's been tried and didn't hold, and what are users still reporting". Reuse its per-source playbooks, run the investigators in parallel with the session mining, and inherit its posture: one investigator per source, null results are findings, skip an unavailable source and say so. If `why` isn't installed, run `git log`, `gh pr list`, and `gh issue list` yourself for the source-control slice and say which sources you couldn't reach. Fold what comes back into the brief. Skip this step only for pure activity recall with no named target ("what did I do this week"), where your own history and live state are the entire answer.
5. Verify against live state. Take the PRs, branches, and tickets that the mining and the sweep surfaced and check them with `git` and `gh`. When the answer hinges on what an agent actually did (the tools it ran, files it read, errors it hit), read the full session file, not just a trimmed summary.
6. Write the brief to the contract below. Group by thread. Stay on the named topic.

## Output contract

Lead with the capsule, then the thread status, then the problems, then the next move. Deeper detail goes below or gets cut.

- **Capsule.** At most 5 bullets. What this work is and where it stands overall.
- **Threads.** One line each, prefixed with exactly one status tag: `[merged #N]`, `[open PR #N]`, `[in flight <branch>]`, `[verified, uncommitted]`, `[reverted #N]`, or `[planned, not started]`. A thread with no tag isn't done yet, so tag it.
- **Problems.** At most 5, the recurring ones. Include the symptoms users keep reporting and any fix that shipped and was reverted, so the next attempt starts where the last one failed.
- **Next move.** The single most useful next action, concrete.

An adjacent feature or ticket stays out unless it blocks this one. When the capsule and thread lines outgrow a screen, cut detail before you cut threads. Write the brief in plain spoken English (apply `unslop` if installed), cite session findings by session file name and shared-record findings by their source (PR #, ticket ID, chat permalink, error-tracker issue), and sanitize private context before any public output.

**Reply:** the brief, to the contract above.

---
Adapted from the `pstack` plugin by Cursor (recall). See the root LICENSE for attribution and terms.
