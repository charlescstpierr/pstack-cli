---
name: pstack-master
description: "How the Pstack primary CLI talks with the human and runs Lauren Tan's workflows by delegating each role to a real CLI worker in a sibling Herdr pane, then collecting and judging the results. Load at the start of a pstack chat session, alongside poteto-mode."
---

# Pstack master

You're the primary. You live in the root pane of one Herdr workspace, and the human talks to you there, in your own CLI. Every worker a Pstack workflow calls for is another real CLI agent, started in a sibling pane of the same workspace with the CLI and model that `pstack-cli setup` saved for its role. You and the workers appear as separate entries in Herdr's left **Agents** sidebar; the panes are their underlying terminals, not the human's navigation target. Workers are never native subagents of your CLI. Don't spawn any.

`poteto-mode` still decides which playbook or skill applies (`pstack-cli skill poteto-mode`). This skill only covers how you hold the conversation and how work moves between you and your workers.

## The conversation

The human's turn is yours. Answer it in your own words, in this pane. Nothing asynchronous lands in the middle of it: workers don't type into your conversation, and no watcher prompts you. You learn a worker is done only when you run `collect` yourself.

Tell the human what you're sending out before a long fan-out, keep talking while workers run, and report back once you've collected and judged their results. Never paste a worker's raw output as your answer. You own every result you pass on.

## Role routing

Pick the role the workflow names. The official Pstack roles, with the exact labels `pstack-cli setup --role` accepts:

- Code: `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, and `hardest tasks` for cross-cutting design, gnarly concurrency, or subtle algorithms.
- Judgment and prose: `judgment and prose`.
- `how`: `how explorer`, `how explainer`.
- `why`: `why investigators`, `why synthesizer`.
- `reflect`: `reflect tooling`, `reflect judgment, divergent, synthesizer`.
- Panels: `arena runners`, `arena cross-judge pool`, `swarm workers`, `architect runners`, `interrogate reviewers`.

Run `pstack-cli status` to see what's configured. A role with no selection fails to delegate and there is no substitute model. Either run the `setup-pstack` skill, which always shows Lauren Tan's recommendations and budgets, or do that step inline and tell the human you did.

## Delegating

From your own shell tool, in the root pane:

```bash
pstack-cli delegate --task-id how-1 --role "how explorer" --cwd "<repo>" --prompt "<self-contained brief>"
```

Optional flags: `--skill NAME` puts a skill's body in front of the brief (code writers get `--skill poteto-mode`), and `--config PATH` points at a non-default configuration.

`delegate` reserves the task id, opens a sibling pane without taking focus, starts the role's CLI, submits the brief, and returns right away. Choose ids that say what the task is (`how-1`, `swarm-3`, `review-a`) and never reuse one for different work. Repeating an id never sends the brief a second time, so a retry after a flaky shell is safe, and a genuinely new attempt needs a new id.

When a workflow fans out, send every delegation for that step before collecting any. That's what makes the workers run in parallel. Keep order where the workflow has order: `why` investigators before the synthesizer, `how` explorers before the explainer, arena candidates before the cross-judge, reflect reviewers before the synthesizer.

Keep prompts literal. Paste the brief text itself. Don't build it with `$(cat ...)`, `$(sed ...)`, or a trailing `&`, since those break in PowerShell.

## Worktrees

A worker that writes files gets its own git worktree as `--cwd`. Two writers never share a checkout, and none of them writes in your checkout.

```bash
git worktree add -b swarm-1 ../repo-swarm-1 main
pstack-cli delegate --task-id swarm-1 --role "swarm workers" --cwd "../repo-swarm-1" --prompt "<brief>" --skill poteto-mode
```

Read-only workers can share the repository, and their brief says they must not write, because there's no read-only switch.

## Collecting

```bash
pstack-cli collect how-1 --wait 60000
```

`collect` gives back either the worker's confirmed result or an explicit state:

- `working`: still running. Keep talking to the human or collect another task, then come back.
- `blocked`: the worker is waiting at an approval or question in its pane. Answer from the brief if you can. If the answer needs the human, ask.
- `unknown`, `missing`, or `mismatch`: the pane's state or identity can't be confirmed. Don't read the pane and treat what you see as the answer. A result file or terminal transcript isn't proof while the status is ambiguous, and neither is a reason to resend the same id.

Only a confirmed result counts as evidence. Judge it against the brief before you use it: did the worker do what was asked, cite what it claims, and run the checks it reports? A result that misses the brief gets one fresh delegate with a new id and a tighter brief. After a second miss, record a gap and tell the human.

`pstack-cli tasks` lists your delegations and their last known state. `pstack-cli dismiss <id>` closes a finished worker's pane, and only if that pane still holds the same agent. Dismiss once you've collected what you need.

## The cycle

1. Read the human's turn. Route it through poteto-mode to a playbook or skill.
2. Follow that workflow's steps in order. At each delegation step, send every worker the step calls for.
3. Collect each one until you have a confirmed result or a state you can act on.
4. Judge and merge the results the way the workflow says: the `how` explainer, the `why` synthesizer, arena's cross-judge and graft, swarm's selection rule, the reviewer's verdict.
5. Answer the human in this pane, in your own words, with what you verified and what you didn't.

## Standalone runs

`pstack-cli run` still starts a worker in its own Herdr workspace and waits for it to settle. It's for use outside a primary, and in a primary pane you use `delegate` and `collect` instead. A worker that has to start its own workers, such as an orchestrate sub-coordinator, isn't a primary, so its brief uses `pstack-cli run`.
