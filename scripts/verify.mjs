#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, PROVIDERS, UPSTREAM, NO_MUTATION_ROLES, STRICT_READ_ONLY_ROLES, listFiles, readJson, sha256, treeHash } from "./lib.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) failures.push(`${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
}

function frontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  return end === -1 ? null : text.slice(4, end);
}

function verifyLinks(root, relative, text) {
  const regex = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(regex)) {
    const raw = match[1].replace(/^<|>$/g, "");
    const target = raw.split("#", 1)[0];
    if (!target || target === "url" || /^(?:https?:|mailto:)/.test(target) || /[<>]/.test(target)) continue;
    const resolved = path.resolve(path.dirname(path.join(root, relative)), decodeURIComponent(target));
    check(fs.existsSync(resolved), `${path.join(root, relative)}: broken link ${raw}`);
  }
}

function verifyManaged(file, text) {
  const match = /(?:<!-- |# )pstack-managed-v1 sha256:([a-f0-9]{64})(?: -->)?\n/.exec(text);
  check(Boolean(match), `${file}: missing managed marker`);
  if (match) {
    const payload = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`;
    check(match[1] === sha256(payload), `${file}: managed payload hash mismatch`);
  }
}

const provenance = readJson(path.join(ROOT, "PROVENANCE.json"));
check(treeHash(UPSTREAM) === provenance.source.snapshotTreeSha256, "upstream snapshot tree hash mismatch");
check(fs.readFileSync(path.join(ROOT, "LICENSE")).equals(fs.readFileSync(path.join(UPSTREAM, "LICENSE"))), "root LICENSE differs from upstream");
check(JSON.stringify(fs.readdirSync(path.join(ROOT, "upstream")).sort()) === JSON.stringify(["pstack"]), "upstream contains something other than the pstack subtree");
const lockedConfigHashes = {
  "config/defaults/claude.json": "86ad99e484b8a1816d357f963747a62b5f00d0c802441a3324af77732ab4bed3",
  "config/defaults/codex.json": "0933034372581c2902088ce0ee66b26cb39f231ac72889ae13c4f85407be512c",
  "config/schema.json": "8711173fcfee458de28f38af7e0135540bd6b2ceb520d9055eeacc997653af44",
};
for (const [relative, expected] of Object.entries(lockedConfigHashes)) {
  check(sha256(fs.readFileSync(path.join(ROOT, relative))) === expected, `${relative}: locked routing/schema contract drifted; review the full mapping and update its explicit verifier hash`);
}

function generatedState() {
  return JSON.stringify({
    contract: sha256(fs.readFileSync(path.join(ROOT, "portability", "generation-contract.json"))),
    marketplace: sha256(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"))),
    providers: Object.fromEntries(PROVIDERS.map((provider) => [provider, {
      dist: treeHash(path.join(ROOT, "dist", provider)),
      manifest: sha256(fs.readFileSync(path.join(ROOT, "portability", "manifests", `${provider}.json`))),
    }])),
  });
}

const before = generatedState();
run(process.execPath, [path.join(ROOT, "scripts", "generate.mjs")]);
check(before === generatedState(), "generation changed bytes accepted by the review contract");
run(process.execPath, [path.join(ROOT, "scripts", "generate.mjs")]);
check(before === generatedState(), "generation is not deterministic");

for (const provider of PROVIDERS) {
  const dist = path.join(ROOT, "dist", provider);
  const manifest = readJson(path.join(ROOT, "portability", "manifests", `${provider}.json`));
  const sourceRecords = manifest.files.filter((record) => record.source);
  const outputRecords = manifest.files.filter((record) => record.output);
  const sourceCounts = new Map();
  const outputCounts = new Map();
  for (const record of sourceRecords) sourceCounts.set(record.source, (sourceCounts.get(record.source) ?? 0) + 1);
  for (const record of outputRecords) outputCounts.set(record.output, (outputCounts.get(record.output) ?? 0) + 1);
  for (const relative of listFiles(UPSTREAM)) check(sourceCounts.get(relative) === 1, `${provider}: source file not classified exactly once: ${relative}`);
  for (const [output, count] of outputCounts) check(count === 1, `${provider}: output classified ${count} times: ${output}`);
  for (const record of manifest.files) {
    if (["transform", "omit", "add"].includes(record.class)) check(typeof record.reason === "string" && record.reason.length > 0, `${provider}: ${record.class} record lacks a reason: ${record.source ?? record.output}`);
    if (record.class === "copy" || record.class === "transform") {
      const source = fs.readFileSync(path.join(UPSTREAM, record.source));
      const output = fs.readFileSync(path.join(dist, record.output));
      check(sha256(source) === record.sourceSha256, `${provider}: stale source hash for ${record.source}`);
      check(sha256(output) === record.outputSha256, `${provider}: stale output hash for ${record.output}`);
      if (record.class === "copy") check(source.equals(output), `${provider}: copy class changed bytes for ${record.source}`);
    } else if (record.class === "add") {
      check(fs.existsSync(path.join(dist, record.output)), `${provider}: missing added file ${record.output}`);
    }
  }
  const declared = new Set(outputRecords.map((record) => record.output));
  for (const relative of listFiles(dist)) check(declared.has(relative), `${provider}: unclassified generated output ${relative}`);

  const forbidden = [
    [/\bCursor\b/i, "source provider name"],
    [/\.cursor(?:\/|\b)/i, "source provider path"],
    [/cursor-team-kit|cursor\.sh|CURSOR_|@cursor-skill/i, "source provider protocol"],
    [/\bBugbot\b|\bGrokbot\b|\bBenny\b|grok-4/i, "omitted source capability"],
    [/agent-transcripts|cloud[- ](?:agent|worker|root|sleeper)|cloud VM|environment:\s*["`]cloud/i, "source execution mechanic"],
    [/allow_multiple|mcps\/|<plugin-root>|git reset --hard|monitored-shell|output-notification|git show origin\/main:pstack/i, "stale source-provider contract"],
    [/installed real-surface tooling|cursor-team-kit|`control-ui`|`control-cli`/i, "fictional or source-only dependency"],
  ];
  if (provider === "codex") {
    forbidden.push([/subagent_type|run_in_background|AskQuestion|AskUserQuestion|multiSelect|`Task`|Task tool|\/loop|\/pstack:/, "non-Codex invocation mechanic"]);
  } else {
    forbidden.push([/request_user_input|\$pstack:/, "non-Claude invocation mechanic"]);
  }
  for (const relative of listFiles(dist)) {
    const extension = path.extname(relative);
    if (![".md", ".json", ".yaml", ".yml", ".mjs", ".ts", ".sh", ".toml", ".lock"].includes(extension)) continue;
    const text = fs.readFileSync(path.join(dist, relative), "utf8");
    const scanned = relative.startsWith("skills/poteto-mode/scripts/watch-pr/")
      ? text.replace(/\b(?:endCursor|cursor)\b/g, "pagination-token")
      : text;
    for (const [pattern, label] of forbidden) {
      if (pattern.test(scanned) && !(pattern.source.includes("Cursor") && /\bprecursor\b/i.test(scanned) && !/(?:^|[^a-z])cursor(?:$|[^a-z])/im.test(scanned.replace(/precursor/gi, "")))) {
        failures.push(`${provider}/${relative}: ${label} matches ${pattern}`);
      }
    }
    if ((relative.startsWith("skills/") || relative.startsWith("docs/") || relative === "README.md" || relative.startsWith("agents/")) && /claude-(?:fable|opus|sonnet)|gpt-5\.6|grok-4/.test(text)) {
      failures.push(`${provider}/${relative}: embeds a provider model instead of a semantic profile`);
    }
    if (extension === ".md") verifyLinks(dist, relative, text);
    for (const match of text.matchAll(provider === "claude" ? /\/pstack:([a-z0-9-]+)/g : /\$pstack:([a-z0-9-]+)/g)) {
      check(fs.existsSync(path.join(dist, "skills", match[1], "SKILL.md")), `${provider}/${relative}: references missing pstack skill ${match[1]}`);
    }
    for (const match of text.matchAll(/pstack-role-([a-z0-9-]+)/g)) {
      if (match[1].includes("role") || match[1].endsWith("-n") || match[1].endsWith("-")) continue;
      const roleFile = path.join(dist, "runtime", "agents", `pstack-role-${match[1]}${provider === "claude" ? ".md" : ".toml"}`);
      check(fs.existsSync(roleFile), `${provider}/${relative}: references missing role profile pstack-role-${match[1]}`);
    }
  }

  for (const relative of listFiles(path.join(dist, "skills")).filter((file) => file.endsWith("SKILL.md"))) {
    const text = fs.readFileSync(path.join(dist, "skills", relative), "utf8");
    const yaml = frontmatter(text);
    check(yaml !== null && /^name:\s*\S+/m.test(yaml), `${provider}/skills/${relative}: missing valid frontmatter name`);
    if (provider === "codex") check(!/^disable-model-invocation:/m.test(yaml ?? ""), `${provider}/skills/${relative}: unsupported disable-model-invocation field`);
  }
  const extension = provider === "claude" ? ".md" : ".toml";
  const routes = readJson(path.join(ROOT, "config", "defaults", `${provider}.json`)).roles;
  const roleFiles = new Set(listFiles(path.join(dist, "runtime", "agents")).filter((file) => file.startsWith("pstack-role-") && file.endsWith(extension)));
  const expectedRoleFiles = new Set(Object.keys(routes).map((role) => `pstack-role-${role}${extension}`));
  check(JSON.stringify([...roleFiles].sort()) === JSON.stringify([...expectedRoleFiles].sort()), `${provider}: generated role profiles do not exactly match configured roles`);
  for (const relative of listFiles(path.join(dist, "runtime", "agents"))) {
    if (relative.endsWith(provider === "claude" ? ".md" : ".toml")) {
      const text = fs.readFileSync(path.join(dist, "runtime", "agents", relative), "utf8");
      verifyManaged(`${provider}/runtime/agents/${relative}`, text);
      if (provider === "claude") check(text.startsWith("---\n") && frontmatter(text) !== null, `${provider}/runtime/agents/${relative}: frontmatter must start on line 1`);
    }
  }
  for (const [role, route] of Object.entries(routes)) {
    const text = fs.readFileSync(path.join(dist, "runtime", "agents", `pstack-role-${role}${extension}`), "utf8");
    if (!route.inheritParent) {
      check(provider === "claude" ? text.includes(`model: ${route.model}\neffort: ${route.effort}`) : text.includes(`model = ${JSON.stringify(route.model)}\nmodel_reasoning_effort = ${JSON.stringify(route.effort)}`), `${provider}: role ${role} does not compile its exact route`);
    }
    if (STRICT_READ_ONLY_ROLES.has(role)) {
      check(provider === "claude" ? text.includes("tools: Read, Grep, Glob") && text.includes("permissionMode: plan") : text.includes('sandbox_mode = "read-only"'), `${provider}: strict read-only role ${role} lacks native enforcement`);
    }
    if (NO_MUTATION_ROLES.has(role)) {
      check(text.includes("do not modify files, git state, external systems, or user data"), `${provider}: no-mutation role ${role} lacks its boundary`);
      if (provider === "claude") check(!text.includes("tools: Read, Grep, Glob"), `${provider}: evidence-capable no-mutation role ${role} was stripped to strict tools`);
    }
  }
}

