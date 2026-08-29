---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

- The user said "reflect" or "$pstack:reflect".
- A complex task (5+ tool calls) just landed cleanly and the recipe is worth keeping.
- The agent hit dead ends, found the working path, and the path generalizes.
- The user corrected the agent's approach mid-task.
- A non-trivial workflow emerged that isn't captured anywhere.

Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active session record

Resolve this conversation through the supported task/thread reader or an explicit task export/state capsule. Use only the active project. If the provider cannot expose the record, write a tight digest from the current conversation and pass that instead. Do not scrape undocumented storage.

### 2. Spawn three reviewers in parallel

In one message, concurrently invoke `pstack-role-reflect-judgment`, `pstack-role-reflect-tooling`, and `pstack-role-reflect-divergent`. These profiles retain MCP access; their prompts forbid file writes and the parent applies edits.

| Lens | Native profile | Prompt template |
|---|---|---|
| Judgment | `pstack-role-reflect-judgment` | `references/judgment-reviewer.md` |
| Tooling | `pstack-role-reflect-tooling` | `references/tooling-reviewer.md` |
| Divergent | `pstack-role-reflect-divergent` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the supported session record or digest where marked. Reviewers return findings in the `native subagent capability` response body.

### 3. Synthesize

Invoke `pstack-role-reflect-synthesizer`. It retains MCP access for citation spot-checks but must not mutate. Use `references/synthesizer.md` verbatim with each reviewer's full output inlined where marked. It returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. The synthesizer already applies this criterion; this is a final pass before edits land. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org; do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Those are tracker submissions, not skill edits. Only the Accepted list waits for approval.

Before editing, classify the target. If it is under `~/.pstack/providers/codex/`, `dist/codex/`, or another installed/generated pstack path, do not edit it directly: propose the change against the canonical portable repository's generator or upstream snapshot and regenerate after review. A standalone user-authored skill at .agents/skills/ or ~/.agents/skills/ may be edited in its native scope.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to $pstack:author-skill skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `$pstack:author-skill` and run its description-optimization loop.
- `new skill via $pstack:author-skill: <kebab-name>`: hand creation to `$pstack:author-skill`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
