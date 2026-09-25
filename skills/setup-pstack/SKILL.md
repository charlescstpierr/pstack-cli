---
name: setup-pstack
description: Configure which CLI agent and model pstack uses per role. Detects the agent CLIs installed on this machine and writes one selection per role with pstack-cli setup. Use for "setup pstack", "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write pstack's per-role configuration through `pstack-cli setup`. Choose the primary conversation separately with `pstack-cli setup --master <kind> --model <model>`; its model does not replace any worker role. Each role maps to one agent CLI kind and one model that the CLI accepts. The routed skills (`how`, `why`, `arena`, `swarm`, `architect`, `interrogate`, and the poteto-mode playbooks) send their workers to sibling panes with `pstack-cli delegate --role <role>`, which reads this configuration and never substitutes a model. Standalone `pstack-cli run --role <role>` reads the same configuration.

## Steps

### 1. Detect available CLIs

Run `pstack-cli detect`. It lists the supported agent CLIs found on `PATH`: `claude`, `codex`, `opencode`, `pi`. Only these kinds can be configured. A kind that isn't detected can't be selected.

Model names aren't enumerable through pstack-cli. Each CLI has its own model list (`claude --help`, `codex --help`, or the vendor's docs). If you can't confirm a model name, ask the user which models they have access to on each CLI. Never write a model you haven't confirmed. The CLI passes the model as `--model` for `claude` and `pi`, and `-m` for `codex` and `opencode`.

**Always show Lauren Tan's recommendations**, even when the user has already configured every role. They are the pinned [upstream setup-pstack defaults](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/setup-pstack/SKILL.md), not a claim that the listed Cursor model slugs exist in an installed CLI. Keep the recommended model and the locally selected CLI/model in separate columns. Never write an upstream slug to a CLI configuration without confirming that the CLI accepts it.

| Role | Lauren Tan's recommended model |
|------|-------------------------------|
| `feature, refactoring` | `grok-4.7-xhigh-fast` |
| `bug-fix` | `grok-4.7-xhigh-fast` |
| `perf-issue` | `grok-4.7-xhigh-fast` |
| `hillclimb` | `grok-4.7-xhigh-fast` |
| `judgment and prose` | `claude-opus-5-5-max` |
| `hardest tasks` | `claude-opus-5-5-max` |
| `how explorer` | `grok-4.7-xhigh-fast` |
| `how explainer` | `claude-opus-5-5-max` |
| `why investigators` | `grok-4.7-xhigh-fast` |
| `why synthesizer` | `claude-opus-5-5-max` |
| `reflect tooling` | `gpt-5.6-sol-max` |
| `reflect judgment, divergent, synthesizer` | `claude-opus-5-5-max` |
| `arena runners` | `claude-opus-5-5-max`, `gpt-5.6-sol-max`, `grok-4.7-xhigh-fast` |
| `arena cross-judge pool` | `claude-opus-5-5-max`, `gpt-5.6-sol-max`, `grok-4.7-xhigh-fast` |
| `swarm workers` | `grok-4.7-xhigh-fast` |
| `architect runners` | `claude-opus-5-5-max`, `gpt-5.6-sol-max`, `grok-4.7-xhigh-fast` |
| `interrogate reviewers` | `claude-opus-5-5-max`, `gpt-5.6-sol-max`, `grok-4.7-xhigh-fast` |

### 2. Load current state

Run `pstack-cli status`. It shows the detected CLIs and every role that already has a selection. Treat those as the current choices. A role with no selection has no default: the skill that needs it will fail to launch until it's set, so aim to fill every role you expect to use.

The roles, with the exact labels `pstack-cli setup --role` accepts:

