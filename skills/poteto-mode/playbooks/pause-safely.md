### Pause safely

**You own a clean stop. Leave a checkpoint a cold-start agent can resume from.** This is explicit only. On "keep going", "going to bed, keep going", or "don't stop", do not pause.

1. Stop at a safe boundary. Finish the current atomic step or back out of it. Start nothing new. Check `pstack-cli status` for delegates you launched. A delegate mid-task is either left to settle (read its result later with `pstack-cli read <worker>`) or told to stop with a follow-up prompt through the Herdr agent CLI (`herdr agent prompt <worker> "<stop instruction>"`, if that CLI is available on this machine); either way, record each worker name and its state in the resume note. Don't kill a pane whose work you haven't read.
2. Take no irreversible action to pause. No PR and no push unless you already had one out.
3. Make the work durable. Commit uncommitted edits as one clear `wip:` commit on the current branch so nothing is lost. If the tree is broken, say so in the commit body in one line. Do the same in each delegate worktree that has uncommitted edits, since a worktree left dirty is what the next agent will trip on.
4. Write the resume note off-context. Capture intent, what you were doing, progress and what's verified, current state, next steps, key files, and gotchas. Include the worktree paths and the delegate worker names from step 1. For the compaction trigger write it to a file such as `<repo>/.pstack/<slug>-resume.md` or the OS temp directory (`$TMPDIR`, `/tmp`, or `%TEMP%` on Windows), and name the path in the reply. If a show-me-your-work trail exists, point at it instead of duplicating it.

**Reply:** where you are in the loop, what's on disk versus still in your head (paths, no diff dumps), the commits you made and whether the tree is clean, the resume-note path, any delegates still running, and the first action on resume. This is a pause, not a final report.
