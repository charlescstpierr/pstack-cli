# Using pstack-cli

## Guided first run

Install Bun, Herdr (`herdr` on `PATH` or `HERDR_BIN_PATH`), and at least one signed-in CLI: Claude Code, Codex, OpenCode or Pi. From this checkout:

```sh
bun install
bun src/onboard.ts
```

The French-language onboarding shows Lauren Tan's pinned recommendations and your current selections, then lists installed CLIs. Enter one or several numbers separated by commas (for example `1,2,3`). For each chosen CLI, pick a **distinct role**; its upstream recommendation is repeated beside the model question. Enter a model that the chosen CLI accepts. It saves all selections, then optionally starts **one** of the newly configured roles in an absolute directory you provide. Press `n` (or Enter) to save without starting a worker. Model IDs and subscription access are not verified. A role currently stores one CLI/model pair; multiple selections do not make a pool of CLIs for the same role. Relaunch onboarding to configure other roles. For an isolated config, use `bun src/onboard.ts --config PATH` and pass the same `--config PATH` to the advanced commands below. Onboarding help: `bun src/onboard.ts --help`.

Every advanced example uses `bun src/index.ts`. After `bun run build`, use `bun dist/index.js` or `bun dist/onboard.js` with the same arguments.
The bundled skills abbreviate the advanced command to `pstack-cli`. Run `bun link` from this checkout and add Bun's global bin directory to `PATH` to get both `pstack-cli` and the guided `pstack-init`, or substitute `bun /absolute/path/to/pstack-cli/src/index.ts` in those instructions.

## 1. Find your installed CLIs

```sh
bun src/index.ts detect
```

This prints one line per supported CLI found on `PATH`, in a fixed order: `claude`, `codex`, `opencode`, `pi`. A listed CLI is present. That's all it tells you. Login state and model access aren't checked.

## 2. Read the upstream recommendations

```sh
bun src/index.ts setup
```

Bare `setup` (or `setup --help`) always prints the same thing: the usage line, a warning that model access isn't verified, and a table of Lauren Tan's recommendations pinned to commit [`78f46dacbafc71fd7d937bfc2c26da914f1bc09b`](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/setup-pstack/SKILL.md). The third column shows what you've saved for each role, or `unconfigured`.
Use `setup --config PATH` to see the same recommendations alongside selections in a non-default configuration file.

The 17 roles, with their upstream picks:

| Role | Upstream recommendation |
| --- | --- |
| `feature, refactoring` | grok-4.7-xhigh-fast |
| `bug-fix` | grok-4.7-xhigh-fast |
| `perf-issue` | grok-4.7-xhigh-fast |
| `hillclimb` | grok-4.7-xhigh-fast |
| `judgment and prose` | claude-opus-5-5-max |
| `hardest tasks` | claude-opus-5-5-max |
| `how explorer` | grok-4.7-xhigh-fast |
| `how explainer` | claude-opus-5-5-max |
| `why investigators` | grok-4.7-xhigh-fast |
| `why synthesizer` | claude-opus-5-5-max |
| `reflect tooling` | gpt-5.6-sol-max |
| `reflect judgment, divergent, synthesizer` | claude-opus-5-5-max |
| `arena runners` | claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast |
| `arena cross-judge pool` | claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast |
| `swarm workers` | grok-4.7-xhigh-fast |
| `architect runners` | claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast |
| `interrogate reviewers` | claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast |

Budget tiers, from the same file: unlimited, keep max. Large, xhigh reasoning. Medium, high reasoning. Small, medium reasoning. They're advice for how hard to push a model. They never change a saved model.

These are Cursor slugs. Treat them as "use your strongest judgment model here" or "use a fast coding model here", then pick a real model your own CLI accepts.

## 3. Save a CLI and model per role

```sh
bun src/index.ts setup --role ROLE --kind KIND --model MODEL [--config PATH]
```

- `--role` must be one of the 17 names above, exactly, quoted when it has spaces or commas.
- `--kind` is `claude`, `codex`, `opencode` or `pi`, and it has to show up in `detect`. Otherwise setup fails with `Unavailable CLI`.
- `--model` is saved verbatim. It's passed to Claude Code and Pi as `--model MODEL`, and to Codex and OpenCode as `-m MODEL`.

Configuring two different CLIs looks like this:

```sh
bun src/index.ts setup --role "bug-fix" --kind codex --model "gpt-6-sol"
bun src/index.ts setup --role "judgment and prose" --kind claude --model "sonnet"
```

The IDs above worked on the development workstation; replace them with IDs your own CLI and account accept. Before saving, confirm the model works by starting the CLI yourself with that flag (for example `claude --model sonnet`). If your plan doesn't include a model, the worker fails at startup, not at setup. No fallback model is ever substituted, and a role with no saved selection fails with `No selection configured`.

Each save prints `Saved ROLE: KIND MODEL (model access not verified)` and the refreshed table.

### Where the config lives

`%APPDATA%\pstack-cli\config.json` on Windows. Elsewhere, `$XDG_CONFIG_HOME/pstack-cli/config.json`, falling back to `~/.config/pstack-cli/config.json`. Pass `--config PATH` to `setup`, `run`, `resume`, `status` or `read` to use a different file. Keep the same path for the entire run: its `runs` directory holds the worker identities. The format is strict:

```json
{
  "roles": {
    "bug-fix": { "kind": "codex", "model": "your-model-id" }
  }
}
```

Unknown roles, unknown kinds, extra fields or an empty model are rejected.

