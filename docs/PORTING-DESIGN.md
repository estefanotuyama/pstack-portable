# Porting design

## Invariants

1. `upstream/pstack/` is an immutable, byte-for-byte snapshot of pstack 0.14.4.
2. A generated file is either copied exactly, transformed by a declared rule, omitted by a declared rule, or added by this port.
3. Provider-neutral source bytes are preserved. Provider bindings are replaced with native provider semantics, not renamed mechanically when the semantics differ.
4. Generated Claude Code and Codex packages contain no product-specific mechanics from the source provider. Benny and Grokbot are absent from both packages.
5. A failed source hash, missing exact replacement, unknown role, unavailable model, profile collision, or modified managed file stops generation or setup. Nothing silently substitutes a model or shrinks a requested fan-out.

## Mapping boundary

The stable public API is a set of semantic roles (`feature`, `how-explorer`, `arena-runner-1`, and so on). Provider defaults and sparse user overrides resolve each role to `{model, effort}`. Setup compiles the effective routes to native, named agent profiles. Skills invoke the stable names and do not embed model slugs. Panel slots stay workflow-specific, so changing an Arena runner does not unexpectedly change a How critic, Architect runner, or Interrogate reviewer.

This is deliberately compiled configuration rather than runtime prompt parsing:

- one place changes when a provider ships or retires a model;
- effort is carried by native agent configuration even where an invocation cannot set it;
- panels keep their cardinality and slot identity;
- read-only roles use provider-native permissions;
- the generated prompts stay close to upstream.

### Locked defaults

The JSON files under `config/defaults/` are the editable source of truth. Verification locks their full-file hashes so a model release is one reviewed mapping edit plus one explicit hash update, not prompt surgery.

Claude Code groups:

- `feature` and `refactoring`: Opus 5, xhigh.
- `bug-fix`, `perf-issue`, `hillclimb`, `hardest-precise`, `how-explainer`, `why-synthesizer`, and `reflect-tooling`: Opus 5, max.
- `judgment`, `prose`, `hardest-ambiguous`, `reflect-judgment`, `reflect-divergent`, and `reflect-synthesizer`: Fable 5, max.
- `how-explorer`, `why-investigator`, `swarm-worker`, and `verification-worker`: Sonnet 5, xhigh.
- How critics, Arena runners, Architect runners, and Interrogate reviewers: Fable max, Opus max, Sonnet xhigh, Opus xhigh.
- Arena judges use the same four slots.

Codex groups:

- `feature` and `refactoring`: Sol, xhigh.
- `bug-fix`, `perf-issue`, `hillclimb`, `judgment`, `prose`, both hardest roles, `how-explainer`, `why-synthesizer`, and all Reflect roles: Sol, max.
- `how-explorer`: Luna, xhigh.
- `why-investigator`, `swarm-worker`, and `verification-worker`: Terra, xhigh.
- How critics, Arena runners, Architect runners, and Interrogate reviewers: Sol max, Sol max, Terra xhigh, Sol xhigh.
- Arena judges: Terra xhigh, Sol max, Terra xhigh, Sol xhigh.

User overrides live outside projects:

- Claude Code: `~/.pstack/config/claude.json`
- Codex: `~/.pstack/config/codex.json`

They contain only deviations from the shipped defaults. Project plugin installation never commits a user's model choices. Each collaborator runs setup for their own account.

## Native profiles

Every semantic role compiles to `pstack-role-<role>`. Panel slots are separate profiles even when two defaults happen to use the same model. `inheritParent: true` omits model and effort. Strict read-only workflows compile from one canonical permission template. Why, Reflect, and verification roles retain evidence tools but receive a higher-priority no-mutation boundary.

Claude Code profiles are Markdown custom agents. Codex profiles are TOML custom agents. Both are guarded by an ownership marker and payload hash; setup refuses to overwrite an unowned or locally modified file unless the user explicitly forces that exact target.

## Provider behavior

| Source capability | Claude Code | Codex |
| --- | --- | --- |
| Skill invocation | `/pstack:<skill>` | `$pstack:<skill>` |
| Delegation | native `Agent` with named pstack profile | native subagent capability with named pstack profile |
| Structured question | `AskUserQuestion`, including multi-select | `request_user_input` for up to three exclusive questions; compact numbered conversation for larger or multi-select choices |
| Read-only reviewer | read-only tools and permission mode | read-only sandbox profile |
| Isolated implementation | local worktree isolation | local worktree task/subagent |
| Long run | `/goal` plus native `/loop` wake | `/goal`; desktop heartbeat in the current task or a local watcher in CLI/IDE |
| Interrupted local worker | checkpoint, then spawn a fresh worker from the checkpoint | checkpoint, then spawn a fresh worker from the checkpoint |
| Session evidence | documented active-project JSONL and its subagent records under `~/.claude/projects/` | desktop task reader, or explicit task ID/export/state capsule in CLI/IDE |
| Skill authoring | official `skill-creator:skill-creator` plugin skill | `$skill-creator` |

No hosted worker, cloud VM, provider dashboard, source-provider transcript directory, or source-provider review bot is emulated.

Five binary guide illustrations visibly encode the source provider's slash commands. They are omitted with explicit provenance rather than edited or relabeled; editing their pixels would break the byte-faithful boundary. The provider-neutral verification illustration is copied unchanged.

## Installation boundary

The repository is the unified source of truth, but both providers use native plugin discovery and cache installed plugin packages. The installer registers a native marketplace, activates the plugin in the requested provider scope, and creates only `~/.pstack/providers/<provider>` as a stable symlink for setup and bundled runtime scripts. Regeneration produces a deterministic provider-specific adapter version; rerunning the installer refreshes the native cache. No provider discovers skills through `.pstack/skills`.

Codex does not expose a project-scoped marketplace-registration flag. For project scope, the marketplace file, plugin pointer, and sticky `AGENTS.md` block live in the project, while the CLI's marketplace registration remains machine-level.

## Generated-skill ownership

Skills created by pstack are standalone provider-native skills. The author chooses project or personal scope; verification skills are project-only. pstack can compose with those skills, but it does not register them under a private `.pstack/skills` tree or copy them to other providers.

## Compatibility status

Static verification proves provenance, exact-copy bytes, declared transformations, manifests, schemas, links, and forbidden-mechanic absence. It does not prove behavioral equivalence of model outputs. Until behavior evals are explicitly run, releases are labeled `behavior-unverified`.
