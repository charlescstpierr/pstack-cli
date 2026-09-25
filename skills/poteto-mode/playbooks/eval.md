### Eval

**You own the experiment design. Plan, blind, run, synthesize.**

**Non-negotiables for blinding:**

- No `eval`, `test`, `judge`, `experiment`, `rubric`, `score`, `compare`, `benchmark`, `candidate`, or `arena` in any directory, file, or prompt the candidate sees. That includes the Herdr workspace name and the `--cwd` path you pass to `pstack-cli run`.
- The candidate prompt looks like an organic user request. State the goal, not the meta.
- No chain-eliciting cues. Don't ask the candidate to list which skills, principles, or files they applied. Ask for design notes generally and grade chain-following from code shape, not self-report.
- Sanitize directory and slug names. Use project-shaped names a user might pick.
- Don't tell the candidate other candidates exist.
- The judge can know it's judging but sees outputs by sanitized label only, never by model name.
- Comparing two variants: one judge scores both sets in a single pass on one scale, blind to which set each came from.

**Steps:**

1. **Frame.** State what variant is under test and what behavior counts as success. Write the rubric (3-6 concrete criteria) for the judge only. Hold it back from candidates. Keep it in a directory no candidate `--cwd` can reach.
2. **Set up sanitized environments.** Per-candidate working dir with the variant in place, one git worktree each. Plant any context an organic task would have: a project skeleton, the skills the candidate would naturally read. If the variant is a skill, install it where that candidate's CLI reads skills (`pstack-cli detect` shows the CLIs and their skill dirs).
3. **Author one organic prompt.** What a user would type. No leakage of what's being measured.
4. **Spawn N parallel candidates** on different models per the **arena** skill's Phase B (`pstack-cli skill arena`). Use the configured `arena runners` role and change its kind/model between launches when candidates need different models. Launch each invocation in its own terminal or Herdr pane:

   ```bash
   pstack-cli run --role "arena runners" --cwd "<sanitized-dir>" --prompt "<organic prompt>"
   ```

   Same prompt to each. Don't pass `--skill` unless the skill is what an organic user would have loaded. `pstack-cli status` shows which are still running.
5. **Spawn one blinded judge** on the configured `arena cross-judge pool` role from a different model family per the **arena** skill's Phase C. Copy each candidate's output into a labeled directory (`a/`, `b/`, `c/`) and run the judge with the rubric and those labels only:

   ```bash
   pstack-cli run --role "arena cross-judge pool" --cwd "<judge-dir>" --prompt "<rubric + labels>"
   ```

   The judge never sees a model name, a role name, or a candidate workspace path.
6. **Verify the chain from transcripts, not self-report.** Read each candidate's transcript with `pstack-cli read <worker>`, the worker name `run` printed at launch. Read only the workers you launched for this eval. Don't read other Herdr panes or other projects' agents; that crosses workspace boundaries and reads unrelated private sessions. Look at which files each candidate actually opened. Grade chain-following from the files it really read plus the shape of the code, never from the candidate's own claims.
7. **Read every candidate output yourself** end to end. Compare to the judge's verdict. Disagreement means a model is biased or the rubric is ambiguous. Synthesize.

**Reply:** variant under test, rubric, per-candidate notes, judge's verdict, your synthesis, and a recommendation for whether to promote the variant.
