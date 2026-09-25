---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for 'swarm', 'swarm this', or parallel coverage, races, gauntlets, and exploration."
---

# Swarm

Fan out N parallel workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Running workers

Each worker is a separate CLI agent that Herdr starts in its own workspace:

```bash
pstack-cli run --role "swarm workers" --cwd "<path>" --prompt "<brief>"
```

`run` resolves the role to a CLI kind and model from `pstack-cli setup`, creates a Herdr workspace with `--no-focus`, starts the agent in its root pane, submits the brief, and returns once the agent settles as `idle`, `done`, or `blocked`. Read the transcript afterwards with `pstack-cli read <worker>`. `run` never substitutes a model; if the role isn't configured, run the `setup-pstack` skill first. Workers run on this machine, not in a cloud sandbox, so `--cwd` is where the worker gets to write. Give every writing worker its own checkout (a git worktree) as its `--cwd`.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers. Each one is a live agent process in a Herdr pane, so check `pstack-cli status` for what's already running and keep N within what the machine can hold.
4. Pick the worker model. All workers use the `swarm workers` role. For a model race, each arm needs its own selection: reconfigure the role before launching that arm (`pstack-cli setup --role "swarm workers" --kind <kind> --model <model>`), launch the arm, then the next, and restore the original selection when all arms are launched. Name each arm's kind and model up front in the brief and in the report.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Launch all N workers concurrently, one `pstack-cli run` in each terminal or Herdr pane:

```bash
pstack-cli run --role "swarm workers" --cwd "<worktree-1>" --prompt "<brief 1>" > swarm-1.out
pstack-cli run --role "swarm workers" --cwd "<worktree-2>" --prompt "<brief 2>" > swarm-2.out
```

When a worker must start from a non-default pushed branch, create its worktree on that branch before launching and pass the worktree as `--cwd`.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first. Ask each worker to end its reply with its report block so `pstack-cli read` picks it up.

If a worker drops out (`run` fails, or the agent settles as `blocked` with an approval prompt you can't answer from the brief), proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results (`pstack-cli read` on each worker). Drop a result that does not record the SHAs and method its brief names, and rerun that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.

---
Adapted from the `pstack` plugin by Cursor (swarm). See the root LICENSE for attribution and terms.
