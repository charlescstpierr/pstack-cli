---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

## Running workers

Every worker below is a separate CLI agent that Herdr starts in its own workspace. Launch one with:

```bash
pstack-cli run --role "<role>" --cwd "<repository path>" --prompt "<filled prompt>"
```

The role names a line written by `pstack-cli setup` (see the `setup-pstack` skill). `run` resolves that line to a CLI kind and model, creates a Herdr workspace with `--no-focus`, starts the agent in the root pane, submits the prompt, and returns once the agent settles as `idle`, `done`, or `blocked`. Read the full transcript afterwards with `pstack-cli read <worker>`. There is no substitute model: if the role isn't configured or its CLI isn't installed, `run` fails. Then either configure the role or do that step inline in this session and say so. Run parallel workers in separate terminals or Herdr panes, one `pstack-cli run` each. Workers have no read-only switch, so the prompt tells them not to write files.

## Step 1. Assess Complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. One explainer explores and explains in a single pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): spawn parallel explorers first, then hand off to the explainer. Go to Step 2a.

When in doubt, take the simple path.

## Step 2a. Explore (complex questions only)

Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem. Launch each explorer in a separate terminal or Herdr pane:

- role: `how explorer`
- prompt: `references/explorer-prompt.md` with its angle filled in, plus one line saying the worker must not modify files

```bash
pstack-cli run --role "how explorer" --cwd "<repository path>" --prompt "<explorer prompt, angle 1>"
pstack-cli run --role "how explorer" --cwd "<repository path>" --prompt "<explorer prompt, angle 2>"
```

Collect each explorer's findings with `pstack-cli read`. Then go to Step 3.

## Step 2b. Direct Explain (simple questions)

Launch one worker that explores and explains in one pass:

- role: `how explainer`
- prompt: `references/explainer-prompt.md` without the explorer-findings section, plus the no-write line

Go to Step 4.

## Step 3. Synthesize (complex questions only)

Once all explorers have returned, launch one worker to synthesize their findings into one explanation:

- role: `how explainer`
- prompt: `references/explainer-prompt.md` with every explorer's findings filled in, plus the no-write line

## Step 4. Present

Present the explainer's output to the user. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output Format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.

---
Adapted from the `pstack` plugin by Cursor (how). See the root LICENSE for attribution and terms.
