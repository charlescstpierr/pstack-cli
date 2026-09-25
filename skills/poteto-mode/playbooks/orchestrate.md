### Orchestrate

**You own the program, never the code. Author briefs, drain the queue, keep the frontier green, decide.** For a whole project handed to one standing coordinator chat: multi-day, many stacked PRs, dozens to hundreds of delegates, the human checking in twice a day instead of every five minutes. One task driven to a predicate is Autonomous run. One ambitious run needing a bespoke workflow is the **figure-it-out** skill. Route here when the work outlives any single agent. Work one agent could finish inside the session's budget is not a program.

Ceremony must scale with the program. On cheap near-identical units, collapse it as each section directs.

**Tooling this playbook assumes.** Every agent is a Herdr-managed CLI delegate started with `pstack-cli run --role <role> --cwd <worktree> --prompt <brief> [--skill poteto-mode]`, read with `pstack-cli read <worker>`, listed with `pstack-cli status`, and re-prompted with `pstack-cli resume <worker> --prompt <brief>`. The resume command checks the saved pane and terminal identity before sending anything. There are no cloud agents; every delegate runs on this machine in its own git worktree, so the in-flight cap is bounded by this machine's cores and memory, not by a cloud budget. Bookkeeping is bundled in `bun scripts/orch/orch.ts --store <store>/orchestrate/<slug> <command>`. Run it from the pstack-cli checkout; `--store` can also be supplied as `ORCH_STORE`. It writes plain TSV and JSON locally and never launches agents. Each invocation holds one writer lock and uses atomic replacement for table updates. Never edit its tables concurrently by hand. Upstream computes the frontier from Graphite (`gt`); here the frontier comes from `gh pr list` and `git`, and `gt` is never required. Roles must be configured beforehand with `pstack-cli setup --role "<role>" --kind <cli> --model <model>`.

Three rules carry the rest.

- Completions are queue events, not interrupts.
- Every spawn and every resume carries the standing orders verbatim.
- The brief is the product. A vague brief fails quietly, because a worker cannot ask you a question.

#### Roles and placement

