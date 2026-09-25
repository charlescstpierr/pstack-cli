### Authoring or modifying a skill

**You own the skill's voice.**

1. Author the SKILL.md. If a `create-skill` skill is installed for this CLI, read it with `pstack-cli skill create-skill` and follow it. Otherwise write the file by hand to this shape: YAML frontmatter with `name` and `description`, a body that tells the agent what to do, and references by path to any sibling files. Read `pstack-cli skill poteto-mode` first so the new skill matches the house voice.
2. Validate the skill. Frontmatter has `name` and `description`. Every file the body references exists on disk (`ls` each path). Every cross-skill link resolves: `pstack-cli skill <linked-name>` prints the linked skill instead of an error. If `pstack-cli setup` registers skills for your CLI, run `pstack-cli detect` and confirm the new skill is visible to the agent that will read it.
3. Test cases if structural. A skill that prescribes a checkable output (a file layout, a command sequence, a parseable artifact) gets a case that runs it through `pstack-cli run --role "judgment and prose" --cwd <scratch worktree> --prompt "<organic task>" --skill <new-skill>` and checks the result. Skip if subjective, and say so.
4. Run **Opening a PR** (`pstack-cli playbook opening-a-pr`).

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill (`pstack-cli skill principle-encode-lessons-in-structure`). Delegate to other skills by name (`pstack-cli skill <name>`), never by an editor-specific path. Don't restate. A workflow you keep hitting but isn't captured, propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes (which checks in step 2 ran and what they printed).
