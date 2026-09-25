---
name: reflect
description: Start three parallel review workers over the active session transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
---

# Reflect

Mine the current session for durable learnings, then route them into skill edits.

## When to invoke

Invoke when the user says "reflect". Skip when the session is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent finds its own transcript file before fanning out. A CLI agent's transcript lives in that CLI's session store, not in a Cursor project folder. Look only in the store for the kind you're running as and only for the current workspace:

- Claude Code: `~/.claude/projects/<cwd-slug>/*.jsonl` (slug is the absolute cwd with separators turned into `-`).
- Codex: `~/.codex/sessions/`, filtered by the `cwd` field.
- Other kinds: the CLI's config dir under `~`.

```bash
ls -t <session-dir>/*.jsonl 2>/dev/null | head -10
```

For each candidate, read the first JSONL line and check that it contains this session's opening user prompt. Take the matching path. If no path resolves, write a tight digest of the session and pass that instead. Don't glob across other projects' session directories; that reads private chats from unrelated work.

### 2. Start three reviewers in parallel

Three `pstack-cli delegate` calls, issued back to back before any collect. Each opens a sibling pane in the primary's Herdr workspace, starts the agent kind and model configured for the role, submits the prompt, and returns. Reviewers run in agent mode with their normal tools, because they need to read code and look up context the transcript references (tickets, chat threads, traces) through whatever MCP or CLI access the configured agent kind has.

Each reviewer and the synthesizer map to a Pstack role. Check what's configured with `pstack-cli status`; set a missing one with `pstack-cli setup --role ROLE --kind KIND --model MODEL`. `pstack-cli delegate` never substitutes an unavailable CLI, so a role that isn't configured fails loudly. Configure it, don't guess.

| Lens | Role | Prompt template |
|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `references/divergent-reviewer.md` |

Pass each template verbatim as the prompt, with the transcript path or digest put in place of `<ABSOLUTE_PATH>`. Fill it in an editor or a scratch file, not by shell substitution, so the call works in PowerShell and POSIX shells alike:

```bash
pstack-cli delegate --task-id reflect-judgment --role "reflect judgment, divergent, synthesizer" --cwd "<repo>" --prompt "<filled judgment-reviewer.md>"
pstack-cli delegate --task-id reflect-tooling --role "reflect tooling" --cwd "<repo>" --prompt "<filled tooling-reviewer.md>"
pstack-cli delegate --task-id reflect-divergent --role "reflect judgment, divergent, synthesizer" --cwd "<repo>" --prompt "<filled divergent-reviewer.md>"
```

Paths are relative to this skill's directory. Collect each with `pstack-cli collect <id> --wait <ms>` until it returns a confirmed result. A `blocked` worker is sitting at an approval or question dialog; ask the user before answering it. `unknown` or `mismatch` is not a finding, and neither is a pane transcript read around it. If the reply is too long to return whole, ask the worker to write its findings to a file under the temp dir and reply with only the path.

Outside a primary pane, `pstack-cli delegate` can't start workers. Run the three lenses yourself in sequence, each as a separate pass over the transcript with the template as your instructions, and say in the summary that the passes shared one model.

### 3. Synthesize

Once all three are collected, one more `pstack-cli delegate` on the `reflect judgment, divergent, synthesizer` role. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked (`<JUDGMENT_OUTPUT>`, `<TOOLING_OUTPUT>`, `<DIVERGENT_OUTPUT>`). The synthesizer spot-verifies citations, so it also runs with normal tools. It returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. See `pstack-cli skill principle-encode-lessons-in-structure`.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent that loads them. Don't auto-apply. A one-shot worker with no live human stops here and returns the list.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): load `pstack-cli skill create-skill` and run its draft / test / iterate loop. If it isn't installed, draft the section yourself, keep the target skill's frontmatter valid, and show the diff to the user.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): same `create-skill` route, description-optimization loop.
- `new skill via create-skill: <kebab-name>`: hand creation to `create-skill`. Don't invent the shape ad hoc. Without it, copy the frontmatter and layout of an existing skill under `skills/`.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.

---
Adapted from the `pstack` plugin by Cursor (reflect). See the root LICENSE for attribution and terms.
