### Trace forensics

**You own the diagnosis from the artifact. Load it, shape it, narrow to the cause, attribute to source.**

Distinct from **Runtime forensics** (`pstack-cli playbook runtime-forensics`), which instruments the live process. Here the capture already exists. The artifact is a fixed dataset, read it, don't re-run it. Keep tooling generic so the playbook stays portable: a DevTools or trace parser for cpuprofile and `.json.gz`, a text editor for a spindump, your heap tooling for a heapsnapshot.

1. Identify the format and load it with the right tool. Parse large artifacts in a delegate (the **principle-guard-the-context-window** skill) and keep the reduced finding in the main thread:

   ```bash
   pstack-cli delegate --task-id <id> --role "judgment and prose" --cwd "<scratch>" --prompt "Parse <artifact path> (<format>) into <scratch>/trace.sqlite, one row per sample/frame/node, and report the top 20 frames by self time as a table"
   ```

   Read the result with `pstack-cli collect <id>`. Never paste the raw artifact into your own context.
2. Transform the raw artifact into a form you can query. Dump the trace or heap snapshot into sqlite, one row per sample, frame, or node. Reach the queryable shape before you read.
3. Narrow to the cause. Query for the frames that hold the most time and walk the call tree to the hot path. For a leak, follow the retainer chain from the leaked object to a GC root. For a spindump, find the thread stuck on-CPU or blocked and its wait reason.
4. Attribute to source. Map the hot frame to file, symbol, and line via the artifact's own symbols. A frame with no source mapping is not yet a diagnosis. Resolve the symbols, or say plainly the artifact does not carry them.
5. Confirm against a paired capture when you have one. Diff a before and after artifact. Without one, mark the finding as the strongest hypothesis the artifact supports, not a confirmed cause.
6. Hand back a cited diagnosis, no fix unless asked. Route to Bug fix (`pstack-cli playbook bug-fix`) or Perf issue (`pstack-cli playbook perf-issue`) once the cause is known. Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only forensics`.

**Reply:** the artifact and format, the reduced finding, the source location, the artifact paths, and whether a paired capture confirmed it.