const codexPoteto = fs.readFileSync(path.join(ROOT, "dist", "codex", "skills", "poteto-mode", "SKILL.md"), "utf8");
const codexComments = fs.readFileSync(path.join(ROOT, "dist", "codex", "skills", "no-comments", "SKILL.md"), "utf8");
check(codexPoteto.includes("`pstack-poteto-agent`") && !codexPoteto.includes("`pstack:poteto-agent`"), "Codex poteto-mode does not target its standalone native helper");
check(codexComments.includes("`pstack-comment-sicko`") && !codexComments.includes("`pstack:comment-sicko`"), "Codex no-comments does not target its standalone native helper");
check(/name = "pstack-poteto-agent"/.test(fs.readFileSync(path.join(ROOT, "dist", "codex", "runtime", "agents", "pstack-poteto-agent.toml"), "utf8")), "Codex poteto helper name drifted");
check(/name = "pstack-comment-sicko"/.test(fs.readFileSync(path.join(ROOT, "dist", "codex", "runtime", "agents", "pstack-comment-sicko.toml"), "utf8")), "Codex comment helper name drifted");
check(!/sandbox_mode\s*=/.test(fs.readFileSync(path.join(ROOT, "dist", "codex", "runtime", "agents", "pstack-comment-sicko.toml"), "utf8")), "Codex Comment Sicko must remain write-capable to preserve source semantics");
check(!/tools:\s*Read, Grep, Glob|permissionMode:\s*plan/.test(fs.readFileSync(path.join(ROOT, "dist", "claude", "agents", "comment-sicko.md"), "utf8")), "Claude Comment Sicko must remain write-capable to preserve source semantics");

