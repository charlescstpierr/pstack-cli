### Session pickup

**You own the resume point. Read the prior trail, don't redo it.**

1. Locate the prior trail. It's one of: a Herdr pane another agent left behind (`pstack-cli tasks` lists your delegations, `pstack-cli collect <id>` returns a result or its state), a resume note written by the Pause safely playbook (the reply that paused names its path), a transcript file the CLI you run inside keeps for this session (the CLI's own docs or system prompt name the location; read only the active project's transcripts, never glob across other projects' chat histories, since that crosses workspace boundaries and reads private chats), or a pushed branch. Read the metadata overview and last messages first, then scan back for the decision points. Parse a long transcript in a delegate and keep the reduced timeline in the main thread (the **principle-guard-the-context-window** skill):

   ```bash
   pstack-cli delegate --task-id <id> --role "judgment and prose" --cwd "<worktree>" --prompt "Read <transcript-path>. Return a timeline of decisions, what was verified, and where it stopped. Do not edit files."
   ```

   Collect the delegate's summary with `pstack-cli collect <id>`.
2. Reconstruct operational state. The branch and worktree (`git worktree list`, `git status`), what already landed (`git log`, `git diff` against the base), the open todos, the decisions made. The prior trail is authoritative input. Resist the bias to re-derive it.
3. Diff done vs pending. Compare what shipped against what was planned, name the resume point, do not re-run the prior repro or redo completed work. A "let me verify from scratch" pass means you're treating the trail as untrustworthy when it's authoritative.
4. Route the remaining work to the matching playbook (`pstack-cli playbook <name>`) and pick the verdict: continue the execution, ship a finished recommendation, ratify or override a prior conclusion, or postmortem a failed run. The pickup playbook ends here. The routed playbook owns the rest.
5. Verify the inherited claims against the original goal on the real artifact (the **principle-prove-it-works** skill). A passing prior self-report is not the proof.

**Reply:** where the prior agent stopped, which trail you read (worker name, note path, or branch), what you inherited vs redid (ideally nothing redone), the resume point, and the outcome.
