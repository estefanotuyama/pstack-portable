---
name: setup-pstack
description: Configure pstack's native per-role model and effort routing. Detects the active provider roster, validates every explicit route, writes sparse personal overrides, and compiles guarded native agent profiles.
---

# Setup pstack

Configure pstack for Codex. Model choices are always personal, even when the plugin is installed for a project. Defaults ship with the plugin. The user file stores deviations only at `~/.pstack/config/codex.json`.

## 1. Detect the effective runtime

Enumerate the model and effort pairs this signed-in runtime can actually launch. Prefer a native roster. If no roster exists, explain that verification requires one minimal real call per distinct model and effort pair, including cost, and ask before making those calls. Check the runtime model roster and the exact model/reasoning combinations accepted by this Codex host. Do not infer availability from documentation alone.

Never write an unconfirmed model. Never pick a closest model. If a previously configured model disappeared, stop and tell the user to rerun this skill.

## 2. Load and validate

Read the shipped `config/defaults/codex.json`, then merge `~/.pstack/config/codex.json` when it exists. The user file must have `schemaVersion: 1` and a sparse `roles` object. Unknown role IDs, unsupported effort values, and unavailable models are errors. `{"inheritParent": true}` is the only inheritance form.

Show the full effective mapping. Keep every workflow-specific panel slot separate. Ask whether to accept it or change named roles. Preserve all options; for multi-select or larger choice sets, use a compact numbered conversational prompt because `request_user_input` cannot represent arbitrary multi-select.

## 3. Write sparse overrides

Write only values that differ from the shipped defaults to `~/.pstack/config/codex.json`. Resetting a role deletes that key. Write atomically after all routes validate; a validation failure produces no writes.

## 4. Compile native profiles

Compile the effective mapping to Codex custom-agent TOML files under `~/.codex/agents/`. Every profile is named `pstack-role-<role>` and carries the exact model and effort. Read-only roles also carry native read-only permissions. Why and Reflect roles keep normal tool access with explicit no-mutation instructions so MCP-backed evidence remains available.

Run the guarded compiler through the installer-managed provider pointer:

`node ~/.pstack/providers/codex/runtime/compile-agents.mjs --provider codex --available-route <confirmed-slug> <confirmed-effort> [--available-route <confirmed-slug> <confirmed-effort> ...] --project <active-repo>`

Pass every distinct confirmed model and effort pair. The compiler validates the complete effective map before writing anything.

Managed files contain an ownership marker and payload hash. Refuse an unowned or locally modified target unless the user explicitly forces that exact file. Detect higher-priority profiles or environment settings that shadow the generated route and fail closed.

Tell the user to start a new task so Codex loads new agent profiles.

## 5. Check authoring and verification

Confirm that $skill-creator is available. If it is not, authoring workflows fail closed; core pstack remains usable.

If the current project has no real-surface verification skill, offer once to run $pstack:create-verification-skill. Verification skills are always project-scoped.

## Output

Report the effective role mapping, override path, compiled profile paths, exact pairs verified, collisions checked, and whether a new session is required.
