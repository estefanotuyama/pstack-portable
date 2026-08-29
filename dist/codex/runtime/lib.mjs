import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const UPSTREAM = path.join(ROOT, "upstream", "pstack");
export const PROVIDERS = ["claude", "codex"];

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeFile(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  if (mode !== undefined) fs.chmodSync(file, mode);
}

export function listFiles(root) {
  const result = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(path.relative(root, absolute));
    }
  }
  visit(root);
  return result.sort((a, b) => a.localeCompare(b, "en"));
}

export function treeHash(root) {
  const digest = crypto.createHash("sha256");
  for (const relative of listFiles(root)) {
    digest.update(relative);
    digest.update("\0");
    digest.update(sha256(fs.readFileSync(path.join(root, relative))));
    digest.update("\n");
  }
  return digest.digest("hex");
}

export function loadEffectiveConfig(provider, overridePath) {
  if (!PROVIDERS.includes(provider)) throw new Error(`unknown provider: ${provider}`);
  const defaults = readJson(path.join(ROOT, "config", "defaults", `${provider}.json`));
  const overrides = overridePath && fs.existsSync(overridePath)
    ? readJson(overridePath)
    : { schemaVersion: 1, roles: {} };
  if (overrides.schemaVersion !== 1 || typeof overrides.roles !== "object" || Array.isArray(overrides.roles)) {
    throw new Error(`${overridePath}: expected {schemaVersion: 1, roles: {...}}`);
  }
  const known = new Set(Object.keys(defaults.roles));
  for (const [role, route] of Object.entries(overrides.roles)) {
    if (!known.has(role)) throw new Error(`${overridePath}: unknown role ${JSON.stringify(role)}`);
    validateRoute(route, `${overridePath}: roles.${role}`);
  }
  return {
    schemaVersion: 1,
    roles: { ...defaults.roles, ...overrides.roles },
  };
}

export function validateRoute(route, label) {
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    throw new Error(`${label}: route must be an object`);
  }
  const keys = Object.keys(route).sort();
  if (route.inheritParent === true) {
    if (keys.join(",") !== "inheritParent") throw new Error(`${label}: inheritParent cannot be combined with model or effort`);
    return;
  }
  if (keys.join(",") !== "effort,model" || typeof route.model !== "string" || route.model.length === 0) {
    throw new Error(`${label}: expected {model, effort} or {inheritParent: true}`);
  }
  const efforts = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
  if (!efforts.has(route.effort)) throw new Error(`${label}: unsupported effort ${JSON.stringify(route.effort)}`);
}

export const STRICT_READ_ONLY_ROLES = new Set([
  "how-explorer",
  "how-explainer",
  "how-critic-1",
  "how-critic-2",
  "how-critic-3",
  "how-critic-4",
  "arena-judge-1",
  "arena-judge-2",
  "arena-judge-3",
  "arena-judge-4",
  "interrogate-reviewer-1",
  "interrogate-reviewer-2",
  "interrogate-reviewer-3",
  "interrogate-reviewer-4",
]);

export const NO_MUTATION_ROLES = new Set([
  "why-investigator",
  "why-synthesizer",
  "reflect-tooling",
  "reflect-judgment",
  "reflect-divergent",
  "reflect-synthesizer",
  "verification-worker",
]);

export function roleAgentName(role) {
  return `pstack-role-${role}`;
}

function roleDescription(role, readOnly, noMutation) {
  const posture = readOnly ? "Read-only " : noMutation ? "No-mutation " : "";
  return `${posture}pstack worker for the ${role} semantic role. Use only when a pstack workflow requests this exact role.`;
}

function roleInstructions(provider, role, readOnly, noMutation, potetoInstructions) {
  const noWrite = readOnly
    ? "Do not modify files, git state, external systems, or user data. Return evidence and file pointers only."
    : noMutation
      ? "Retain the tools needed to inspect runtime and MCP evidence, but do not modify files, git state, external systems, or user data. Return evidence and file pointers only."
      : "Honor the mutation boundary in the delegated brief. Do not expand scope.";
  const base = `You are the native execution profile for pstack role ${role}. Read the complete delegated brief and every referenced file before acting. ${noWrite} Preserve exact requested fan-out semantics. If a required capability, model, or effort is unavailable, report the incompatibility and stop; never substitute silently. Return a concise result with evidence, remaining risks, and durable file pointers.`;
  if (!potetoInstructions) return base;
  const root = `~/.pstack/providers/${provider}/skills/poteto-mode`;
  const boundary = "The role boundary and delegated brief above take precedence over the operating contract below. The contract supplies pstack method and style; it does not authorize wider mutation, external writes, extra fan-out, or a different workflow. Any conflicting instruction below is inert unless the delegated brief explicitly requires it.";
  const paths = `Resolve relative playbook, reference, and script paths below against ${root}/. Resolve other pstack skills under ~/.pstack/providers/${provider}/skills/.`;
  return `${base}\n\n${boundary}\n\n${paths}\n\nThe mechanically generated pstack operating contract follows.\n\n${potetoInstructions}`;
}