for (const provider of PROVIDERS) {
  const dist = path.join(ROOT, "dist", provider);
  const manifestFile = path.join(dist, provider === "claude" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json");
  const manifest = readJson(manifestFile);
  check(new RegExp(`^0\\.14\\.4-portable\\.${provider}\\.[a-f0-9]{12}$`).test(manifest.version), `${provider}: adapter version is not deterministic and provider-specific`);
  const setup = fs.readFileSync(path.join(dist, "skills", "setup-pstack", "SKILL.md"), "utf8");
  check(setup.includes(`~/.pstack/providers/${provider}/runtime/compile-agents.mjs`) && setup.includes("--available-route <confirmed-slug> <confirmed-effort>"), `${provider}: setup does not use the stable compiler pointer and exact route pairs`);
  const automate = fs.readFileSync(path.join(dist, "skills", "automate-me", "SKILL.md"), "utf8");
  check(automate.includes("pstack-role-how-explorer"), `${provider}: automate-me does not route high-volume history mining through how-explorer`);
  check(provider === "claude" ? automate.includes("multiSelect: true") && !automate.includes("allow_multiple") : automate.includes("numbered conversational prompt") && !automate.includes("multiSelect"), `${provider}: automate-me question semantics drifted`);
  const createVerification = fs.readFileSync(path.join(dist, "skills", "create-verification-skill", "SKILL.md"), "utf8");
  check(createVerification.includes(provider === "claude" ? "/pstack:author-skill" : "$pstack:author-skill"), `${provider}: verification-skill creation bypasses native author-skill`);
  const orchestrate = fs.readFileSync(path.join(dist, "skills", "poteto-mode", "playbooks", "orchestrate.md"), "utf8");
  check(orchestrate.includes(`~/.pstack/state/${provider}/<project-slug>/orchestrate/`) && orchestrate.includes(`~/.pstack/providers/${provider}/skills/poteto-mode/scripts/orch/orch.ts`), `${provider}: orchestrate lacks stable durable paths`);
  check(orchestrate.includes("Never resume or reattach by agent ID"), `${provider}: orchestrate does not preserve checkpoint-and-respawn semantics`);
  for (const workflow of ["arena", "swarm"]) {
    const text = fs.readFileSync(path.join(dist, "skills", workflow, "SKILL.md"), "utf8");
    check(text.includes("exactly N") && !text.includes("proceed with N-1"), `${provider}: ${workflow} can silently shrink requested fan-out`);
  }
}

const claudeMarketplace = readJson(path.join(ROOT, ".claude-plugin", "marketplace.json"));
const claudeManifest = readJson(path.join(ROOT, "dist", "claude", ".claude-plugin", "plugin.json"));
check(claudeMarketplace.plugins.find((plugin) => plugin.name === "pstack")?.version === claudeManifest.version, "Claude marketplace version differs from plugin version");

const claudeRoles = readJson(path.join(ROOT, "config", "defaults", "claude.json")).roles;
const codexRoles = readJson(path.join(ROOT, "config", "defaults", "codex.json")).roles;
check(claudeRoles.feature.model === "claude-opus-5" && claudeRoles.feature.effort === "xhigh", "Claude feature mapping drifted");
check(claudeRoles["why-synthesizer"].model === "claude-opus-5" && claudeRoles["why-synthesizer"].effort === "max", "Claude why-synthesizer mapping drifted");
check(codexRoles.feature.model === "gpt-5.6-sol" && codexRoles.feature.effort === "xhigh", "Codex feature mapping drifted");
check(codexRoles["how-explorer"].model === "gpt-5.6-luna" && codexRoles["how-explorer"].effort === "xhigh", "Codex how-explorer mapping drifted");
check(codexRoles["how-explainer"].model === "gpt-5.6-sol" && codexRoles["how-explainer"].effort === "max", "Codex how-explainer mapping drifted");

if (failures.length) {
  console.error(`${failures.length} verification failure(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("verified provenance, deterministic generation, classifications, copy bytes, native mappings, managed hashes, frontmatter, links, and forbidden-mechanic absence");
