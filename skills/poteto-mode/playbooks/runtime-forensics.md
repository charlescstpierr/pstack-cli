### Runtime forensics

**You own the diagnosis. Instrument the live process, don't theorize from source.** The deliverable is a cited diagnosis, not a fix.

1. Capture the live signal on the matching surface: a CPU profile for a spinning process, a heap snapshot for a leak, a CDP trace for a visual glitch. Use `control-cli` or `control-ui` if installed for this CLI (`pstack-cli skill control-ui`); otherwise attach directly from the shell (the runtime's inspector or profiler flag, a browser automation tool connected over CDP, the OS sampler such as `perf`, `sample`, or Windows Performance Recorder). A real artifact, not a guess. Save it outside the tree and note the command.
2. Reduce the artifact to the smoking gun: the function on the hot path, the retainer chain from the leaked object to a GC root, the loop firing without input. Parse large artifacts in a delegate (the **guard-the-context-window** principle skill), for example `pstack-cli delegate --task-id <id> --role "judgment and prose" --cwd "<scratch>" --prompt "Load <artifact path>, load it into sqlite, and report the top frames by self time"`, and keep only the reduced finding in the main thread (`pstack-cli collect <id>`).
3. Prove the mechanism before believing it. Inject instrumentation into the running process (CDP `Runtime.evaluate` over the inspector port, a debugger breakpoint, a hot-patched function) without reloading, to confirm the hypothesis cheaply. If the process can't be attached to, say so and downgrade the finding to a hypothesis.
4. Map the finding back to source: file, symbol, the line that allocates or schedules.
5. Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only forensics`.

**Reply:** the signal captured, the reduced finding, how you proved the mechanism, the source location, artifact paths. No fix unless asked. Hand back to Bug fix (`pstack-cli playbook bug-fix`) or Perf issue (`pstack-cli playbook perf-issue`) once the cause is known.