| Role | Used by |
|------|---------|
| `feature, refactoring` | poteto-mode code delegates on the Feature and Refactoring playbooks |
| `bug-fix` | Bug fix playbook delegates |
| `perf-issue` | Perf issue playbook delegates |
| `hillclimb` | Hillclimb playbook delegates |
| `judgment and prose` | prose and judgment delegates |
| `hardest tasks` | cross-cutting design, concurrency, subtle algorithms |
| `how explorer` | `how` explorers |
| `how explainer` | `how` explainer and synthesizer |
| `why investigators` | `why` investigators |
| `why synthesizer` | `why` synthesizer |
| `reflect tooling` | `reflect` tooling reviewer |
| `reflect judgment, divergent, synthesizer` | `reflect` judgment and divergent reviewers, synthesizer |
| `arena runners` | `arena` candidates |
| `arena cross-judge pool` | `arena` cross-judge |
| `swarm workers` | `swarm` workers |
| `architect runners` | `architect` Phase B candidates |
| `interrogate reviewers` | `interrogate` reviewers |

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Ask the user in plain text. Offer these four options with these exact labels, and name the current budget if the user set one before.

- `unlimited, keep max`
- `large, xhigh reasoning`
- `medium, high reasoning`
- `small, medium reasoning`

These four upstream budget tiers are recommendations to present on **every** setup run; they do not silently alter models configured in a different provider's CLI.

**(b) Apply it.** The budget picks the reasoning tier of every real model. Where a CLI's model names carry a tier token (for example a `-max`, `-xhigh`, `-high`, `-medium` suffix, or a `reasoning` flag documented by that CLI), set every role to the tier the budget names, or the highest tier at or below it that the CLI offers. Where a CLI exposes no tier in the model name, the budget picks between the CLI's strongest and its fastest model: `unlimited` and `large` take the strongest, `medium` and `small` take the fastest. On a re-run keep any role the user changed by hand.

Suggested shape, once you know the models each detected CLI accepts:

- Code roles (`feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `swarm workers`, `how explorer`, `why investigators`): a fast, strong coding model.
- Judgment roles (`judgment and prose`, `hardest tasks`, `how explainer`, `why synthesizer`, `reflect judgment, divergent, synthesizer`): the strongest reasoning model available.
- Panel roles (`arena runners`, `architect runners`, `interrogate reviewers`, `arena cross-judge pool`): a model from a different CLI kind than the one you're running in, so the panel adds a second model family. See the panel note below.

**(c) Show the roles and confirm.** Show every role with its kind and model, marking any role still unset. Ask whether to accept as-is or change specific roles, offering the detected kinds and their confirmed models. Ask in plain text.

**Panel note.** `pstack-cli setup` stores exactly one kind and one model per role, so a panel role can't hold a list. The panel skills handle this two ways: they launch N seats on the one configured selection when the task is generation-bound, and for model diversity they reconfigure the role between launches (`setup` seat A, `run` it, `setup` seat B, `run` it) and restore the role afterwards. If the user wants a fixed multi-family panel, record the seat list in your reply so the panel skill can apply it, and configure the role to the first seat.

There is no `inherit-parent` or `auto` alias. A role that should run "on the parent model" is done inline by the calling agent instead of a worker; say so when you skip configuring it.

### 4. Validate

Every kind written must be in the detected set, and every model must be one the user or the CLI's documentation confirmed. If a choice fails that bar, stop and ask again.

### 5. Write the configuration

One call per role:

```bash
pstack-cli setup --role "feature, refactoring" --kind codex --model <model>
pstack-cli setup --role "judgment and prose" --kind claude --model <model>
pstack-cli setup --role "interrogate reviewers" --kind opencode --model <model>
```

Repeat for each role. `setup` overwrites the selection for that role only, so re-runs stay idempotent and untouched roles keep their value.

### 6. Confirm

Run `pstack-cli status` and show the result. Tell the user the configuration applies to every later `pstack-cli delegate` and `pstack-cli run`, including workers already-running skills launch next. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work?" On yes, read `pstack-cli skill create-verification-skill` and follow it if it's installed; if it isn't, say so and move on. On no, move on without pushing.

---
Adapted from the `pstack` plugin by Cursor (setup-pstack). See the root LICENSE for attribution and terms.
