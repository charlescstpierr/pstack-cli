### Investigation

**You own the answer. Plan, route, write.**

Investigation requests are read-only. They produce a cited explanation or a recommendation, not a code change.

1. Route through the **how** skill (`pstack-cli skill how`). For motivation questions, also route through the **why** skill (`pstack-cli skill why`). Both skills name their own delegate roles; if a role isn't configured, `pstack-cli delegate` fails, so set it with `pstack-cli setup --role "<role>" --kind <cli> --model <model>` or do that pass inline and say so. A read-only delegate is told not to edit project files except its mandatory `.pstack/tasks/` report; there's no read-only mode.
2. Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only investigation`.
3. Produce the `how`-shaped output (Overview / Key Concepts / How It Works / Where Things Live / Gotchas), or a recommendation with a tradeoffs table if the request is a decision between alternatives.
4. Apply the **unslop** skill to the reply (`pstack-cli skill unslop`).

No PR, no babysit, no `architect` unless the investigation precedes a code change. If it does, hand back to the user and re-route to Bug fix (`pstack-cli playbook bug-fix`) or Feature (`pstack-cli playbook feature`).

**Reply:** the investigation output. For "are we sure?" answers, include your real judgment with reasons. Push back if the premise is wrong (see Autonomy). Cite files and commands you actually read or ran this session; never a transcript or link you didn't open.
