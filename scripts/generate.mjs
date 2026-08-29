#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  UPSTREAM,
  PROVIDERS,
  compileAgents,
  listFiles,
  readJson,
  sha256,
  treeHash,
  writeFile,
} from "./lib.mjs";

const EXPECTED_TREE = readJson(path.join(ROOT, "PROVENANCE.json")).source.snapshotTreeSha256;
const actualTree = treeHash(UPSTREAM);
if (actualTree !== EXPECTED_TREE) {
  throw new Error(`upstream snapshot drifted: expected ${EXPECTED_TREE}, got ${actualTree}`);
}

const OMIT_PREFIXES = [".cursor-plugin/", "automations/benny/", "skills/grokbot/"];
const OMIT_FILES = new Set([
  "docs/guide/images/design.jpg",
  "docs/guide/images/overnight.jpg",
  "docs/guide/images/recipes.jpg",
  "docs/guide/images/router.jpg",
  "docs/guide/images/understanding.jpg",
]);
const TEXT_EXTENSIONS = new Set([".md", ".json", ".mjs", ".sh", ".ts", ".yaml", ".yml", ".lock"]);
const SKILLS = fs.readdirSync(path.join(UPSTREAM, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "grokbot")
  .map((entry) => entry.name)
  .sort();
const SOURCE_MODELS = [
  "claude-fable-5-thinking-max",
  "gpt-5.6-sol-max",
  "grok-4.6-fast-xhigh",
  "claude-opus-5-thinking-xhigh",
];

function omitted(relative) {
  return OMIT_FILES.has(relative) || OMIT_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

function omissionReason(relative) {
  if (relative.startsWith(".cursor-plugin/")) return "source-provider plugin metadata replaced by a provider-native manifest";
  if (relative.startsWith("automations/benny/")) return "Benny is a separate source plugin and outside the pstack-only port";
  if (relative.startsWith("skills/grokbot/")) return "Grokbot is source-provider-specific and has no provider-native equivalent in this port";
  if (OMIT_FILES.has(relative)) return "binary guide image visibly embeds source-provider slash-command syntax and cannot be adapted byte-faithfully";
  throw new Error(`${relative}: omitted without a declared reason`);
}

function providerInfo(provider) {
  if (provider === "claude") {
    return {
      display: "Claude Code",
      command: (skill) => `/pstack:${skill}`,
      skillProject: ".claude/skills",
      skillPersonal: "~/.claude/skills",
      question: "AskUserQuestion",
      delegate: "Agent",
      setup: "/pstack:setup-pstack",
      author: "/pstack:author-skill",
      creator: "/skill-creator:skill-creator",
      history: "Claude Code's documented project transcript under `~/.claude/projects/<project-key>/<session>.jsonl`, including that session's `<session-id>/subagents/` records",
    };
  }
  return {
    display: "Codex",
    command: (skill) => `$pstack:${skill}`,
    skillProject: ".agents/skills",
    skillPersonal: "~/.agents/skills",
    question: "request_user_input",
    delegate: "native subagent capability",
    setup: "$pstack:setup-pstack",
    author: "$pstack:author-skill",
    creator: "$skill-creator",
    history: "the supported task/thread reader or an explicit task export/state capsule",
  };
}

function adapterVersion(provider) {
  const inputs = [
    "scripts/generate.mjs",
    "scripts/lib.mjs",
    "scripts/compile-agents.mjs",
    "config/schema.json",
    `config/defaults/${provider}.json`,
  ];
  const digest = sha256(Buffer.concat([Buffer.from(`upstream\0${actualTree}\n`), ...inputs.flatMap((relative) => [Buffer.from(`${relative}\0`), fs.readFileSync(path.join(ROOT, relative))])])).slice(0, 12);
  return `0.14.4-portable.${provider}.${digest}`;
}

function replaceRequired(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`${label}: expected source text not found: ${JSON.stringify(from.slice(0, 100))}`);
  return text.replace(from, to);
}

function rewriteSkillCommands(text, provider) {
  const info = providerInfo(provider);
  for (const skill of SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(^|[\\s(\"'\\x60])/${escaped}(?=$|[\\s.,;:!?)\"'\\x60])`, "gm"), (_, prefix) => `${prefix}${info.command(skill)}`);
  }
  return text;
}

function rewriteFrontmatter(text, relative, provider) {
  if (relative.endsWith("SKILL.md") && provider === "codex") text = text.replace(/^disable-model-invocation: true\n/m, "");
  if (relative === "skills/poteto-mode/SKILL.md") {
    text = text
      .replace(/^name: Poteto Mode$/m, "name: poteto-mode")
      .replace(/^mode: .*\n/m, "")
      .replace(/^icon: crown\n/m, "")
      .replace(/^color: yellow\n/m, "")
      .replace(/^reminder: .*\n/m, "");
  }
  if (relative === "agents/poteto-agent.md" && provider === "claude") {
    text = text.replace(/^is_background: true$/m, "background: true");
  }
  if (relative === "agents/comment-sicko.md" && provider === "claude") {
    text = text.replace(/^name: Comment Sicko$/m, "name: comment-sicko");
  }
  return text;
}

function rewriteRouting(text, relative) {
  const roles = {
    "skills/architect/SKILL.md": "architect-runner",
    "skills/arena/SKILL.md": "arena-runner",
    "skills/how/SKILL.md": "how",
    "skills/interrogate/SKILL.md": "interrogate-reviewer",
    "skills/swarm/SKILL.md": "swarm-worker",
    "skills/why/SKILL.md": "why",
    "skills/reflect/SKILL.md": "reflect",
    "skills/poteto-mode/playbooks/feature.md": "feature",
    "skills/poteto-mode/playbooks/refactoring.md": "refactoring",
    "skills/poteto-mode/playbooks/bug-fix.md": "bug-fix",
    "skills/poteto-mode/playbooks/perf-issue.md": "perf-issue",
    "skills/poteto-mode/playbooks/hillclimb.md": "hillclimb",
    "skills/poteto-mode/playbooks/multi-phase-plan.md": "verification-worker",
  };

  const four = SOURCE_MODELS.map((model) => `\`${model}\``).join(", ");
  if (relative === "skills/arena/SKILL.md") {
    const runnerProfiles = [1, 2, 3, 4].map((n) => `\`pstack-role-arena-runner-${n}\``).join(", ");
    const judgeProfiles = [1, 2, 3, 4].map((n) => `\`pstack-role-arena-judge-${n}\``).join(", ");
    text = text.replace(four, runnerProfiles).replace(four, judgeProfiles);
    text = text.replaceAll("arena cross-judge pool", "arena judge profiles");
    text = text.replaceAll("Spawn all N subagents in one message with `run_in_background: true`", "Spawn all N named runner profiles concurrently in one message");
    text = text.replaceAll("Spawn one readonly judge subagent on that model", "Select a judge profile whose model family differs from the parent and spawn it read-only; if no configured judge differs, stop and rerun setup-pstack rather than silently weakening the cross-judge");
    text = text.replace(/3\. Pick the runners\.[\s\S]*?shared mutable state and fails the the/, "3. Pick the runners. Launch exactly N independent candidates. For candidate n, use `pstack-role-arena-runner-(((n - 1) mod 4) + 1)`; this cycles the four configured slots when N exceeds four without changing N. Two slots resolving to the same model are still independent runs. Ad hoc arms replace positions in that exact N, never add or remove candidates.\n4. Assign output paths. Each candidate writes to its own location (a caller-prepared git worktree at the intended base SHA where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`). Never reset or reuse a dirty shared checkout. N candidates writing to the same path is shared mutable state and fails the the");
    text = text.replace(/After all Phase B candidates complete, choose one model from[\s\S]*?reports them as dropouts\./,
      "After all Phase B candidates complete, select one of `pstack-role-arena-judge-1` through `pstack-role-arena-judge-4` whose configured model family differs from the parent's. If none differs, stop and rerun setup-pstack rather than silently weakening the cross-judge. Spawn it read-only after candidate writes finish. It sees the rubric and candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with the parent's Phase D reading. Starting it before candidates finish would expose partial outputs.");
    text = text.replace("If a candidate fails to produce output, proceed with N-1 and note the dropout in the synthesis record.", "If a candidate fails to produce output, respawn that position with the same semantic profile and brief. Continue only after exactly N candidate outputs exist; if the provider cannot produce N, fail closed and report the incompatibility instead of shrinking the arena.");
    text = text.replaceAll("the dropouts if any", "failed attempts and respawns if any");
  }
  if (relative === "skills/architect/SKILL.md") {
    text = text.replace(four, [1, 2, 3, 4].map((n) => `\`pstack-role-architect-runner-${n}\``).join(", "));
  }
  if (relative === "skills/how/SKILL.md") {
    text = text
      .replaceAll("your configured how-explorer model", "the `pstack-role-how-explorer` profile")
      .replaceAll("your configured how-explainer model", "the `pstack-role-how-explainer` profile")
      .replaceAll("your configured how-critics list", "the four `pstack-role-how-critic-<n>` profiles")
      .replace(four, [1, 2, 3, 4].map((n) => `\`pstack-role-how-critic-${n}\``).join(", "));
    text = text
      .replace(/- `subagent_type`: `generalPurpose`\n- `model`: the `pstack-role-how-explorer` profile \(default `[^`]+`\)\n- `readonly`: `true`/g, "- Native profile: `pstack-role-how-explorer` (read-only)")
      .replace(/- `subagent_type`: `generalPurpose`\n- `model`: the `pstack-role-how-explainer` profile \(default `[^`]+`\)\n- `readonly`: `true`/g, "- Native profile: `pstack-role-how-explainer` (read-only)")
      .replace(/For each critic:\n- `subagent_type`: `generalPurpose`\n- `model`: one model from the four `pstack-role-how-critic-<n>` profiles\.[\s\S]*?\n- `readonly`: `true`/, "For each critic, invoke one distinct `pstack-role-how-critic-1` through `pstack-role-how-critic-4` native read-only profile. If architecture warrants deeper analysis, use `pstack-role-hardest-ambiguous` explicitly and record the escalation.");
    text = text.replace(/For each critic:\n[\s\S]*?(?=\nRead `references\/critic-prompt\.md`)/,
      "For each critic, invoke one distinct `pstack-role-how-critic-1` through `pstack-role-how-critic-4` native read-only profile. If architecture warrants deeper analysis, use `pstack-role-hardest-ambiguous` explicitly and record the escalation.\n");
  }
  if (relative === "skills/interrogate/SKILL.md") {
    text = text.replace(/\| Reviewer A \| `[^`]+` \|\n\| Reviewer B \| `[^`]+` \|\n\| Reviewer C \| `[^`]+` \|\n\| Reviewer D \| `[^`]+` \|/, [
      "| Reviewer A | `pstack-role-interrogate-reviewer-1` |",
      "| Reviewer B | `pstack-role-interrogate-reviewer-2` |",
      "| Reviewer C | `pstack-role-interrogate-reviewer-3` |",
      "| Reviewer D | `pstack-role-interrogate-reviewer-4` |",
    ].join("\n"));
    text = text.replace(/For each reviewer:\n- `subagent_type`: `generalPurpose`\n- `model`: the configured `interrogate reviewers` entry, or the table default with no configured line\n- `readonly`: `true`/,
      "For each reviewer, invoke the corresponding `pstack-role-interrogate-reviewer-<n>` native read-only profile from the table.");
    text = text.replace(/If a model slug is rejected[\s\S]*?enter this fallback for them\.\n/, "If any configured reviewer profile is unavailable or resolves to a different model or effort, stop and direct the user to the setup-pstack skill. Never choose a closest model or silently substitute a route.\n");
    text = text.replace(/Launch all reviewers in a single message using [^.]+\. Use the `interrogate reviewers` list[\s\S]*?otherwise use the table defaults\./,
      "Launch `pstack-role-interrogate-reviewer-1` through `pstack-role-interrogate-reviewer-4` concurrently in one message. Keep all four independent runs even when two profiles resolve to the same model.");
  }
  if (relative === "skills/why/SKILL.md") {
    text = text
      .replaceAll("your configured why-investigators model", "the `pstack-role-why-investigator` profile")
      .replaceAll("your configured why-synthesizer model", "the `pstack-role-why-synthesizer` profile");
    text = text
      .replace(/Subagent config \(each\):\n- `subagent_type`: `generalPurpose`\n- `model`: the `pstack-role-why-investigator` profile \(default `[^`]+`\)\n- `readonly`: `false` \(agent mode\)\.[\s\S]*?That's a posture, not a sandbox\./,
        "Subagent config (each): invoke `pstack-role-why-investigator`. It keeps normal tool and MCP access, but the prompt forbids mutation. That is a posture, not a sandbox.")
      .replace(/- `subagent_type`: `generalPurpose`\n- `model`: the `pstack-role-why-synthesizer` profile \(default `[^`]+`\)\n- `readonly`: `false` \(agent mode\)\.[\s\S]*?defeats that\./,
        "- Native profile: `pstack-role-why-synthesizer`. It keeps normal tool and MCP access, but the prompt forbids mutation so citation spot-checks remain possible.");
  }
  if (relative === "skills/reflect/SKILL.md") {
    text = text
      .replaceAll("your configured reflect tooling model", "the `pstack-role-reflect-tooling` profile")
      .replaceAll("your configured reflect judgment model", "the `pstack-role-reflect-judgment` profile")
      .replaceAll("your configured reflect divergent model", "the `pstack-role-reflect-divergent` profile")
      .replaceAll("your configured reflect synthesizer model", "the `pstack-role-reflect-synthesizer` profile");
    text = text
      .replace(/One message, three `Task` calls,[\s\S]*?The prompt forbids file writes; the parent applies edits\./,
        "In one message, concurrently invoke `pstack-role-reflect-judgment`, `pstack-role-reflect-tooling`, and `pstack-role-reflect-divergent`. These profiles retain MCP access; their prompts forbid file writes and the parent applies edits.")
      .replace(/One `Task` call,[\s\S]*?The synthesizer returns a structured Accepted \/ Rejected \/ Backlog list\./,
        "Invoke `pstack-role-reflect-synthesizer`. It retains MCP access for citation spot-checks but must not mutate. Use `references/synthesizer.md` verbatim with each reviewer's full output inlined where marked. It returns a structured Accepted / Rejected / Backlog list.");
    text = text.replace(/\| Lens \| `model` \| Prompt template \|\n\|---\|---\|---\|\n\| Judgment \|[^\n]+\n\| Tooling \|[^\n]+\n\| Divergent \|[^\n]+/,
      "| Lens | Native profile | Prompt template |\n|---|---|---|\n| Judgment | `pstack-role-reflect-judgment` | `references/judgment-reviewer.md` |\n| Tooling | `pstack-role-reflect-tooling` | `references/tooling-reviewer.md` |\n| Divergent | `pstack-role-reflect-divergent` | `references/divergent-reviewer.md` |");
  }
  if (relative === "skills/swarm/SKILL.md") {
    text = text.replaceAll("your configured `swarm workers` model", "the `pstack-role-swarm-worker` profile");
    text = text
      .replaceAll("N is total workers, not the cloud concurrency limit", "N is the exact total requested; a provider runtime limit is surfaced as an error, never a reason to shrink N silently")
      .replaceAll("If a worker drops out, proceed with N-1 and note it.", "If a worker drops out, respawn that position with the same semantic profile and brief. Continue only after exactly N results exist; if the provider cannot produce N, fail closed instead of shrinking the swarm.")
      .replaceAll("explicit gaps or dropouts", "explicit gaps or failed-attempt records")
      .replaceAll("gaps or dropouts", "gaps or failed-attempt records")
      .replace(/Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the configured model\. Use `environment: "local"` only when the worker needs access to something on the user's computer\./,
        "Spawn all N `pstack-role-swarm-worker` profiles concurrently in one message. Mutating workers each use a local isolated worktree at the intended base SHA. A worker that needs machine-local state stays in the current checkout and must remain read-only unless it is the sole writer.");
    text = text.replace(/4\. Pick the worker model[\s\S]*?For a model race, name each arm's model up front\./,
      "4. Invoke `pstack-role-swarm-worker` for every ordinary worker. For an explicit model race, name each ad hoc arm's model and effort up front.");
  }
  if (relative === "skills/poteto-mode/SKILL.md") {
      text = text.replace(/\*\*Defaults for every `Task` call\.\*\*[\s\S]*?runs that role on the parent chat model \(omit Task `model`\)\./, "**Defaults for delegation.** Invoke the stable `pstack-role-<role>` native profile named by the active playbook. Setup compiles provider defaults plus sparse personal overrides into those profiles. Use `pstack-role-hardest-ambiguous` when intent is vague and judgment dominates, `pstack-role-hardest-precise` for a precisely specified difficult sequence, and the playbook's named role otherwise. Never embed or silently substitute a model. If a profile is missing or unavailable, stop and direct the user to the setup-pstack skill.");
    text = text.replace(/\*\*Use `subagent_type: "poteto-agent"`[\s\S]*?don't override to `poteto-agent`\./,
      "**Use the native `pstack:poteto-agent` delegate for any general subagent inside a playbook step.** Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) name their own semantic role profiles; respect those profiles rather than overriding them.");
  }

  const fallback = roles[relative];
  for (const model of SOURCE_MODELS) {
    if (!text.includes(model)) continue;
    let role = fallback;
    if (relative.includes("why")) role = model.includes("grok") ? "why-investigator" : "why-synthesizer";
    if (relative.includes("reflect")) role = model.includes("sol") ? "reflect-tooling" : "reflect-judgment";
    if (relative.includes("how")) role = model.includes("grok") ? "how-explorer" : model.includes("fable") ? "how-explainer" : "how-critic-4";
    if (!role) role = "configured-native-profile";
    text = text.replaceAll(model, `pstack-role-${role}`);
  }
  return text;
}

function rewriteWorktreeAudit(text) {
  text = replaceRequired(text,
    "# state, uncommitted work, remote/PR state, and the most recent chat that\n# operated in it. Emits a table sorted by size with a suggested bucket. Never",
    "# state, uncommitted work, and remote/PR state. Emits a table sorted by size\n# with a conservative suggested bucket. Never",
    "worktree-audit header");
  text = text.replace(/\n# Transcripts dir:[\s\S]*?now=\$\(date \+%s\)\n/, "\nnow=$(date +%s)\n");
  text = text.replace('printf "SIZE\\tAGE\\tMERGED\\tDIRTY\\tREMOTE\\tPR\\tLAST_CHAT\\tBUCKET\\tWORKTREE\\n"', 'printf "SIZE\\tAGE\\tMERGED\\tDIRTY\\tREMOTE\\tPR\\tBUCKET\\tWORKTREE\\n"');
  text = text.replace(/\n\t# Most recent chat[\s\S]*?recent=\$\([^\n]+\n/, "\n");
  text = text.replace(/\n\t\t\tif \[ "\$recent" = yes \]; then bucket=verify-recent-chat\n\t\t\telif \[ "\$merged" = YES \] \|\| \[ "\$pr" != "-" \]; then bucket=safe\n\t\t\telse bucket=review; fi ;;/, "\n\t\t\tif [ \"$merged\" = YES ] || [ \"$pr\" != \"-\" ]; then bucket=safe\n\t\t\telse bucket=review; fi ;;");
  text = text.replace('printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" \\\n\t\t"$size" "$age" "$merged" "$dirty" "$remote" "$pr" "$last" "$bucket" "$wt"', 'printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" \\\n\t\t"$size" "$age" "$merged" "$dirty" "$remote" "$pr" "$bucket" "$wt"');
  return text;
}

function removeReviewBotProtocol(text, relative) {
  if (relative === "skills/poteto-mode/scripts/watch-pr/types.ts") {
    return text.replace("  readonly isBugbot: boolean;\n  readonly bugbotReviewPasses: number;\n", "");
  }
  if (relative === "skills/poteto-mode/scripts/watch-pr/render.ts") {
    return text.replace("    `isBugBot=${thread.isBugbot}`,\n    `bugbotReviewPasses=${thread.bugbotReviewPasses}`,\n", "");
  }
  if (relative === "skills/poteto-mode/scripts/watch-pr/policy.ts") {
    return text.replace('  "bugbot",\n', "");
  }
  if (relative === "skills/poteto-mode/scripts/watch-pr/github.ts") {
    text = text.replace(/function isBugbot\([\s\S]*?\n}\nexport function parseReviewThreads/, "export function parseReviewThreads");
    text = text.replace(/\n  const keys = new Set<string>\(\);[\s\S]*?  return threads\n    \.filter\(\(thread\) => !thread\.resolved\)\n    \.map\(\(\{ id, firstComment \}\) => \(\{\n      id,\n      firstComment,\n      isBugbot: isBugbot\(firstComment\),\n      bugbotReviewPasses: passes,\n    \}\)\);/, "\n  return threads\n    .filter((thread) => !thread.resolved)\n    .map(({ id, firstComment }) => ({ id, firstComment }));");
    return text;
  }
  if (relative === "skills/poteto-mode/scripts/watch-pr/github.test.ts") {
    return text.replace(/\nit\("annotates Bugbot threads[\s\S]*?\n}\);\n\ndescribe\("context and stack discovery"/, '\ndescribe("context and stack discovery"');
  }
  return text;
}

function setupSkill(provider) {
  const info = providerInfo(provider);
  const native = provider === "claude"
    ? "Claude Code custom-agent Markdown files under `~/.claude/agents/pstack/`"
    : "Codex custom-agent TOML files under `~/.codex/agents/`";
  const probe = provider === "claude"
    ? "Check the runtime model roster, `availableModels`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_EFFORT_LEVEL`, and fallback settings. A conflicting override or disabled thinking is an incompatibility, not permission to substitute."
    : "Check the runtime model roster and the exact model/reasoning combinations accepted by this Codex host. Do not infer availability from documentation alone.";
  const authoring = provider === "claude"
    ? `Also check whether the official skill-creator plugin is installed. If ${info.creator} is unavailable, ask whether to install it. Declining blocks only authoring workflows.`
    : `Confirm that ${info.creator} is available. If it is not, authoring workflows fail closed; core pstack remains usable.`;
  return `---
name: setup-pstack
description: Configure pstack's native per-role model and effort routing. Detects the active provider roster, validates every explicit route, writes sparse personal overrides, and compiles guarded native agent profiles.
---

# Setup pstack

Configure pstack for ${info.display}. Model choices are always personal, even when the plugin is installed for a project. Defaults ship with the plugin. The user file stores deviations only at \`~/.pstack/config/${provider}.json\`.

## 1. Detect the effective runtime

Enumerate the model and effort pairs this signed-in runtime can actually launch. Prefer a native roster. If no roster exists, explain that verification requires one minimal real call per distinct model and effort pair, including cost, and ask before making those calls. ${probe}

Never write an unconfirmed model. Never pick a closest model. If a previously configured model disappeared, stop and tell the user to rerun this skill.

## 2. Load and validate

Read the shipped \`config/defaults/${provider}.json\`, then merge \`~/.pstack/config/${provider}.json\` when it exists. The user file must have \`schemaVersion: 1\` and a sparse \`roles\` object. Unknown role IDs, unsupported effort values, and unavailable models are errors. \`{"inheritParent": true}\` is the only inheritance form.

Show the full effective mapping. Keep every workflow-specific panel slot separate. Ask whether to accept it or change named roles. Preserve all options; for multi-select or larger choice sets, ${provider === "claude" ? "use `AskUserQuestion` with multi-select" : "use a compact numbered conversational prompt because `request_user_input` cannot represent arbitrary multi-select"}.

## 3. Write sparse overrides

Write only values that differ from the shipped defaults to \`~/.pstack/config/${provider}.json\`. Resetting a role deletes that key. Write atomically after all routes validate; a validation failure produces no writes.

## 4. Compile native profiles

Compile the effective mapping to ${native}. Every profile is named \`pstack-role-<role>\` and carries the exact model and effort. Read-only roles also carry native read-only permissions. Why and Reflect roles keep normal tool access with explicit no-mutation instructions so MCP-backed evidence remains available.

Run the guarded compiler through the installer-managed provider pointer:

\`node ~/.pstack/providers/${provider}/runtime/compile-agents.mjs --provider ${provider} --available-route <confirmed-slug> <confirmed-effort> [--available-route <confirmed-slug> <confirmed-effort> ...] --project <active-repo>\`

Pass every distinct confirmed model and effort pair. The compiler validates the complete effective map before writing anything.

Managed files contain an ownership marker and payload hash. Refuse an unowned or locally modified target unless the user explicitly forces that exact file. Detect higher-priority profiles or environment settings that shadow the generated route and fail closed.

${provider === "claude" ? "If this creates the agents directory for the first time, tell the user to start a new session before using pstack." : "Tell the user to start a new task so Codex loads new agent profiles."}

## 5. Check authoring and verification

${authoring}

If the current project has no real-surface verification skill, offer once to run ${info.command("create-verification-skill")}. Verification skills are always project-scoped.

## Output

Report the effective role mapping, override path, compiled profile paths, exact pairs verified, collisions checked, and whether a new session is required.
`;
}

function authorSkill(provider) {
  const info = providerInfo(provider);
  const explicit = provider === "claude" ? "disable-model-invocation: true\n" : "";
  return `---
name: author-skill
description: Author or update a standalone provider-native skill through the provider's official skill creator. Asks for project or personal scope and never writes under .pstack/skills or another provider.
${explicit}---

# Author a skill

1. Determine whether this is a new skill or an update. Preserve the existing scope when updating unless the user explicitly changes it.
2. Ask whether a new general skill belongs in project or personal scope. Verification skills are always project-scoped.
3. Delegate the complete authoring job to ${info.creator}. Do not copy or reinterpret its authoring contract.
4. Install only in the active provider: \`${info.skillProject}/<name>/\` for project scope or \`${info.skillPersonal}/<name>/\` for personal scope.
5. Keep the skill standalone. It may tell delegated agents to load it when composition matters, but pstack does not register it in a private skill tree or fan it out to other providers.
6. If ${info.creator} is unavailable, stop with the exact missing capability. Do not hand-roll a replacement.
`;
}

function rewriteSourceDependencies(text) {
  return text
    .replaceAll("the `deslop` skill from the `cursor-team-kit` plugin (`/deslop`)", "an inline code-cleanup pass")
    .replaceAll("`/deslop` from `cursor-team-kit`", "an inline code-cleanup pass")
    .replaceAll("`/deslop`", "an inline code-cleanup pass")
    .replaceAll("`control-cli` or `control-ui` from `cursor-team-kit`", "the installed terminal, browser, or app control capability")
    .replaceAll("`control-ui` or `control-cli` from `cursor-team-kit`", "the installed browser, app, or terminal control capability")
    .replaceAll("`control-ui` from `cursor-team-kit`", "the installed browser or app control capability")
    .replaceAll("`control-cli` from `cursor-team-kit`", "the installed terminal control capability")
    .replaceAll("`control-cli` (CLIs and TUIs) and `control-ui` (browser / Electron / web UIs)", "installed terminal control for CLIs and TUIs, and installed browser or app control for browser, Electron, and web UIs")
    .replaceAll("`control-ui` (browser / Electron / web UIs) and `control-cli` (CLIs and TUIs)", "installed browser or app control for browser, Electron, and web UIs, and installed terminal control for CLIs and TUIs")
    .replaceAll("`cursor-team-kit` publishes ", "Use ")
    .replaceAll("cursor-team-kit publishes ", "Use ")
    .replaceAll("from `cursor-team-kit`", "from an installed real-surface capability");
}

function adaptMarkdown(text, relative, provider) {
  const info = providerInfo(provider);
  text = rewriteFrontmatter(text, relative, provider);
  text = rewriteRouting(text, relative);
  text = rewriteSourceDependencies(text);
  text = rewriteSkillCommands(text, provider);

  const projectSkills = info.skillProject;
  const personalSkills = info.skillPersonal;
  text = text
    .replaceAll("~/.cursor/rules/pstack-models.mdc", `~/.pstack/config/${provider}.json`)
    .replaceAll(".cursor/skills", projectSkills)
    .replaceAll("~/.cursor/skills", personalSkills)
    .replaceAll("Cursor's built-in `create-skill`", info.creator)
    .replaceAll("Cursor's built-in for authoring SKILL.md files", info.creator)
    .replaceAll("Cursor's built-in babysit skill", `${info.display}'s unrelated built-in babysit capability`)
    .replaceAll("`create-skill`", `\`${info.creator}\``)
    .replaceAll("create-skill", info.creator)
    .replaceAll("`AskQuestion`", `\`${info.question}\``)
    .replaceAll("AskQuestion", info.question)
    .replaceAll("using the Task tool", `using ${info.delegate}`)
    .replaceAll("through the Task tool", `through ${info.delegate}`)
    .replaceAll("Task subagent", "native subagent")
    .replaceAll("Task calls", "native subagent launches")
    .replaceAll("Task call", "native subagent launch")
    .replaceAll("`Task`", `\`${info.delegate}\``)
    .replaceAll("Task tool", info.delegate)
    .replaceAll("Bugbot", "automated review")
    .replaceAll("BugBot", "automated review")
    .replaceAll("bugbot", "automated-review")
    .replaceAll("references/automated-review-triage.md", "references/automated-review-triage.md")
    .replaceAll("environment: \"cloud\"", provider === "claude" ? "isolation: \"worktree\"" : "local isolated worktree")
    .replaceAll("cloud_base_branch", "starting branch")
    .replaceAll("cloud agent", "isolated local worker")
    .replaceAll("cloud agents", "isolated local workers")
    .replaceAll("cloud worker", "isolated local worker")
    .replaceAll("cloud workers", "isolated local workers")
    .replaceAll("cloud VM", "local worktree")
    .replaceAll("cloud VMs", "local worktrees")
    .replaceAll("cloud root", "local coordinator")
    .replaceAll("cloud-sleeper", "checkpoint watcher")
    .replaceAll("Cursor dashboard", `${info.display} task state`)
    .replaceAll("Cursor restart", `${info.display} restart`)
    .replaceAll("restart Cursor", `restart ${info.display}`)
    .replaceAll("Cursor isolated local worker", "isolated local worker")
    .replaceAll("Cursor's `/loop` command", provider === "claude" ? "Claude Code's native `/loop` command" : "an armed `/goal` plus a Desktop heartbeat or local CLI/IDE watcher")
    .replaceAll("@cursor-skill/poteto-mode-tools", "@pstack/poteto-mode-tools")
    .replaceAll("https://github.com/cursor/plugins/tree/main/pstack", "the upstream pstack source")
    .replaceAll("https://github.com/cursor/plugins", "the upstream plugin repository");

  if (provider === "codex") {
    text = text
      .replaceAll('`subagent_type`: `generalPurpose`', "use the named native pstack profile")
      .replaceAll('`subagent_type`: `poteto-agent`', "use the native pstack poteto delegate")
      .replaceAll('`subagent_type: "poteto-agent"`', "the native pstack poteto delegate")
      .replaceAll('`subagent_type: "Comment Sicko"`', "the native pstack comment-sicko delegate")
      .replaceAll("`subagent_type`", "native profile")
      .replaceAll('`readonly`: `true`', "the profile is read-only")
      .replaceAll('`readonly`: `false` (agent mode)', "the profile keeps normal tool access but must not mutate")
      .replaceAll("readonly/Ask mode", "a strict read-only sandbox")
      .replaceAll("readonly strips MCP", "a strict read-only sandbox can remove MCP access")
      .replaceAll("Readonly/Ask mode", "A strict read-only sandbox")
      .replaceAll("readonly", "read-only");
  } else {
    text = text
      .replaceAll('`readonly`: `true`', "use the compiled read-only profile")
      .replaceAll('`readonly`: `false` (agent mode)', "use the compiled MCP-capable no-mutation profile")
      .replaceAll("readonly/Ask mode", "the strict read-only profile")
      .replaceAll("readonly strips MCP", "the strict read-only profile can remove MCP access")
      .replaceAll("Readonly/Ask mode", "The strict read-only profile");
  }

  text = text.replace(/The system prompt names the workspace's `agent-transcripts\/` directory\.[\s\S]*?reads private chats from unrelated projects\./g,
    `Use only ${info.history} for the active project. Do not scan undocumented provider storage or unrelated projects.`);
  text = text.replace(/Transcripts live at `[^`]+`\.[\s\S]*?unrelated projects\./g,
    `Use only ${info.history} for the active project. Never scrape provider storage or cross project boundaries.`);
  text = text.replace(/Locate the active workspace's transcripts before fanning out\.[\s\S]*?reads private chats from unrelated projects\./g,
    `Resolve the active project's history through ${info.history} before fanning out. Do not inspect undocumented storage or unrelated projects.`);

  if (relative === "skills/recall/SKILL.md") {
    text = text.replace(/Transcripts live at `[^\n]+\n/, `Resolve chat history through ${info.history}. Scope it to the active project and requested time window. If that surface is unavailable, disclose the gap and continue from live state and the shared record; never scrape undocumented storage.\n`);
    text = text.replaceAll("searching transcripts is grunt work", "searching project history is grunt work");
    text = text.replaceAll("The raw transcripts stay in the subagents.", "The raw history stays in the subagents.");
    text = text.replaceAll("read the full transcript", "read the full supported session record");
    text = text.replace(/3\. Fan out across your chat history\.[\s\S]*?4\. Sweep the shared record/, `3. Fan out across your chat history. Invoke \`pstack-role-how-explorer\` for each slice of records exposed by ${info.history}. Split by native IDs and timestamps, not guessed filenames, UUID ordering, or undocumented storage. Give each explorer only its supported record slice and ask for the same schema: topic, user goal, decisions, open threads, struggles and corrections, and artifacts, all citing native record IDs. For one or two records, read them directly. The parent keeps only the findings.\n4. Sweep the shared record`);
  }
  if (relative === "skills/reflect/SKILL.md") {
    text = text.replace(/### 1\. Locate the active transcript[\s\S]*?### 2\. Spawn three reviewers in parallel/, `### 1. Locate the active session record\n\nResolve this conversation through ${info.history}. Use only the active project. If the provider cannot expose the record, write a tight digest from the current conversation and pass that instead. Do not scrape undocumented storage.\n\n### 2. Spawn three reviewers in parallel`);
    text = text.replaceAll("transcript path or digest", "supported session record or digest");
    text = text.replaceAll("the transcript", "the session record");
    text = text.replace("For each approved Accepted item, follow the Routing field exactly:", `Before editing, classify the target. If it is under \`~/.pstack/providers/${provider}/\`, \`dist/${provider}/\`, or another installed/generated pstack path, do not edit it directly: propose the change against the canonical portable repository's generator or upstream snapshot and regenerate after review. A standalone user-authored skill at ${info.skillProject}/ or ${info.skillPersonal}/ may be edited in its native scope.\n\nFor each approved Accepted item, follow the Routing field exactly:`);
  }
  if (relative === "skills/show-me-your-work/SKILL.md") {
    text = text.replace(/At the end of the run, before handing back, check the log told the truth\. Read this run's transcript[\s\S]*?Walk the log against what actually happened:/,
      `At the end of the run, before handing back, check the log told the truth. Resolve this run through ${info.history}. If the record is unavailable, the audit fails closed: report that evidence is missing and do not claim the trail is complete. Never scrape undocumented storage. Walk the log against what actually happened:`);
    text = text.replaceAll("the run's transcript", "the supported run record");
    text = text.replaceAll("in the transcript", "in the supported run record");
    text = text.replace("Before handing back, you must spawn a subagent on a different model family from the one that did the work.", "Before handing back, select `pstack-role-arena-judge-1` through `pstack-role-arena-judge-4` whose configured model family differs from the one that did the work, then spawn that profile. If none differs, stop and rerun setup-pstack rather than silently self-reviewing.");
  }
  if (relative === "skills/poteto-mode/playbooks/eval.md") {
    text = text.replace(/6\. \*\*Verify the chain from transcripts, not self-report\.\*\*[\s\S]*?candidate's own claims\./,
      `6. **Verify the chain from the supported session record, not self-report.** Resolve each run through ${info.history}. If any record is unavailable, the evidence-critical eval fails closed. Never scrape undocumented storage. Grade chain-following from the files it really read plus the shape of the code, never from the candidate's own claims.`);
  }
  if (relative === "skills/poteto-mode/playbooks/session-pickup.md") {
    text = text
      .replaceAll(", a cloud-agent URL handoff", "")
      .replace(/1\. Locate the prior trail\.[\s\S]*?\(the \*\*principle-guard-the-context-window\*\* skill\)\./,
        `1. Locate the prior trail through ${info.history}, an explicit state capsule, or a pushed branch. Read the overview and last messages first, then scan back for decision points. If no supported record or explicit capsule is available, fail closed rather than guessing the resume point. Parse a long record in a subagent and keep the reduced timeline in the main thread (the **principle-guard-the-context-window** skill).`);
  }
  if (relative === "skills/automate-me/SKILL.md") {
    text = text.replace(/Survey recent agent conversations within that scope for recurring patterns\. Run multiple parallel subagents across slices of history \(e\.g\. last 2-4 weeks, split into 3 slices so each has enough material\)\. Each slice mining subagent reads transcripts from the workspace-scoped path the parent provides, looks for the signals below, and returns a short structured list of patterns it saw with evidence pointers\./,
      `Survey recent records within that scope for recurring patterns. Invoke \`pstack-role-how-explorer\` across 3 supported slices from ${info.history}, divided by native timestamps and IDs. Give each explorer only its slice, the signals below, and a request for a short structured list with native evidence pointers. Do not infer filenames, scan undocumented storage, or cross project boundaries.`);
    if (provider === "claude") {
      text = text.replace(/Mining misses intent that hasn't come up yet\. Use the `AskUserQuestion` tool \(structured multi-choice\) rather than asking the user to type from scratch\. Lower cognitive load, higher hit rate\./,
        "Mining misses intent that hasn't come up yet. Use `AskUserQuestion` for the structured rounds. Keep each call to one or two questions; every question must have 2-4 options. Set `multiSelect: true` for category questions.");
      text = text.replace(/Shape: one or two questions with 4-6 options each, `allow_multiple: true` for category questions\. Start broad \("Which areas matter most\?"\), then follow up on selected areas with specific options\./,
        "Preserve every conceptual option. When a round has 4-6 choices, split them across sequential questions with 2-4 options each; do not merge or drop choices. Start broad (\"Which areas matter most?\"), then follow up on selected areas with specific options.");
    } else {
      text = text.replace(/Mining misses intent that hasn't come up yet\. Use the `request_user_input` tool \(structured multi-choice\) rather than asking the user to type from scratch\. Lower cognitive load, higher hit rate\./,
        "Mining misses intent that hasn't come up yet. For category multi-select, use a compact numbered conversational prompt because `request_user_input` cannot preserve arbitrary multi-select semantics. List every option and ask the user to reply with all selected numbers.");
      text = text.replace(/Shape: one or two questions with 4-6 options each, `allow_multiple: true` for category questions\. Start broad \("Which areas matter most\?"\), then follow up on selected areas with specific options\./,
        "Shape: one or two numbered rounds with all 4-6 options preserved. Start broad (\"Which areas matter most?\"), then follow up on selected areas with specific options. Never coerce this into a single-choice tool call.");
    }
    text = text.replace("Work in a worktree off main. Commit and open a PR so the user can review it. Don't push to main directly.",
      `For a project-scoped skill, use a caller-prepared worktree or branch at the intended base SHA, commit, and open a PR for review. Never reset or reuse a dirty shared checkout. For a personal skill, write the approved draft to ${info.skillPersonal}/<handle>-mode/ and do not create a repository PR unless that personal skill directory is already version-controlled or the user explicitly asks.`);
  }
  if (relative === "skills/create-verification-skill/SKILL.md") {
    text = text.replace("## 2. Generate the skill\n\nWrite", `## 2. Generate the skill\n\nInvoke ${info.author} with project scope and pass it the complete grounded structure below. The authoring skill owns native structure and validation; this workflow owns the repo interview, feature map, and live proof. Do not bypass the authoring skill.\n\nWrite`);
  }
  if (relative === "skills/why/SKILL.md") {
    text = text.replace(/Before spawning investigators, list the available MCPs from the .*? environment\. Use the available-tools map when present\. Otherwise inspect the `mcps\/` directory .*? exposes for enabled MCP servers\./,
      "Before spawning investigators, enumerate only the provider's native available-tool and resource catalog. Do not infer connectors from undocumented directories or storage.");
  }
  if (relative.startsWith("skills/reflect/references/")) {
    text = text.replaceAll("plugin-installed paths under `~/.cursor/plugins/`", "provider-installed plugin locations");
    text = text.replaceAll("`Task` prompts", "native subagent prompts");
  }
  if (relative === "skills/poteto-mode/playbooks/orchestrate.md") {
    text = text.replace(/- \*\*Worker \/ verifier\.\*\*[\s\S]*?Run a unit's verifier on a different model family from its worker\./,
      `- **Worker / verifier.** All work is local. Give every mutating worker its own branch or worktree at the intended base SHA. A task that needs this machine stays in the current checkout: real-surface verification, simulators, local IDE state, or machine-local authentication. Briefs inline what workers need or point at repository paths. Prefer fewer, broader workers; one writer per worktree or branch (principle-separate-before-serializing-shared-state). Run a unit's verifier on a different model family from its worker when the configured roster permits it.`);
    text = text
      .replaceAll("Every spawn and every resume carries the standing orders verbatim.", "Every spawn and every fresh respawn carries the standing orders verbatim.")
      .replaceAll("Agents are spawned, resumed, and drained only through the Agent tool.", "Agents are spawned, observed, and freshly respawned only through the provider's native subagent capability.")
      .replaceAll("Agents are spawned, resumed, and drained only through native subagent capability.", "Agents are spawned, observed, and freshly respawned only through the provider's native subagent capability.")
      .replaceAll("Agents are spawned, resumed, and drained only through Agent.", "Agents are spawned, observed, and freshly respawned only through the provider's native subagent capability.")
      .replaceAll("State reads and writes go through `scripts/orch/orch.ts`", `State reads and writes go through \`~/.pstack/providers/${provider}/skills/poteto-mode/scripts/orch/orch.ts\``)
      .replaceAll("(nesting works to depth 3, and a nested spawn has the full Agent schema including `environment`)", "(native nested spawning may be used only when the active runtime confirms it)")
      .replaceAll("(nesting works to depth 3, and a nested spawn has the full native delegation capability including `environment`)", "(native nested spawning may be used only when the active runtime confirms it)")
      .replaceAll("(nesting works to depth 3, and a nested spawn has the full Task schema including `environment`)", "(native nested spawning may be used only when the active runtime confirms it)")
      .replaceAll("Create `orchestrate/<project-slug>/` in the current agent's store (path in the system prompt).", `Create \`~/.pstack/state/${provider}/<project-slug>/orchestrate/\` as the durable store.`)
      .replaceAll("Use `bun scripts/orch/orch.ts` for bookkeeping", `Use \`bun ~/.pstack/providers/${provider}/skills/poteto-mode/scripts/orch/orch.ts\` for bookkeeping`)
      .replaceAll("Paste it verbatim into every spawn and every resume", "Paste it verbatim into every spawn and every fresh respawn")
      .replaceAll("directives decay across resumes", "directives decay across fresh respawns")
      .replaceAll("verbatim paste is for every fresh spawn and resume", "verbatim paste is for every fresh spawn and respawn")
      .replaceAll("A sub-coordinator brief adds its track boundary and unit list, its exact requested fan-out and the machine-local exception list", "A sub-coordinator brief adds its track boundary and unit list, its exact requested fan-out")
      .replaceAll("(arm it via the loop skill, with a long heartbeat fallback)", provider === "claude" ? "(arm it with Claude Code's native `/loop` and a long heartbeat fallback)" : "(arm `/goal` and use a Desktop heartbeat or local CLI/IDE watcher with a long fallback interval)")
      .replaceAll("the isolated local worker's status in the Claude Code task state", "the provider's native agent-status surface or persisted branch, PR, ledger, and store artifacts")
      .replaceAll("the isolated local worker's status in the Codex task state", "the provider's native agent-status surface or persisted branch, PR, ledger, and store artifacts")
      .replaceAll("tool-error, retry on a different model", "tool-error, retry the same semantic profile; change the configured mapping only through setup-pstack with an explicit decision")
      .replaceAll("Work that exists only on one VM when that VM dies was never done.", "Work that exists only in one ephemeral worker or worktree when it disappears was never done.")
      .replaceAll("The dead session's store lock clears itself on the next write; `orch` replaces a lock whose holder pid is gone.", "On restart, recompute from durable state and spawn fresh workers from stored briefs. Never resume or reattach by agent ID. `orch` replaces a stale lock whose holder PID is gone on the next write.");
    text = text.replace(/- After a .*? restart:[\s\S]*?`orch` replaces a stale lock whose holder PID is gone on the next write\./,
      "- After a provider restart, all unfinished workers are dead. Re-read the standing orders and `units.tsv`, recompute the frontier, reconcile persisted work by PR and branch, and spawn fresh sub-coordinators and workers from stored briefs. Never resume or reattach by agent ID. `orch` replaces a stale lock whose holder PID is gone on the next write.");
  }
  if (relative === "skills/poteto-mode/playbooks/opening-a-pr.md") {
    text = text
      .replace(/\*\*Worktree\.\*\*[\s\S]*?\n\n\*\*Commits\.\*\*/, "**Worktree.** Every mutating delegate receives a caller-prepared local worktree or branch at the intended base SHA. Never assume the provider creates isolation, never reset a dirty or shared checkout, and never overwrite unrelated work. If safe isolation is unavailable, stop and report the collision.\n\n**Commits.**")
      .replaceAll("such as `control-cli`, `control-ui`, or the targeted tests", "such as an installed terminal, browser, or app control capability, or the targeted tests");
  }
  if (["skills/poteto-mode/playbooks/autopilot-full.md", "skills/poteto-mode/playbooks/autopilot-stack.md"].includes(relative)) {
    const wake = provider === "claude"
      ? "Arm each audit tick with Claude Code's native `/loop` under the active `/goal`, using a long heartbeat fallback."
      : "Keep `/goal` armed and schedule each audit tick with a Desktop heartbeat in this task or a local CLI/IDE watcher, using a long fallback interval.";
    text = text.replace(/A local root arms each tick as a real terminal `\/loop`\.[\s\S]*?Never leave the cadence to memory or lossy completion notifications\./,
      `${wake} Never leave the cadence to memory or lossy completion notifications.`);
    text = text.replace(/re-read this playbook from trunk with `git show origin\/main:pstack\/skills\/poteto-mode\/playbooks\/(autopilot-(?:full|stack))\.md`/,
      (_, playbook) => `re-read \`~/.pstack/providers/${provider}/skills/poteto-mode/playbooks/${playbook}.md\``);
    text = text.replaceAll("Probe each owner with a generic liveness or status check", "Inspect each owner through the provider's native agent-status surface and durable branch, PR, check, ledger, and store evidence");
  }
  if (relative === "skills/poteto-mode/playbooks/multi-phase-plan.md") {
    text = text
      .replaceAll("the agent store's `docs/`", `\`~/.pstack/state/${provider}/<project-slug>/docs/\``)
      .replaceAll("`git show origin/main:pstack/skills/poteto-mode/playbooks/<execution playbook>.md`", `\`~/.pstack/providers/${provider}/skills/poteto-mode/playbooks/<execution playbook>.md\``)
      .replaceAll("`git show origin/main:pstack/skills/swarm/SKILL.md`", `\`~/.pstack/providers/${provider}/skills/swarm/SKILL.md\``)
      .replaceAll("`git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`", `\`~/.pstack/providers/${provider}/skills/poteto-mode/playbooks/opening-a-pr.md\``)
      .replaceAll("`git show origin/main:pstack/skills/<each other leaf skill the program uses>`", `\`~/.pstack/providers/${provider}/skills/<each other leaf skill the program uses>\``)
      .replaceAll("`node pstack/skills/poteto-mode/scripts/check-plan.mjs <plan.md>`", `\`node ~/.pstack/providers/${provider}/skills/poteto-mode/scripts/check-plan.mjs <plan.md>\``);
  }
  if (relative === "skills/poteto-mode/playbooks/worktree-cleanup.md") {
    text = text.replace(/1\. Snapshot and audit\.[\s\S]*?so background it\./,
      "1. Snapshot and audit. Record `df -h /`, then run `scripts/worktree-audit.sh` (principle-build-the-lever). It reads paths from `git worktree list`, never hand-types them, and classifies each worktree by size, age, merge state, uncommitted work, and PR state. It does not inspect chat history. Its conservative bucket is advice, not deletion permission.");
    text = text.replace(/2\. The bucket is advice[\s\S]*?the pinned set wins\./,
      "2. The bucket is advice, not permission. Ask the user for any active or pinned task that may own a candidate and cross-check its branch and worktree. If ownership cannot be established, keep the worktree.");
    text = text.replace(/3\. Verify usage before deleting\.[\s\S]*?hit the sidebar\./,
      "3. Verify usage before deleting. For anything you doubt, inspect git state, PR state, and the explicit task or state capsule the user supplied. Absence of supported history is never evidence that deletion is safe.");
    text = text.replaceAll("`~/Library/Application Support/Cursor` (`state.vscdb.backup`, and `snapshots/roots/<root>` where a `<root>` named for a folder you opened as a workspace balloons); ", "");
  }

  if (relative === "README.md") {
    text = text
      .replace("i'm [poteto](https://x.com/poteto). i'm not a president or ceo, but i've worked with millions of lines of code at Meta, Netflix, and Cursor. i'm also on the react core team where i help build and maintain react compiler.", "i'm [poteto](https://x.com/poteto). i'm not a president or ceo, but i've worked with millions of lines of code at Meta and Netflix. i'm also on the react core team where i help build and maintain react compiler.")
      .replace("these are the same skills i use everyday to ship high quality code at Cursor. this turns cursor into a real engineering team.", `these are the same skills i use everyday to ship high quality code. this turns ${info.display} into a real engineering team.`)
      .replace(/^.*make-bot-ui.*\n/gm, "")
      .replace(/\n## automations[\s\S]*?(?=\n## license)/, "")
      .replace(/\n## install[\s\S]*?(?=\n## get started)/,
        `\n## install\n\nfrom the portable repository, run \`node scripts/install.mjs --provider ${provider}\`. the installer asks for native scope and refuses unmanaged collisions.\n`)
      .replace(/\n## not shipped here[\s\S]*?(?=\n## why are there no planning skills\?)/,
        `\n## native dependencies\n\ncode cleanup is an inline outcome: remove narrating comments, unsupported guards, dead compatibility paths, and unrelated edits. real-surface verification uses an installed browser, app, terminal, or simulator capability. absence is an explicit verification risk, never a reason to pretend the surface was tested. skill authoring routes through ${info.author}.\n`)
      .replaceAll('[`subagent_type: "poteto-agent"`](./agents/poteto-agent.md)', "the native `pstack:poteto-agent` delegate")
      .replaceAll('`subagent_type: "Comment Sicko"`', "the native `pstack:comment-sicko` delegate")
      .replaceAll("a read-only comment reviewer", "a comment-only reviewer")
      .replaceAll("cursor's `/loop` command", provider === "claude" ? "Claude Code's native `/loop` command" : "an armed `/goal` plus a Desktop heartbeat or local CLI/IDE watcher")
      .replaceAll("cursor already has", `${info.display} already has`)
      .replaceAll("this turns cursor into", `this turns ${info.display} into`)
      .replaceAll("cursor gives you", `${info.display} gives you`)
      .replace(/out of the box the mode splits work by model strength:[\s\S]*?changes any of it\./,
        `out of the box the mode routes each job through a named native profile. ${info.setup} shows and changes the provider-specific model and effort behind every role.`)
      .replace(/\bcursor\b/gi, info.display);
    if (provider === "codex") {
      text = text.replace(/\n## the `poteto-agent` and Comment Sicko subagents[\s\S]*?(?=\n## principles)/,
        "\n## the `poteto-agent` and Comment Sicko subagents\n\npstack setup installs two guarded standalone Codex agent profiles: `pstack-poteto-agent` for full playbook delegation and `pstack-comment-sicko` for comment-only cleanup. the plugin does not register custom agents itself. invoke them through the pstack workflows, usually `$pstack:poteto-mode` and `$pstack:no-comments`.\n");
    }
  }
  if (relative === "docs/guide/01-setup.md") {
    text = text
      .replace(/In a Cursor chat, run:\n\n```text\n\/add-plugin pstack\n```\n\nCursor confirms the plugin is installed\./,
        `From the portable repository, run:\n\n\`\`\`text\nnode scripts/install.mjs --provider ${provider}\n\`\`\`\n\nThe installer asks for native scope, registers only ${info.display}, and refuses unmanaged collisions.`)
      .replace(/\[.*?setup-pstack.*?\]\(\.\.\/\.\.\/skills\/setup-pstack\/SKILL\.md\)[\s\S]*?(?=\n## Accept the verification offer)/,
        `[${info.setup}](../../skills/setup-pstack/SKILL.md) detects the effective model roster, shows every semantic role and panel slot, and validates the exact model and effort pair behind each native profile. It writes only deviations to \`~/.pstack/config/${provider}.json\`, then compiles guarded personal agent profiles. A missing line keeps the shipped default. Resetting a role deletes its override.\n\nUse \`{"inheritParent": true}\` when a role should inherit the parent model. An unavailable model, unsupported effort, higher-priority collision, or runtime override stops setup. pstack never picks a closest model or silently reduces a panel or swarm.`);
    text = text.replace("After setup, start a new chat. The model rule applies to new sessions.", provider === "claude"
      ? "After setup, start a new session so Claude Code loads the compiled profiles."
      : "After setup, start a new task so Codex loads the compiled profiles.");
  }
  if (provider === "codex" && relative === "docs/guide/05-build-and-clean.md") {
    text = text.replace("../../agents/comment-sicko.md", "../../runtime/agents/pstack-comment-sicko.toml");
  }
  if (relative === "docs/guide/05-build-and-clean.md") {
    text = text.replace("an inline code-cleanup pass ships in the `cursor-team-kit` plugin, not in pstack. If you don't have it, ask for the same outcome in plain words:", "The inline pass means:");
  }

  text = text.replace(/^!\[[^\n]*\]\(\.\/images\/(?:design|overnight|recipes|router|understanding)\.jpg\)\n*/gm, "");

  text = text.replaceAll("cursor location", "caret location");
  text = text.replaceAll("~/.cursor/plugins/", "provider-installed plugin locations/");
  text = text.replaceAll(".cursor/worktrees/", "provider-managed worktrees/");
  text = text.replaceAll("agent-transcripts/", "supported session history/");
  text = text.replaceAll("~/.cursor/projects/*/", "undocumented provider storage/");

  text = text
    .replaceAll("//skill-creator:skill-creator", info.author)
    .replaceAll("/$skill-creator", info.author)
    .replaceAll("/skill-creator:skill-creator", info.author)
    .replaceAll("Cursor's built-in", info.author)
    .replaceAll("Claude Code's built-in", info.author)
    .replaceAll("Codex's built-in", info.author);
  if (relative !== "skills/setup-pstack/SKILL.md" && relative !== "skills/author-skill/SKILL.md") {
    text = text.replaceAll("$skill-creator", info.author);
  }
  if (relative === "skills/automate-me/SKILL.md" && provider === "codex") {
    text = text.replace("- Frontmatter `disable-model-invocation: true` by default. Mode skills are heavy and opinionated; they should only apply when the user explicitly invokes them (by name or slash command), not auto-trigger on description matching. Opt out only if the user explicitly wants their mode to apply on every turn.",
      "- Add `agents/openai.yaml` with `policy.allow_implicit_invocation: false` by default. Mode skills are heavy and opinionated; they should only apply when the user explicitly invokes them. Opt out only if the user explicitly wants automatic invocation.");
  }
  if (relative === "skills/no-comments/SKILL.md") {
    text = text.replace(/Spawn `Agent` with `subagent_type: "Comment Sicko"`\./, "Spawn the native `pstack:comment-sicko` agent.");
    text = text.replace(/Spawn `native subagent capability` with the native pstack comment-sicko delegate\./, "Spawn the standalone native `pstack-comment-sicko` agent.");
  }

  text = text
    .replaceAll("cloud concurrency limit", "provider runtime concurrency limit")
    .replaceAll("Cloud-agent PR tools", "PR tools")
    .replaceAll("cloud one plus a local one", "second local one")
    .replaceAll("cloud environment forces", "local isolation requires")
    .replaceAll("verbatim paste is for cloud spawns and every resume", "verbatim paste is for every fresh spawn and resume")
    .replaceAll("its spawn budget with the cloud default and the local exception list", "its exact requested fan-out and the machine-local exception list")
    .replaceAll("Restacks run in cloud; a local restack at this scale takes the laptop down.", "Restacks run only in the serialized stacker worktree; never run two stack mutations concurrently.")
    .replaceAll("reattach cloud work by PR and branch rather than agent id", "reconcile persisted work by PR and branch rather than agent id")
    .replaceAll("cloud-agent URL", "explicit state-capsule")
    .replaceAll("cloud spawns", "fresh spawns")
    .replaceAll("Cloud agents", "Local workers")
    .replaceAll("cloud agents", "local workers")
    .replaceAll("cloud work", "persisted local work")
    .replaceAll("cloud default", "local default")
    .replaceAll("in cloud", "in the isolated stacker worktree")
    .replaceAll("verbatim paste is for every fresh spawn and resume", "verbatim paste is for every fresh spawn and respawn")
    .replaceAll("its exact requested fan-out and the machine-local exception list", "its exact requested fan-out");

  if (provider === "codex") {
    text = text
      .replaceAll("`pstack:poteto-agent`", "`pstack-poteto-agent`")
      .replaceAll("`pstack:comment-sicko`", "`pstack-comment-sicko`")
      .replaceAll("Codex's `/loop` command (a built-in, not a pstack skill)", "an armed `/goal` plus a Desktop heartbeat in the current task or a local watcher in CLI/IDE")
      .replaceAll("Codex's `/loop` command", "an armed `/goal` plus the provider wake mechanism")
      .replaceAll('`subagent_type: generalPurpose`', "the named native pstack profile")
      .replaceAll('`subagent_type: "poteto-agent"`', "the native `pstack-poteto-agent` profile")
      .replaceAll('`run_in_background: true`', "concurrent launch")
      .replaceAll('`environment: "local"`', "the current local checkout")
      .replaceAll('`environment`', "local execution context")
      .replaceAll("the full Task schema", "the full native delegation capability")
      .replaceAll("/loop until X", "run until X")
      .replaceAll("`/loop`", "the configured wake mechanism")
      .replaceAll("and /loop above", "and /goal plus a heartbeat above")
      .replace(/^\/loop until done\./gm, "Run until done.");
  }
  text = text
    .replace(/using your configured feature model \(default `pstack-role-feature`\)/g, "by invoking `pstack-role-feature`")
    .replace(/using your configured refactoring model \(default `pstack-role-refactoring`\)/g, "by invoking `pstack-role-refactoring`")
    .replace(/using your configured bug-fix model \(default `pstack-role-bug-fix`\)/g, "by invoking `pstack-role-bug-fix`")
    .replace(/using your configured perf-issue model \(default `pstack-role-perf-issue`\)/g, "by invoking `pstack-role-perf-issue`")
    .replace(/using your configured hillclimb model \(default `pstack-role-hillclimb`\)/g, "by invoking `pstack-role-hillclimb`");
  text = text
    .replace("Use your configured architect runners (defaults `pstack-role-architect-runner-1`, `pstack-role-architect-runner-2`, `pstack-role-architect-runner-3`, `pstack-role-architect-runner-4`).", "Invoke `pstack-role-architect-runner-1` through `pstack-role-architect-runner-4` as independent design runs.")
    .replace("spawn one architectural critic per model in the four `pstack-role-how-critic-<n>` profiles (defaults `pstack-role-how-critic-1`, `pstack-role-how-critic-2`, `pstack-role-how-critic-3`, `pstack-role-how-critic-4`)", "spawn `pstack-role-how-critic-1` through `pstack-role-how-critic-4` as four independent read-only critics")
    .replace(/Explore in subagents with (?:`subagent_type: "poteto-agent"`|the native pstack poteto delegate) and an explicit model per the Subagents section/, "Explore with the native pstack poteto delegate and the playbook's named semantic profile")
    .replace("Spawn one reviewer per configured model to adversarially review code changes.", "Spawn the four configured native reviewer profiles to adversarially review code changes.");
  if (relative === "docs/guide/07-overnight.md") {
    text = text.replace(/- `\/loop` is .*? wake mechanism, not a pstack skill\./,
      provider === "claude"
        ? "- `/loop` is Claude Code's native wake mechanism, not a pstack skill."
        : "- Codex uses an armed `/goal` plus a Desktop heartbeat or local CLI/IDE watcher as its wake mechanism.");
  }

  text = text.replaceAll("In a local session, a real terminal `/loop`. In a cloud root, a checkpoint watcher wake chain.", provider === "claude"
    ? "Use Claude Code's native `/loop` under the armed `/goal`."
    : "In Desktop, use a scheduled heartbeat in this task; in CLI or IDE, run a local watcher under the armed `/goal`.");
  text = text.replaceAll("After a Claude Code restart: local agents are dead, cloud work is not.", "After a restart, all unfinished local workers are dead. Recompute the frontier from durable state and spawn fresh workers from their stored briefs; never claim agent-ID reattachment.");
  text = text.replaceAll("After a Codex restart: local agents are dead, cloud work is not.", "After a restart, all unfinished local workers are dead. Recompute the frontier from durable state and spawn fresh workers from their stored briefs; never claim agent-ID reattachment.");
  if (provider === "codex") {
    text = text
      .replaceAll("Codex's `/loop` command (a built-in, not a pstack skill)", "an armed `/goal` plus a Desktop heartbeat in the current task or a local watcher in CLI/IDE")
      .replaceAll("Codex's `/loop` command", "an armed `/goal` plus the provider wake mechanism")
      .replaceAll("`/loop`", "the configured wake mechanism")
      .replaceAll("/loop until X", "run until X")
      .replace(/^\/loop until done\./gm, "Run until done.")
      .replaceAll("a real terminal the configured wake mechanism", "a Desktop heartbeat or local CLI/IDE watcher under `/goal`")
      .replaceAll("under the configured wake mechanism in dynamic mode", "with the configured wake mechanism re-armed dynamically")
      .replaceAll("the configured wake mechanism per component", "repeat with the configured wake mechanism");
  }
  if ([
    "skills/swarm/SKILL.md",
    "skills/poteto-mode/playbooks/orchestrate.md",
    "skills/poteto-mode/playbooks/autopilot-full.md",
    "skills/poteto-mode/playbooks/autopilot-stack.md",
    "skills/poteto-mode/playbooks/babysit.md",
    "skills/poteto-mode/playbooks/opening-a-pr.md",
  ].includes(relative)) {
    text = text.replace(/\bcloud\b/gi, "local");
  }
  return text;
}

function transform(relative, buffer, provider) {
  if (!TEXT_EXTENSIONS.has(path.extname(relative))) return buffer;
  let text = buffer.toString("utf8");
  if (relative === "skills/setup-pstack/SKILL.md") return Buffer.from(setupSkill(provider));
  if (relative === "skills/poteto-mode/scripts/worktree-audit.sh") text = rewriteWorktreeAudit(text);
  text = removeReviewBotProtocol(text, relative);
  if (relative.endsWith(".md")) text = adaptMarkdown(text, relative, provider);
  else {
    text = text.replaceAll("@cursor-skill/poteto-mode-tools", "@pstack/poteto-mode-tools");
    if (relative === "skills/poteto-mode/scripts/check-plan.mjs") {
      text = text
        .replace('const LANES = "Ten lanes on `grok-4.6-fast-xhigh` at the PR head";', 'const LANES = "Ten lanes on the `pstack-role-verification-worker` profile at the PR head";')
        .replace("let cursor = 0;", "let position = 0;")
        .replace("i >= cursor", "i >= position")
        .replace("cursor = at + 1", "position = at + 1");
    }
  }
  return Buffer.from(text);
}

function pluginManifest(provider) {
  const base = {
    name: "pstack",
    version: adapterVersion(provider),
    description: "If you want to go fast, go deep first. Rigorous agent workflows you can parallelize with confidence.",
    author: { name: "Lauren Tan" },
    license: "MIT",
    keywords: ["pstack", "poteto-mode", "workflow", "principles", "subagents", "unslop"],
    skills: "./skills/",
  };
  if (provider === "claude") return base;
  return {
    ...base,
    interface: {
      displayName: "pstack",
      shortDescription: "Rigorous native agent workflows for Codex.",
      longDescription: "Provider-native pstack workflows for understanding, designing, building, reviewing, verifying, and shipping code.",
      developerName: "Lauren Tan",
      category: "Productivity",
      capabilities: ["Subagents", "Planning", "Verification"],
      defaultPrompt: ["Use pstack poteto mode for this task."],
    },
  };
}

function writeOpenAiMetadata(dist) {
  const written = [];
  const render = (skill) => {
    const display = skill.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    return `interface:\n  display_name: ${JSON.stringify(`Pstack: ${display}`)}\n  short_description: "Invoke this pstack workflow explicitly."\n  default_prompt: ${JSON.stringify(`Use $pstack:${skill} for this task.`)}\npolicy:\n  allow_implicit_invocation: false\n`;
  };
  for (const skill of SKILLS) {
    const skillFile = path.join(dist, "skills", skill, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const text = fs.readFileSync(skillFile, "utf8");
    if (!/^disable-model-invocation: true$/m.test(fs.readFileSync(path.join(UPSTREAM, "skills", skill, "SKILL.md"), "utf8"))) continue;
    const relative = path.join("skills", skill, "agents", "openai.yaml");
    writeFile(path.join(dist, relative), render(skill));
    written.push(relative);
  }
  const author = path.join("skills", "author-skill", "agents", "openai.yaml");
  writeFile(path.join(dist, author), render("author-skill"));
  written.push(author);
  return written;
}

function managedToml(name, description, instructions) {
  const payload = [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${JSON.stringify(instructions)}`,
    "",
  ].join("\n");
  return `# pstack-managed-v1 sha256:${sha256(payload)}\n${payload}`;
}

function writeCodexHelpers(dist, potetoInstructions, records) {
  const commentSource = fs.readFileSync(path.join(UPSTREAM, "agents", "comment-sicko.md"), "utf8");
  const comment = adaptMarkdown(commentSource.replace(/^---[\s\S]*?---\n/, ""), "agents/comment-sicko.md", "codex").trim();
  const helpers = [
    [
      "pstack-poteto-agent.toml",
      "pstack-poteto-agent",
      "Routing target for pstack poteto-mode and general playbook delegates.",
      `Operate as pstack poteto mode. Apply the full mechanically generated operating contract below.\n\n${potetoInstructions}`,
    ],
    [
      "pstack-comment-sicko.toml",
      "pstack-comment-sicko",
      "Comment-only reviewer that deletes narration and flags code that needs structural cleanup.",
      comment,
    ],
  ];
  for (const [file, name, description, instructions] of helpers) {
    const relative = path.join("runtime", "agents", file);
    writeFile(path.join(dist, relative), managedToml(name, description, instructions));
    records.push({ output: relative, class: "add", reason: "standalone native helper agent" });
  }
}

function transformationReason(relative, outputRelative, provider) {
  const reasons = [];
  if (relative.endsWith(".md")) reasons.push(`${provider}-native commands, routing, paths, history, questions, and local execution semantics`);
  if (relative.startsWith("skills/poteto-mode/scripts/watch-pr/")) reasons.push("source-provider review-bot protocol removed while generic review handling is preserved");
  if (relative === "skills/poteto-mode/scripts/worktree-audit.sh") reasons.push("undocumented source-provider transcript discovery removed");
  if (["skills/poteto-mode/scripts/package.json", "skills/poteto-mode/scripts/bun.lock"].includes(relative)) reasons.push("source-provider package namespace replaced by the portable package namespace");
  if (relative === "skills/poteto-mode/scripts/check-plan.mjs") reasons.push("source model lane and source-provider cursor identifier replaced by semantic equivalents");
  if (relative !== outputRelative) reasons.push(`renamed to ${outputRelative} after removing source-provider review-bot naming`);
  if (reasons.length === 0) throw new Error(`${relative}: transformed without a specific reason`);
  return reasons.join("; ");
}

function generateProvider(provider) {
  const dist = path.join(ROOT, "dist", provider);
  fs.rmSync(dist, { recursive: true, force: true });
  const records = [];
  for (const relative of listFiles(UPSTREAM)) {
    if (omitted(relative)) {
      records.push({ source: relative, class: "omit", reason: omissionReason(relative) });
      continue;
    }
    if (provider === "codex" && relative.startsWith("agents/")) {
      records.push({ source: relative, class: "omit", reason: "Codex plugins do not register agents; compiled standalone TOML added under runtime/agents" });
      continue;
    }
    const source = fs.readFileSync(path.join(UPSTREAM, relative));
    let outputRelative = relative;
    if (outputRelative === "skills/poteto-mode/references/bugbot-triage.md") {
      outputRelative = "skills/poteto-mode/references/automated-review-triage.md";
    }
    const result = transform(relative, source, provider);
    writeFile(path.join(dist, outputRelative), result, fs.statSync(path.join(UPSTREAM, relative)).mode & 0o111 ? 0o755 : undefined);
    records.push({
      source: relative,
      output: outputRelative,
      class: source.equals(result) && relative === outputRelative ? "copy" : "transform",
      ...(source.equals(result) && relative === outputRelative ? {} : { reason: transformationReason(relative, outputRelative, provider) }),
      sourceSha256: sha256(source),
      outputSha256: sha256(result),
    });
  }
  writeFile(path.join(dist, "skills", "author-skill", "SKILL.md"), authorSkill(provider));
  records.push({ output: "skills/author-skill/SKILL.md", class: "add", reason: "canonical provider-native skill-authoring contract" });
  const metadata = provider === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json";
  writeFile(path.join(dist, metadata), `${JSON.stringify(pluginManifest(provider), null, 2)}\n`);
  records.push({ output: metadata, class: "add", reason: "native plugin manifest" });
  writeFile(path.join(dist, "config", "defaults.json"), fs.readFileSync(path.join(ROOT, "config", "defaults", `${provider}.json`)));
  writeFile(path.join(dist, "config", "defaults", `${provider}.json`), fs.readFileSync(path.join(ROOT, "config", "defaults", `${provider}.json`)));
  writeFile(path.join(dist, "config", "schema.json"), fs.readFileSync(path.join(ROOT, "config", "schema.json")));
  records.push({ output: "config/defaults.json", class: "add", reason: "native routing defaults" });
  records.push({ output: `config/defaults/${provider}.json`, class: "add", reason: "runtime compiler routing defaults" });
  records.push({ output: "config/schema.json", class: "add", reason: "sparse override schema" });
  const potetoInstructions = fs.readFileSync(path.join(dist, "skills", "poteto-mode", "SKILL.md"), "utf8");
  const templateDir = path.join(dist, "runtime", "agents");
  compileAgents({ provider, output: templateDir, potetoInstructions });
  for (const file of listFiles(templateDir)) records.push({ output: path.join("runtime/agents", file), class: "add", reason: "compiled native role profile" });
  if (provider === "codex") writeCodexHelpers(dist, potetoInstructions, records);
  for (const runtimeScript of ["lib.mjs", "compile-agents.mjs"]) {
    writeFile(path.join(dist, "runtime", runtimeScript), fs.readFileSync(path.join(ROOT, "scripts", runtimeScript)), 0o755);
    records.push({ output: `runtime/${runtimeScript}`, class: "add", reason: "guarded runtime profile compiler" });
  }
  if (provider === "codex") {
    for (const relative of writeOpenAiMetadata(dist)) records.push({ output: relative, class: "add", reason: "Codex explicit-invocation policy" });
  }
  writeFile(path.join(ROOT, "portability", "manifests", `${provider}.json`), `${JSON.stringify({ schemaVersion: 1, provider, sourceTreeSha256: actualTree, compatibility: "behavior-unverified", files: records }, null, 2)}\n`);
}

for (const provider of PROVIDERS) generateProvider(provider);

writeFile(path.join(ROOT, ".claude-plugin", "marketplace.json"), `${JSON.stringify({
  name: "pstack-portable",
  owner: { name: "pstack portable maintainers" },
  plugins: [{ name: "pstack", source: "./dist/claude", description: "Provider-native pstack for Claude Code", version: pluginManifest("claude").version }],
}, null, 2)}\n`);

const generationContract = {
  schemaVersion: 1,
  sourceTreeSha256: actualTree,
  providers: Object.fromEntries(PROVIDERS.map((provider) => [provider, {
    version: pluginManifest(provider).version,
    distTreeSha256: treeHash(path.join(ROOT, "dist", provider)),
    manifestSha256: sha256(fs.readFileSync(path.join(ROOT, "portability", "manifests", `${provider}.json`))),
  }])),
  claudeMarketplaceSha256: sha256(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"))),
};
const contractFile = path.join(ROOT, "portability", "generation-contract.json");
if (process.argv.includes("--accept-contract")) {
  writeFile(contractFile, `${JSON.stringify(generationContract, null, 2)}\n`);
} else {
  if (!fs.existsSync(contractFile)) throw new Error("generation contract is missing; review both generated ports, then run npm run accept-generation");
  const accepted = readJson(contractFile);
  if (JSON.stringify(accepted) !== JSON.stringify(generationContract)) {
    throw new Error("generated bytes differ from the reviewed generation contract; inspect dist and portability manifests, then run npm run accept-generation to accept the exact new hashes");
  }
}

console.log(`generated ${PROVIDERS.map((provider) => `dist/${provider}`).join(" and ")} from ${actualTree}`);