## 4. Run a worker

```sh
bun src/index.ts run --role ROLE --cwd PATH --prompt TEXT [--skill NAME] [--config PATH]
```

What happens, in order:

1. The role is resolved from config. Its CLI must still be installed.
2. With `--skill`, that skill's `SKILL.md` is prepended to your prompt.
3. Herdr creates a new, unfocused workspace in `--cwd`, labeled `pstack-<random id>`.
4. The CLI is started as a Herdr agent in that workspace's root pane, with the model flag.
5. The prompt is sent, and pstack-cli waits up to 120 seconds for the agent to become idle, done or blocked.
6. The last 80 lines of terminal output are printed after a header line: `NAME workspace=... pane=... status=...`.

A record of each run is written to a `runs` folder next to the config file.
If a CLI remains blocked during startup, the command reports its worker name, workspace and pane, and saves the matching identity for `status` and `read`. It has **not** sent your first prompt. Complete any login or workspace confirmation in Herdr, then use `resume NAME --prompt "your original task"` with the same config path once the CLI is ready.
If Herdr accepted the prompt but did not observe activity within its five-second gate, `run` waits 30 more seconds for a real agent-state event. It never immediately sends a second copy. Only when that wait expires, the original pane and terminal still match, the CLI is idle and ready, and the transcript contains no submitted prompt does it retry once. Otherwise it reports `status=unknown` when completion cannot be confirmed; use `read NAME` to inspect its transcript before deciding whether to use `resume`.

The worker isn't stopped afterwards. It stays in Herdr, owned by its CLI, so you can keep talking to it there.

## 5. Check on workers

```sh
bun src/index.ts status [--config PATH]
bun src/index.ts read NAME [--config PATH]
```

`status` lists installed CLIs, saved roles, and every recorded run with its live Herdr status (`working`, `blocked`, `done`, `idle`, `unknown`), or `not_running` when Herdr no longer has a matching agent.

`read NAME` checks the saved workspace, pane, terminal, CLI kind and agent name against Herdr before printing the last 80 lines. If the old pane has stopped or been replaced, it prints `status=stopped` or `status=mismatch`, never another agent's terminal. `NAME` is the `pstack-...` name from `run` or `status`.

## 6. Resuming work

```sh
bun src/index.ts resume NAME --prompt "Continue with the next task" [--config PATH]
```

This reads the saved worker record, checks that the original CLI still occupies its Herdr pane and terminal, then sends the prompt to that pane and prints its transcript. If the agent stopped or its identity changed, it sends nothing and reports `status=stopped` or `status=mismatch`. Herdr and the CLI must still be running; pstack-cli doesn't copy, restart or manage Claude Code, Codex, OpenCode or Pi's own session history. To restore a CLI that has exited, use that CLI's own resume feature. The `session-pickup` playbook describes the handoff steps.

## 7. Skills and playbooks

```sh
bun src/index.ts skill NAME
bun src/index.ts playbook NAME
```

Both print a markdown file. Skills live in `skills/NAME/SKILL.md` (for example `tdd`, `why`, `how`, `arena`, `swarm`, `setup-pstack`). Playbooks live in `skills/poteto-mode/playbooks/NAME.md` (for example `bug-fix`, `feature`, `autopilot-full`, `worktree-cleanup`). Names are lowercase letters, digits and hyphens.

## Isolation and worktrees

Every `run` gets its own Herdr workspace, but it works directly in the `--cwd` you pass. Two workers pointed at the same checkout will edit the same files. For parallel work, give each one its own git worktree:

```sh
git worktree add ../repo-bugfix -b bugfix
bun src/index.ts run --role "bug-fix" --cwd ../repo-bugfix --prompt "..."
```

pstack-cli never creates or deletes worktrees for you. To review them:

```sh
bun scripts/worktree-audit.ts [repo-path] [session-store-dir]
```

It reports each linked worktree's size, age, merge and dirty state, and suggests a bucket. It doesn't delete anything.

## Helper scripts

These run on their own with Bun. Each prints its usage with `--help`.

| Script | Usage |
| --- | --- |
| `scripts/check-plan.ts` | `bun scripts/check-plan.ts <plan.md>`. Checks a plan against the multi-phase-plan structure. |
| `scripts/worktree-audit.ts` | `bun scripts/worktree-audit.ts [repo-path] [session-store-dir]` |
| `scripts/watch-pr.ts` | `bun scripts/watch-pr.ts <PR URL or number> [--repo OWNER/REPO] [--status-only or --watch] [--queued-stack --stack-prs N,N] [--timeout SECONDS]`. Read-only, needs `gh` logged in. |
| `scripts/orch/orch.ts` | `bun scripts/orch/orch.ts --store <dir> <command>`. Local bookkeeping for units, ledger, inbox and gates. It never starts or resumes agents. |

## Herdr

`run`, `resume`, `status` and `read` call the `herdr` binary (or `HERDR_BIN_PATH`) with plain argument lists, never through a shell. pstack-cli uses `workspace create`, `agent start`, `agent wait`, `agent prompt`, `agent get`, `agent read` and `agent list`. It doesn't stop agents or close workspaces. That's your call, in Herdr.

## Troubleshooting

- `Unavailable CLI "codex"`: it's not on `PATH`. Check `detect`.
- `No selection configured for role ...`: run `setup --role ... --kind ... --model ...` first.
- The worker starts and immediately errors about the model: your account can't use that ID. Save a different one.
- `Unknown upstream role`: copy the role name exactly from the table, including commas.
