---
name: automate-me
description: "Use for \"automate me\", \"create/update/refresh my -mode skill\", \"turn/capture my preferences or working style into a skill\", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill via create-skill + unslop, optionally pulling fresh evidence from recent session transcripts."
---

# Automate me

A guided flow for turning the user's working conventions into a skill agents will follow. The output is one `-mode` skill tailored to them (e.g. `jay-mode`, `priya-mode`).

This skill orchestrates three others: an inline mining pass (see step 1), `create-skill` (authoring), and `unslop` (prose discipline). It sequences them. It doesn't replace them. Load them with `pstack-cli skill create-skill` and `pstack-cli skill unslop`. If either isn't installed, the fallbacks in steps 4 and 5 apply.

## Flow

### 0. Check for an existing skill

Look recursively for `skills/**/*-mode/SKILL.md` in the Pstack skills directory (`pstack-cli skill <handle>-mode` also resolves it) and in the user's own skill stores: `.claude/skills/`, `~/.claude/skills/`, `.codex/skills/`, `~/.codex/skills/`, `~/.agents/skills/`, plus whatever the running CLI kind uses. Mode skills can live in a personal category directory (`skills/<handle>/`), not only at the top level. If one exists, confirm intent with the user (unless they already said "update my skill" or similar). Ask it as a short numbered choice in plain text; there is no structured question tool in a terminal agent:

1. Update the existing skill (default for repeat runs)
2. Start fresh (rare, ask why before doing it)

Update mode changes the rest of the flow:
- Step 1 mines only history since the skill was last edited (`git log -1 --format=%cI <path>`).
- Step 2 asks what's changed or missing, not what to capture from zero.
- Step 4 edits the existing file in place. Preserve sections the user hasn't contradicted. Revise ones with new evidence. Add new sections only for genuinely new rules.

### 1. Mine their history

Locate the active workspace's session transcripts before fanning out. A CLI agent's history is its own session store, one per agent kind, and you read only the current workspace's part of it:

- Claude Code: `~/.claude/projects/<cwd-slug>/*.jsonl` (slug is the absolute cwd with separators turned into `-`).
- Codex: `~/.codex/sessions/`, filtered by the `cwd` field.
- Other kinds: the CLI's config dir under `~`.

Don't read other projects' sessions. That crosses workspace boundaries and reads private chats from unrelated work. If the user works across several CLIs, mine each store's slice for this workspace.

Survey recent sessions within that scope for recurring patterns. Run parallel Pstack workers across slices of history (e.g. last 2-4 weeks, split into 3 slices so each has enough material):

```bash
pstack-cli delegate --task-id <id> --role "how explorer" --cwd "$PWD" --prompt "Mine these session files for the user's working conventions: <list>. Order by mtime (ls -t). Look for the signals listed below. Return a short structured list of patterns with evidence pointers (session file plus turn). ..."
```

Each worker gets its own sibling pane. Send every slice's `delegate` first, then collect each with `pstack-cli collect <id> --wait <ms>` until it returns a confirmed result. Outside a primary pane, where `delegate` refuses to start,, mine the slices yourself one at a time. Default signals worth hunting:

- Response preferences (length, tone, format, "dumb it down" corrections)
- Delegation habits (workers, models, specialized workflows, parallelism)
- Verification posture (what "done" means, unit tests vs live repro, reviewers)
- Code and prose discipline (style, principles cited, lint/format tools)
- Process conventions (worktrees, commits, PRs, review/merge tooling)
- Meta preferences (fixing skills mid-task, proposing new ones)

Cross-check across slices before elevating a signal. Patterns seen in 2+ slices are high-confidence. Lone signals are weak and usually get dropped.

### 2. Ask the user directly

Mining misses intent that hasn't come up yet. Ask in the terminal as short numbered multiple-choice lists rather than asking the user to type from scratch.

Shape: one or two questions with 4-6 options each, and say they can pick several for category questions. Start broad ("Which areas matter most?"), then follow up on selected areas with specific options. After the structured rounds, one free-form question catches anything the options missed.

