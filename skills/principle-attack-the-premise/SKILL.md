---
name: principle-attack-the-premise
description: "Apply when two or more fixes that share one premise have failed the same gate. Take a census of which actors hold the imbalance before the next fix, then question the premise instead of writing another fix that assumes it."
---

# Attack the Premise

When two or more fixes that share one premise have failed the same gate, suspect the premise, not the fixes.

**Why:** Each failure under a shared premise is evidence about the premise.

**Pattern:**
- **Write the premise down.** The premise is the one sentence that every failed fix assumed.
- **Take a census before the next fix.** Count the imbalance per actor. The census shows which actors hold the imbalance, not how large it is. Write the census as a rerunnable script (see the Build the Lever principle).
- **Read the skew.** If the same few actors hold most of the imbalance on every run, something assigns them that role. Find what assigns the role. That assignment is the next "why" in your root-cause chain.
- **Remove the asymmetry instead of compensating for it**, following the Laziness Protocol. Rotate the role between actors, randomize the assignment, or move the role, so that no actor holds it on every run. A return path, a shared pool, a batched hand-off, or a periodic rebalance leaves the assignment in place and adds work on every run.

**Stop:**
- Don't start the next fix before the premise is written down and the census exists.
- If the census is even across actors, the premise isn't the cause. Look for the cause elsewhere and keep the census as evidence.

This principle is distinct from Redesign from First Principles, which rebuilds a design around a new requirement. This one questions a fact the current design assumes.

---
Adapted from the `pstack` plugin by Cursor (principle-attack-the-premise). See the root LICENSE for attribution and terms.
