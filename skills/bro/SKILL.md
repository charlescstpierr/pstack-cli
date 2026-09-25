---
name: bro
description: Restate the last message in plain human language, with no jargon.
---

Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.

If a CLI worker receives this skill with no prior message of its own (for example, `pstack-cli run --skill bro --prompt TEXT`), treat the prompt text as the message to restate.

---
Adapted from the `pstack` plugin by Cursor (bro). See the root LICENSE for attribution and terms.