Don't dump 20 questions. A one-shot worker with no live human skips this step, says so, and relies on the mined evidence.

### 3. Cluster findings

Group the combined signals into sections. Common ones (use only what applies):

- **Response style**: length, tone, format.
- **Autonomy**: how much to do without asking, tool use.
- **Understand first**: which skills to reach for when scoping or investigating a change.
- **Workers**: default, parallelism, role-to-task, specialized workflows.
- **Prose / code discipline**: principles, lint tools, style guides.
- **Review and verify**: repro posture, verification skills, live-testing tools.
- **Process**: git worktrees, commits, PRs, review/merge tooling.
- **Skills**: skill-authoring habits, fix-the-skill-first, proposing new skills.

The `poteto-mode` skill shows the shape (`pstack-cli skill poteto-mode`, if installed). Read it for granularity. Don't copy its content. The user's rules are not the same as poteto-mode's.

### 4. Draft the skill

Use `create-skill` to author the skill. Placement:

- Path: preserve an existing mode skill's category. For a new mode, use `skills/<handle>/<handle>-mode/SKILL.md` when the skill store has an established personal category for that handle. Otherwise default to `skills/<handle>-mode/SKILL.md` in the Pstack skills directory, or the user's CLI skill store (`~/.claude/skills/`, `~/.codex/skills/`, `~/.agents/skills/`) if they prefer a personal skill their CLI loads on its own.
- Handle: the user's first name or chosen identifier.
- Frontmatter `description`: trigger on their name + `<handle>-mode` + "work in their style", not on generic keywords like "write code" or "review PR".
- Frontmatter formatting: follow `create-skill`'s YAML rules. Keep `description` as one YAML scalar. Quote it or use `description: >-` with indented continuation lines when punctuation or wrapping requires it.
- No `disable-model-invocation` flag: that's a Cursor-only field. A CLI worker loads a skill when told to (`pstack-cli skill NAME` or `--skill NAME`), so the description carries the whole trigger.

If `create-skill` isn't installed, copy the frontmatter and layout of an existing skill under `skills/` and keep the body to the sections from step 3.

### 5. Iterate on prose

Apply `unslop` and `create-skill`'s writing guidelines to every line. Without them: plain spoken English, short sentences, no filler, no em dashes, imperatives addressed to the agent.

Show the draft to the user and take feedback. Expect multiple iterations. Cut ruthlessly. A mode skill is not a manual.

### 6. Land it

Work in a worktree off main. Commit and open a PR. Don't push to main directly.

## Guardrails

- **Don't overfit to one conversation.** A preference stated once and contradicted another time is noise. Require multiple instances before codifying it.
- **Don't be clever.** Restating other skills' contents, inventing metaphors, or writing "poetic" prose for an agent reader is cost without benefit. Keep it operational.
- **Reference, don't inline.** Other skills the user relies on should appear as path references or `pstack-cli skill NAME` calls, not pasted excerpts. Same for any principle docs they maintain elsewhere.
- **Keep sections minimal.** Only add a section if the user has a specific, non-default rule there. "Communicate clearly" is not a section. "Short paragraphs. Tables when comparing options. Bullets only when items are genuinely parallel." is.
- **Name conventions generic.** Use "the user" or "the human" in imperatives, not the author's first name.
- **Don't force symmetry.** If a user has no process rules worth writing down, skip the Process section entirely.

## Evaluation

A `-mode` skill is subjective output. A `create-skill`-style test/iterate benchmark loop isn't useful here. Vibe-check with the user: does it read like them? Did it miss anything? Then ship.

Run a description-optimization loop only if the skill's trigger accuracy turns out to be a problem in practice.

## When not to use

- User wants a task-specific skill (not working conventions): `create-skill` alone, no mining required.
- User wants to capture one narrow workflow (e.g. "how I write commit messages"). That's a regular skill, not a mode skill.

---
Adapted from the `pstack` plugin by Cursor (automate-me). See the root LICENSE for attribution and terms.