- **Coordinator (this chat).** Frames, authors briefs, drains the inbox, owns the human report, makes judgment calls. It never authors or edits code. Conflicted merges, restacks, and code changes are always tasks. Mechanically landing a verified unit (fast-forward or clean cherry-pick of a worker's commit, then push) is bookkeeping the coordinator may do itself from its own root worktree on repos where local git is cheap. Queueing finished work behind an idle stacker is how a deadline harvests nothing. The loop is agentic end to end. Delegates are spawned only through `pstack-cli run`, resumed only through their pane, and drained by reading their transcripts. State reads and writes are `orch` invocations at drain points; each prints JSON and releases the lock. The store never spawns, waits, or wakes anything.
- **Sub-coordinator.** A durable delegate, one per track, and only when the program exceeds what one coordinator's drains can manage. A track the coordinator can drain itself needs no middle layer. Each nested layer re-pays a full orientation preamble, and a blocking sub-coordinator hides its children while the parent idles. Owns its track's units and boards, authors its workers' briefs, spawns its own workers and verifiers with `pstack-cli run` (nesting works to depth 3; a nested delegate has the full CLI and can run `pstack-cli` itself when its brief allows it). Rolls up aggregates at wave boundaries. Never forwards raw child reports. Cap in-flight children at what one drain can process and what this machine can host, roughly ten, as a rolling window. Never as blocking batches, which cost the slowest child of every batch.
- **Worker / verifier.** Always a delegate in its own worktree on this machine. Delegates can read the local store, so briefs may point at store paths instead of inlining, but a brief that a stranger could not execute is still a failed brief. Prefer fewer, broader workers. One writer per worktree or branch (the **separate-before-serializing-shared-state** principle skill). Run a unit's verifier on a different role whose model family differs from its worker's, per the SKILL.md second-opinion rule.

Depth stays at coordinator, track, worker. Author the track decomposition per project (build, landing, and verification are common cuts, not a required shape). Hard-coded swarm trees were tried and parked as too rigid.

#### Store layout

Create `orchestrate/<project-slug>/` in the current agent's store (path in the system prompt). Every file has exactly one writer. Owners publish facts, readers aggregate at read time. Plain TSV and JSON, readable with a shell and written through `orch`.

- `preferences.md` is the standing-orders register: numbered lines, one constraint each (model policy per role, stack shape and count, verification bar, forbidden paths, escalation policy, the in-flight cap for this machine). Paste it verbatim into every spawn and every resume. Directives decay across resumes, and each dropped one costs a human turn. When you catch yourself restating an instruction, append the line before you act (the **encode-lessons-in-structure** principle skill).
- `overview.md` is the durable PR and issue DB. Append. Never rewrite wholesale per event.
- `units.tsv` has one row per unit: id, track, state, branch, PR, head SHA, brief path, worker name, worktree. `orch unit add/set` updates it atomically.
- The merge frontier is queried from `gh` and `git` at decision time, per Stack safety; `orch status` does not compute it.
- `ledger.tsv` is the append-style verification ledger, per Verification; a check uses the most recent receipt for a PR and SHA.
- `inbox/` holds JSON completion pointers, one file per completion; `inbox/drained/` archives drained pointers. `gates.json` parks human gates (question, options, default on no answer).
- `decisions.tsv` is the trail via the **show-me-your-work** skill.
- `orch status` derives a JSON report from units, receipts, gates and pending inbox; save its output as a checkpoint if needed. It does not query the forge.

#### The brief

Your prompts to agents are your only product, and a sloppy brief compounds into slop across the whole tree. Every spawn carries all of it. A field you cannot fill is a unit you have not scoped yet.

```
GOAL         one sentence, the outcome, executable by a stranger with no chat access
SCOPE        paths this unit may write; paths it may not; its exclusive worktree and branch
CONTEXT      pointers to files and PRs; upstream reports pasted in full when this unit
             depends on them, because workers cannot see siblings
ACCEPTANCE   checkable criteria, one per line
VERIFY       exact commands or the control-skill or driver path, plus known gotchas
TIMEBOX      rough cap on runtime; on expiry, return partial findings and stop rather than run on
FORBIDDEN    no gt, no rebase, no force-push, no fixes outside scope, no pstack-cli run unless
             granted, plus unit-specific bans
REPORT       status, branch, head SHA, PRs, verdict, what you actually ran, deviations,
             suggested follow-ups
STANDING     <preferences.md pasted verbatim>
```

Size the brief to the unit. A one-command unit gets the template collapsed to a paragraph that still names goal, scope, the verify command, and the report shape. A 4KB scaffold around a two-line edit costs more to write and obey than the edit. A first spawn may reference the standing-orders file by store path since delegates can read it. Verbatim paste is for every resume and every sub-coordinator brief.

A sub-coordinator brief adds its track boundary and unit list, its spawn budget (the in-flight cap and the roles it may use), the drain protocol, and the rollup format (per child: worker name, status, PR, head SHA, verdict, one line, plus track status and frontier delta).

A dependency is a context relay, not just ordering. Undeclared upstream context makes the worker guess. Missing fields are a refuse-to-spawn condition. Audit one sampled worker brief per sub-coordinator per wave, concurrently with the wave it samples, never as a gate in front of it. A failing brief stops that track and fixes the sub-coordinator's instructions, not just the worker, because brief quality decays late in a run. Never resume-chain a brief. Respawn fresh with consolidated scope.

#### Steps

1. **Frame.** State the done predicate as something countable ("all 126 units merged, each ledger-verified `unit-test-verified` or better"). Quantify scope: units, rough effort, expected stacks, and the wall-clock budget. If one agent could finish inside that budget, stop here and run Autonomous run instead. Collapsing must not depend on another document being present. It means do the work directly in this session, plain delegates where they help, verification inline, landing as you go, and none of the store, register, or pilot machinery below. Schedule landing against the budget. By roughly 70% of it, stop spawning and land what is verified. Name the tracks per project. A contested decomposition or one-way door goes through the **arena** skill (`pstack-cli skill arena`) before the pilot. Present the framing once. Reversible prep proceeds without waiting.
2. **Install the runtime.** Run `bun scripts/orch/orch.ts --store <store>/orchestrate/<slug> init`. Open the trail via the **show-me-your-work** skill and write standing orders in `preferences.md` before any spawn. Discover existing PRs with `gh pr list --state open --json number,headRefName,baseRefName,headRefOid` filtered to the program's branches; the CLI does not change or persist stack topology. Add each scoped unit with `bun scripts/orch/orch.ts --store <store>/orchestrate/<slug> unit add <id> --track <track> --brief <brief-path>`.
3. **Pilot.** Push one unit through the whole path: brief, worker, verification, stack entry, ledger row, merge. The pilot exists to falsify the brief template, the verify recipe, and the unit size while that costs one delegate instead of fifty. Fix the contract from pilot evidence before any fan-out. Scale the pilot to the unit. On programs of near-identical cheap units, the first unit is the pilot, run as a normal unit with its verify command inline, and fan-out starts the moment it lands. The dedicated pilot pipeline (separate verifier delegate, audit gate) is for expensive or novel unit shapes, not for clone-units where a serialized pilot has nothing to falsify.
4. **Scale.** Spawn a rolling window of workers up to the in-flight cap, refilling as children finish. Each spawn is one worktree plus one `pstack-cli run` in its own terminal or Herdr pane:

   ```bash
   git worktree add <unit-dir> -b <unit-branch> <base-ref>
   pstack-cli run --role "<role>" --cwd "<unit-dir>" --prompt "<brief text and standing orders>" --skill poteto-mode
   ```

   Supply the contents of the stored brief as the prompt. Keep each invocation in a separate terminal or Herdr pane so the next unit does not wait for it; shell `&` and `$(cat ...)` are not portable to PowerShell. Blocking batches pay the slowest child of every batch. Spawn track sub-coordinators only past the one-drain threshold in Roles. Recompute ready work after each drain. Relay upstream reports into downstream briefs. Keep sibling communication upward only. The sampled brief audit runs alongside the wave it samples and stops the next refill on failure, not the current one.
5. **Drain.** Run the queue discipline below at every drain point.
6. **Land.** Landing is continuous, never a terminal phase. Integration starts with the first verified unit and runs alongside the remaining waves. On heavy repos the stacker is a standing delegate from wave one, integrating as units verify. On repos where local git is cheap, the coordinator lands verified units itself from its root worktree per Roles. Keep the frontier green before upper-stack work. Stack safety governs. Re-query `gh` and `git` on merge or reported new head SHAs.
7. **Close.** Drain the final inbox, reconcile every spawned delegate to a terminal row (done, abandoned, zombie-reconciled), confirm the predicate on the real artifact, confirm every landed PR has a verdict for its current head SHA, audit the trail per **show-me-your-work** including its cross-model review, encode recurring corrections into `preferences.md` or the brief template. Remove finished worktrees (`git worktree remove <dir>`) but leave the store intact. It is the postmortem.

#### Queue and drain

- On a completion (a background `pstack-cli run` returning, or a `pstack-cli status` row turning `done` or `blocked`), write one pointer file with `bun scripts/orch/orch.ts --store <store>/orchestrate/<slug> inbox push <worker> <unit> <status> --report <report-path>` and return to what you were doing. Never deep-review inline. A completion that needs review becomes a verifier unit. Never review a diff inside a drain.
- Drain in batches at four points: the end of a critical section, a track rollup, a frontier watcher wake (a bounded `gh pr checks --watch` or a capped `wait -n` on the background jobs, held as your own loop with a long heartbeat fallback), and before a human report. Begin each batch with `bun scripts/orch/orch.ts --store <store>/orchestrate/<slug> inbox drain`. The returned JSON is that batch; files move to `inbox/drained/` as a durable archive. If the coordinator crashes before processing the returned pointers, replay the archived JSON files before taking a new batch. Arrivals during a drain wait for the next one.
- Critical sections you finish first: authoring a brief, a stack operation, a conflict decision, writing a gate, updating ledger or frontier.
- Each drain classifies every pointer (landed, needs-verify, failed, zombie, noise), reads the transcript behind it with `pstack-cli read <worker>`, runs `orch unit set <unit> --state <state> [--branch <branch>] [--pr <number>] [--sha <sha>] [--worker <name>] [--worktree <path>]` and `orch ledger record <pr> <sha> <verdict> --evidence <path> [--verifier <name>]` where appropriate, then runs `orch status`, then spawns the next wave in one message.
- Account for every spawned child at its track's rollup: arrived, respawned, or its scope explicitly absorbed. Silently redoing a missing child's work hides both the wasted spend and the coverage gap its result existed to close.
- A drain turn ends with three lines derived from the tables: counts against the states, what changed, gates open. Detail lives in the `orch status` JSON output. The full reply contract applies at checkpoints and close.

#### Stack safety

- The frontier is computed, never narrative. Re-query it after every merge and stack mutation from the forge and git, not from memory: `gh pr list --json number,headRefName,baseRefName,headRefOid,state` for the program's branches, ordered by following `baseRefName` links up from trunk, giving the ordered PR list, branch names, head SHAs and the lowest unmerged PR. If the forge's base refs and the local branches disagree, the command errors rather than guessing, and the disagreement becomes a stacker unit.
- Exactly one stacker per stack may rewrite topology (rebase, retarget, force-push), serialized within its stack. Record the holder in the standing orders. A restack of a large stack is heavy on this machine; give the stacker a timebox and no sibling writers.
- Workers never rebase and never retarget. Babysitters follow `pstack-cli playbook babysit`, one per stack, scoped to one immutable frontier generation. They report conflicts to the stacker rather than restacking.
- PR closes and retargets go through the stacker only. Closing a base PR orphans every chain above it. Merges and stack surgery are units with briefs like any other.
- One retro watcher delegate follows merged PRs for reverts, post-merge CI breaks, and orphaned follow-ups, read-only through `gh`.

#### Verification

Scale verification to the unit. When VERIFY is a single cheap command, the worker runs it and reports the output, and the coordinator spot-checks receipts. A dedicated verifier delegate (on a role whose model family differs from the worker's) is for units whose verification is expensive, judgment-laden, or high-blast-radius. A verifier whose entire product would be rerunning one command is ceremony, not verification.

Write receipts with `orch ledger record <pr> <sha> <verdict> --evidence <path> [--verifier <name>]`. Check the exact current PR and head SHA with `orch ledger check <pr> <sha>` (exit 2 means absent). `ledger.tsv`, one row per verdict, keyed by PR number plus head SHA: `live-ui-verified | unit-test-verified | type-check-only | verifier-blocked | verifier-failed`. CI green is an input to a verdict, not a verdict. Behavioral work needs better than `type-check-only`. `verifier-blocked` is not a pass. Respawn when the environment heals. `verifier-failed` gets a fix unit, not a re-verify. A worker may self-report. A verifier overrides it on the same key. A new head SHA voids the row, so re-verify after restack. The ledger answers "was this verified", not memory and not the transcript.

A unit is not done until its output is externalized the moment it lands, never batched to the end of the run. A worker pushes its branch, a verifier writes its ledger row (or returns it for the coordinator to write), receipts land in the store. Work that exists only in one worktree that later gets removed was never done.

#### Liveness and failure

- Never re-prompt a delegate to check on it. A prompt restarts an idle agent. Probe read-only: the ledger, `units.tsv`, `gh`, pushed branches, `pstack-cli status`, and `pstack-cli read <worker>`. Transcript mtime is not liveness.
- A silent death gets a synthetic postmortem pointer in the inbox (unit, failure mode, last evidence, options). Replan on evidence as it arrives. Never wait for full quiescence.
- Retry by mode: cap-hit or oom, respawn with smaller scope. Network-drop, retry as-is. Tool-error, retry on a different role. Unknown, retry once. Two retries, then abandon the unit and replan around it.
- A zombie that returns hours late reconciles against the current frontier and ledger before anything is accepted. Salvage unique findings through a fresh unit, never a blind merge.
- When continued spawning would produce garbage tree-wide (bad upstream output, broken acceptance, dead infra), write a stop line at the top of the standing orders, let in-flight work finish, fix the cause, clear it.
- Bound your own infra retries the same way you bound a child's. After a few consecutive tool aborts, stop retrying. Write a terminal handoff to durable state (what is done, where it lives, the exact command to resume) and end the run.
- After a Herdr or machine restart: every delegate is dead, but pushed branches and the store are not. Re-read `preferences.md` and `orch unit list`, recompute the frontier, reattach work by PR and branch rather than worker name, respawn one sub-coordinator per track from its stored brief plus current state, drain, resume. Worktrees survive a restart, so reuse them where the branch matches.

#### Escalation

Reaches the human, batched into the status page rather than per item: irreversible actions (force-push to shared branches, deploys, deletions, closing someone else's PR), genuine product or preference calls no experiment settles, a standing order that contradicts observed reality, a program-level dead end that survived a replan. Park each with `orch gate park <id> --question <text> --options <text> --default <answer>` before asking, inspect with `orch gate list`, resolve with `orch gate resolve <id> --answer <text>`, and route work around it.

Never reaches the human: frontier nudges, restack mechanics, retries, CI flake triage, review-thread triage, format fixes, scope the brief already forbids (refuse and continue), and "should I keep going". When in doubt, act and log.

Mid-run discoveries fix only what blocks the frontier. Everything else parks in follow-ups. At this fan-out a small scope leak multiplies into PRs nobody asked for.

**Reply:** at checkpoints and close: the predicate and the count against it from `orch status`, tracks and what each landed, the frontier (PR list plus SHAs), verdicts summary, what was abandoned and why, gates awaiting the human (the only asks), the store path, and the trail path. Numbers from the tables, not narrative. Include PR links.
