---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for 'swarm', 'swarm this', or parallel coverage, races, gauntlets, and exploration."
---

# Swarm

Fan out N parallel workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Running workers

Each worker is a separate CLI agent in a sibling pane of the primary's Herdr workspace:

```bash
pstack-cli delegate --task-id <id> --role "swarm workers" --cwd "<path>" --prompt "<brief>"
```

`delegate` resolves the role to the CLI kind and model saved by `pstack-cli setup`, reserves the task id, opens a sibling pane in the primary's Herdr workspace without taking focus, submits the prompt, and returns right away. Collect with `pstack-cli collect <id> --wait <ms>`. Only a confirmed result counts. A `working`, `blocked`, `unknown`, or `mismatch` state is not an answer, and a result file or pane transcript proves nothing while the status is ambiguous. Never resend an id after an ambiguous status. `delegate` never substitutes a model: an unconfigured role fails, so run the `setup-pstack` skill first. Workers run on this machine, not in a cloud sandbox, so `--cwd` is where the worker gets to write. Give every writing worker its own checkout (a git worktree) as its `--cwd`.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers. Each one is a live agent process in a Herdr pane, so check `pstack-cli tasks` for what's already running and keep N within what the machine can hold.
4. Pick the worker model. All workers use the `swarm workers` role. For a model race, each arm needs its own selection: reconfigure the role before launching that arm (`pstack-cli setup --role "swarm workers" --kind <kind> --model <model>`), launch the arm, then the next, and restore the original selection when all arms are launched. Name each arm's kind and model up front in the brief and in the report.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Send all N delegations before collecting any. Each one opens its own sibling pane:

```bash
pstack-cli delegate --task-id swarm-1 --role "swarm workers" --cwd "<worktree-1>" --prompt "<brief 1>"
pstack-cli delegate --task-id swarm-2 --role "swarm workers" --cwd "<worktree-2>" --prompt "<brief 2>"
```

When a worker must start from a non-default pushed branch, create its worktree on that branch before launching and pass the worktree as `--cwd`.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first. Ask each worker to end its reply with its report block so `pstack-cli collect` picks it up.

If a worker drops out (`delegate` fails, or `collect` reports `blocked` with an approval prompt you can't answer from the brief), proceed with N-1 and note it.

## Phase C: Aggregate

Collect each worker's result with `pstack-cli collect <id>`. A `working` or `unknown` state isn't a result, so keep collecting or record a gap. A rerun is a fresh `delegate` with a new task id. Drop a result that does not record the SHAs and method its brief names, and rerun that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.

---
Adapted from the `pstack` plugin by Cursor (swarm). See the root LICENSE for attribution and terms.