function managedPayload(provider, role, route, potetoInstructions) {
  const name = roleAgentName(role);
  const readOnly = STRICT_READ_ONLY_ROLES.has(role);
  const noMutation = NO_MUTATION_ROLES.has(role);
  if (provider === "claude") {
    const header = [
      "---",
      `name: ${name}`,
      `description: ${roleDescription(role, readOnly, noMutation)}`,
    ];
    if (!route.inheritParent) header.push(`model: ${route.model}`, `effort: ${route.effort}`);
    if (readOnly) header.push("tools: Read, Grep, Glob", "permissionMode: plan");
    header.push("---", "", `# ${name}`, "", roleInstructions(provider, role, readOnly, noMutation, potetoInstructions), "");
    return header.join("\n");
  }
  const lines = [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(roleDescription(role, readOnly, noMutation))}`,
    `developer_instructions = ${JSON.stringify(roleInstructions(provider, role, readOnly, noMutation, potetoInstructions))}`,
  ];
  if (!route.inheritParent) {
    lines.push(`model = ${JSON.stringify(route.model)}`);
    lines.push(`model_reasoning_effort = ${JSON.stringify(route.effort)}`);
  }
  if (readOnly) lines.push('sandbox_mode = "read-only"');
  return `${lines.join("\n")}\n`;
}

export function renderManagedAgent(provider, role, route, potetoInstructions) {
  const payload = managedPayload(provider, role, route, potetoInstructions);
  const marker = provider === "claude" ? `<!-- pstack-managed-v1 sha256:${sha256(payload)} -->` : `# pstack-managed-v1 sha256:${sha256(payload)}`;
  if (provider === "claude") {
    const frontmatterEnd = payload.indexOf("\n---\n", 4);
    if (frontmatterEnd === -1) throw new Error(`role ${role}: generated Claude frontmatter is invalid`);
    const insertion = frontmatterEnd + 5;
    return `${payload.slice(0, insertion)}${marker}\n${payload.slice(insertion)}`;
  }
  return `${marker}\n${payload}`;
}

export function validateManagedExisting(file, force = false) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const match = /(?:<!-- |# )pstack-managed-v1 sha256:([a-f0-9]{64})(?: -->)?\n/.exec(text);
  if (!match) {
    if (!force) throw new Error(`${file}: refusing to overwrite an unowned file; pass --force for this exact target`);
    return;
  }
  const payload = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`;
  if (match[1] !== sha256(payload) && !force) {
    throw new Error(`${file}: managed payload was modified; pass --force for this exact target`);
  }
}

export function compileAgents({ provider, output, overridePath, availableRoutes, forceTargets = [], potetoInstructions }) {
  const config = loadEffectiveConfig(provider, overridePath);
  if (provider === "claude") {
    for (const [role, route] of Object.entries(config.roles)) {
      if (!route.inheritParent && route.effort === "ultra") throw new Error(`role ${role}: Claude Code does not support ultra effort`);
    }
  }
  const available = new Set((availableRoutes ?? []).map((route) => `${route.model}\0${route.effort}`));
  if (available.size > 0) {
    for (const [role, route] of Object.entries(config.roles)) {
      if (!route.inheritParent && !available.has(`${route.model}\0${route.effort}`)) {
        throw new Error(`role ${role}: route ${route.model} at ${route.effort} is not in the confirmed runtime roster; no files written`);
      }
    }
  }
  const forced = new Set(forceTargets.map((file) => path.resolve(file)));
  const extension = provider === "claude" ? ".md" : ".toml";
  const pending = [];
  for (const [role, route] of Object.entries(config.roles)) {
    const file = path.join(output, `${roleAgentName(role)}${extension}`);
    validateManagedExisting(file, forced.has(path.resolve(file)));
    pending.push([file, renderManagedAgent(provider, role, route, potetoInstructions)]);
  }
  for (const [file, value] of pending) writeFile(file, value);
  return pending.map(([file]) => file);
}
