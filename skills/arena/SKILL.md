---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for 'arena', 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
---

# Arena

Fan out N parallel attempts at the same task. Read every candidate end to end. Pick the strongest as the base. Graft the best ideas from the others into it. Verify the synthesized result.

## Running workers

Each candidate and the judge is a separate CLI agent that Herdr starts in its own workspace:

```bash
pstack-cli run --role "arena runners" --cwd "<candidate path>" --prompt "<task>"
```

`run` resolves the role to a CLI kind and model from `pstack-cli setup`, creates a Herdr workspace with `--no-focus`, starts the agent in its root pane, submits the prompt, and returns once the agent settles as `idle`, `done`, or `blocked`. Read the transcript with `pstack-cli read <worker>`. `run` never substitutes a model; an unconfigured role fails, so run the `setup-pstack` skill first.

A role holds one kind and one model. To seat different model families in one arena, reconfigure the role between launches: `pstack-cli setup --role "arena runners" --kind <kind> --model <model>`, launch that seat, repeat for the next seat, and restore the first selection after the last launch. Launches are sequential; the workers themselves run in parallel.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Cross-judge
4. Pick
5. Graft
6. Verify

## Phase A: Frame

The N candidates will receive the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric. State what success looks like for *this* task, then turn it into 3-6 concrete gradeable criteria. The rubric is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Read `pstack-cli status` for the `arena runners` selection. Default is one seat per configured model family the user named when running `setup-pstack`; with a single selection, run the seats on it and say so. Spawn more when the arena covers multiple design directions. Same model N times when the work is generation-bound rather than judgment-sensitive.
4. Assign output paths. Each candidate writes to its own location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill. The candidate's path is its `--cwd`.

## Phase B: Fan out

Launch all N candidates concurrently, each with the task, the path to the shared grounding, its own output path, and instructions to produce both the artifact and a short rationale. Run each invocation in its own terminal or Herdr pane:

```bash
pstack-cli run --role "arena runners" --cwd "<candidate-1>" --prompt "<task + grounding path + output path>"
pstack-cli run --role "arena runners" --cwd "<candidate-2>" --prompt "<same>"
```

Each rationale names the alternatives the candidate considered and what it rejected.

If a candidate fails to produce output, proceed with N-1 and note the dropout in the synthesis record.

## Phase C: Cross-judge

After all Phase B candidates complete, launch one judge on the `arena cross-judge pool` role. Configure that role to a model family different from the one this session runs on when possible. The judge's prompt states it must not modify any file. It sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with the parent's reading in Phase D, not with the candidates themselves. Don't launch the judge while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking.

Score each candidate against the rubric criterion by criterion, not on holistic feel. Compare against the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base on which candidate a future maintainer can extend most easily without breaking invariants. Prefer the cleaner boundary or smaller API when two feel tied, per the Laziness Protocol.

Record the pick and the reason in a short synthesis note alongside the base artifact, including the cross-judge's verdict.

## Phase E: Graft

Walk each losing candidate once more and identify what is worth porting into the base. The signal is usually one or two things per candidate, not most of it.

Fold each graft in by hand, per the **redesign-from-first-principles** principle skill. Don't paste mechanically. The result has to remain coherent under one mental model.

Record what was grafted, from which candidate, and what was rejected and why.

When N candidates converge on the same shape, that is a strong agreement signal. Note the convergence in the record and ship the consensus shape. No graft is needed. When N candidates wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

The synthesized artifact has to hold up under the same scrutiny as any other output, per the **prove-it-works** principle skill.

If verification surfaces a problem the arena did not catch, either Phase A was wrong (re-frame and re-run) or one candidate caught it and you missed the graft (go back to Phase E). Don't paper over.

## Outputs

One synthesized artifact. One short synthesis note alongside, naming the base, the grafts (with source candidate), the rejections, the dropouts if any, and the verification result.

---
Adapted from the `pstack` plugin by Cursor (arena). See the root LICENSE for attribution and terms.
