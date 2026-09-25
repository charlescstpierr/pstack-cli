---
name: create-verification-skill
description: "Generate a project-local verification skill that drives your app the way a user does, in any language, framework, or platform. Use for 'create-verification-skill', 'make a control skill for this repo', or when a project has no scripted way to prove UI, CLI, or service behavior."
---

# Create a verification skill

Every serious project needs a scripted way to drive the real app and prove behavior: launch it, exercise a feature the way a user would, and capture evidence. This skill generates that as a project-local skill tailored to the repo. You write the generator's output for the next agent, not for a human. It will be read cold, mid-task, by a CLI agent that has never seen the app and has no editor integration, so every step must be runnable from a shell.

## Where the generated skill lives

Write it to `<repo>/.pstack/skills/verify-<app>/`. That path is inside the checkout, so every Herdr-backed worker that gets the repo as its `--cwd` can read it with a plain file read. Do not rely on `pstack-cli skill verify-<app>` resolving it. `pstack-cli skill` reads this kit's own skill directory, and the generated skill is not part of the kit. When you brief a worker that must use the verification skill, name the path in the prompt: "Read `.pstack/skills/verify-<app>/SKILL.md` first and follow its Launch, Doctor, Drive, Evidence, and Cleanup sections."

## 1. Interview the repo, not the user

Answer these from the codebase and only ask the user what you cannot observe:

- **Surface.** What does a user actually touch? A web UI, a CLI or TUI, a desktop app, an API, a mobile app, a library? A repo can have several. Pick the primary one and note the rest.
- **Run.** How does the app start locally? Prefer the repo's own documented dev command (package scripts, Makefile, README quickstart). Note ports, env vars, seed data, auth.
- **Drive.** How can an agent interact with it programmatically? Existing harnesses first: Playwright or Cypress specs, expect scripts, PTY helpers, curl-able endpoints, a debug port. Only then pick a generic recipe: browser or CDP for web and Electron, a tmux or PTY harness for CLI and TUI, plain HTTP for services. A Herdr terminal pane is a valid PTY for driving a CLI or TUI: `herdr agent read` returns the pane text, so a drive can be "send keys, read pane, assert on the transcript".
- **Observe.** What evidence can be captured? Screenshots, terminal transcripts, response bodies, logs, exit codes, DB state.
- **Isolate.** Can two instances run side by side (ports, data dirs, profiles)? If not, say so in the generated skill. Refusing to double-drive a shared instance beats corrupting the user's session. This matters more here than in an editor: several Herdr agents may share one machine, and `pstack-cli status` shows which ones are already running.

If the checkout doesn't build or start as-is, fix that first (or report it precisely) before generating. A skill written against a broken base teaches wrong steps. When an irrelevant missing asset blocks startup (a static dir the API never serves, a sample config), the generated skill may create it, clearly marked as verification scaffolding, and remove it in cleanup.

## 2. Generate the skill

Write `.pstack/skills/verify-<app>/SKILL.md` with YAML frontmatter (`name: verify-<app>` and a `description` that names the app, the surface, and when to reach for it) and these sections, each grounded in what the interview actually found, with no placeholders left:

- **Launch.** The exact command that starts the app for verification, and how to tell it's ready (a log line, a port answering, a prompt). Include teardown. For a short-lived CLI or TUI there is no server to keep alive. Launch means build the binary (or install deps) once, then start each drive in its own isolated PTY or tmux session.
- **Doctor.** One read-only check that answers "is this instance worth driving?" Process up, right version or build, port owned by us, auth valid. An agent runs this first whenever anything looks off.
- **Drive.** The harness recipe with real selectors and commands from this repo, not examples. Prefer stable handles (ARIA labels, data attributes, prompt strings, route paths) over coordinates and tab order.
- **Evidence.** What to capture for a proof and where it goes. State the proof standards: exercise the real user path, not internal setters or test-only endpoints. Capture the action and the resulting state, not just the final screen. Verify side effects (files written, rows inserted, messages sent) alongside what's visible. Mock only where a production boundary already isolates the external system. When the safe path is a dry-run or test mode, verify what it actually skips by observing files, network, and git refs rather than trusting its name. Some dry-runs still touch the network or open a browser.
- **Cleanup.** How to tear down instances the run created. Never kill by process name. Kill what you started. Cleanup removes instances and scratch state, never the evidence. Proof artifacts survive the teardown, in a location the skill names.
- **Helpers.** Any script the skill ships is executable and its invocation is shown in the skill body. A helper the reader has to reverse-engineer is not a helper.

## 3. Seed the feature map

Create `.pstack/skills/verify-<app>/features/README.md` plus one file per user-facing feature you can identify (aim for the top 3 to 5 to start, from routes, commands, menus, or docs). Follow the shape in [`references/feature-map-example/`](references/feature-map-example/README.md), with a README index and one file per feature. Each file answers, from the user's point of view: what the feature is, how to reach it, how to drive it with the harness, and what observable end state proves it works. The four H2s are `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, and `Gotchas`. The map is the repo's maintained verification source. A proof that drives one convenient entry point is incomplete when the map lists others.

## 4. Prove the generated skill before handing it over

Run its own instructions end to end once: launch, doctor, drive ONE mapped feature (one is enough; the map exists so later runs can cover the rest), capture evidence, clean up. After cleanup, confirm the evidence still exists at the named location. A cleanup that eats the proof fails this step. Fix what fails, and run the generated cleanup after every failed iteration too, so broken attempts don't strand processes and ports. A generated skill that was never executed is a draft, not a deliverable.

The proof run can be delegated to a fresh worker, which is the strongest test of the skill's readability:

```bash
pstack-cli run --role "swarm workers" --cwd "<repo>" --prompt "Read .pstack/skills/verify-<app>/SKILL.md and features/README.md. Launch, doctor, drive the <feature> feature, capture evidence, clean up, then confirm the evidence still exists. Report PASS or ISSUES with paths."
pstack-cli read <worker>
```

An unconfigured role fails. Run the `setup-pstack` skill first (`pstack-cli skill setup-pstack`).

## 5. Offer the maintenance loop

Point the user at the `maintain-verification-skill` skill (`pstack-cli skill maintain-verification-skill`) for keeping the map honest as the app changes. Suggest a cadence only if they ask.

---
Adapted from the `pstack` plugin by Cursor (create-verification-skill). See the root LICENSE for attribution and terms.
