#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { ROOT, readJson, sha256, treeHash } from "./lib.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--keep")) throw new Error("Usage: node scripts/simulate-install.mjs [--keep]");
const keep = args.includes("--keep");
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-install-sim-"));
const simulationBin = path.join(ROOT, "scripts", "simulation", "bin");

function runNode(script, childArgs, cwd = ROOT, env = process.env) {
  const result = spawnSync(process.execPath, [script, ...childArgs], { cwd, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${path.basename(script)} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function createScenario(name) {
  const root = path.join(isolatedRoot, name);
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return { name, root, home, project };
}

function install(scenario, installArgs) {
  return runNode(path.join(ROOT, "scripts", "install.mjs"), [
    ...installArgs,
    "--home", scenario.home,
    "--simulation-bin", simulationBin,
  ], scenario.project);
}

function stateFile(scenario, provider, name) {
  return path.join(scenario.home, ".pstack", "simulation", provider, name);
}

function assertLink(link, provider) {
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, `${link} is not a symlink`);
  assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(ROOT, "dist", provider)));
}

function assertManagedHash(file) {
  const text = fs.readFileSync(file, "utf8");
  const match = /(?:<!-- |# )pstack-managed-v1 sha256:([a-f0-9]{64})(?: -->)?\n/.exec(text);
  assert(match, `${file} lacks a managed hash`);
  const payload = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`;
  assert.equal(match[1], sha256(payload), `${file} has a stale managed hash`);
}

function assertCachedInstall(scenario, provider, scope) {
  const installed = readJson(stateFile(scenario, provider, "installed.json"));
  assert.equal(installed.length, 1);
  assert.equal(installed[0].scope, scope);
  const expected = path.join(ROOT, "dist", provider);
  assert.equal(treeHash(installed[0].cache), treeHash(expected), `${provider} simulated cache differs from dist`);
  const manifestDirectory = provider === "claude" ? ".claude-plugin" : ".codex-plugin";
  const cachedManifest = readJson(path.join(installed[0].cache, manifestDirectory, "plugin.json"));
  const sourceManifest = readJson(path.join(expected, manifestDirectory, "plugin.json"));
  assert.equal(cachedManifest.name, "pstack");
  assert.equal(cachedManifest.version, sourceManifest.version);
  return installed[0];
}

function availableRouteArgs(config) {
  const routes = new Map();
  for (const route of Object.values(config.roles)) {
    if (route.inheritParent) continue;
    routes.set(`${route.model}\0${route.effort}`, route);
  }
  return [...routes.values()].flatMap((route) => ["--available-route", route.model, route.effort]);
}

function compileAndCheck(scenario, provider) {
  const runtime = path.join(scenario.home, ".pstack", "providers", provider);
  const config = readJson(path.join(runtime, "config", "defaults", `${provider}.json`));
  const output = path.join(scenario.root, "compiled", provider);
  const cleanRoutingEnv = { ...process.env };
  delete cleanRoutingEnv.CLAUDE_CODE_SUBAGENT_MODEL;
  delete cleanRoutingEnv.CLAUDE_CODE_EFFORT_LEVEL;
  const result = runNode(path.join(runtime, "runtime", "compile-agents.mjs"), [
    "--provider", provider,
    ...availableRouteArgs(config),
    "--output", output,
    "--config", path.join(scenario.home, ".pstack", "config", `${provider}.json`),
    "--project", scenario.project,
  ], scenario.project, cleanRoutingEnv);
  const extension = provider === "claude" ? ".md" : ".toml";
  const expected = Object.keys(config.roles).map((role) => `pstack-role-${role}${extension}`);
  if (provider === "codex") expected.push("pstack-poteto-agent.toml", "pstack-comment-sicko.toml");
  assert.deepEqual(fs.readdirSync(output).sort(), expected.sort());
  assert.equal(result.written.length, expected.length);
  for (const [role, route] of Object.entries(config.roles)) {
    const file = path.join(output, `pstack-role-${role}${extension}`);
    assertManagedHash(file);
    const text = fs.readFileSync(file, "utf8");
    if (!route.inheritParent && provider === "claude") {
      assert.match(text, new RegExp(`^model: ${route.model.replaceAll(".", "\\.")}$`, "m"));
      assert.match(text, new RegExp(`^effort: ${route.effort}$`, "m"));
    } else if (!route.inheritParent) {
      assert(text.includes(`model = ${JSON.stringify(route.model)}`));
      assert(text.includes(`model_reasoning_effort = ${JSON.stringify(route.effort)}`));
    }
  }
  return { output, profiles: expected.length };
}

function assertNoLegacySkillTree(scenario) {
  assert.equal(fs.existsSync(path.join(scenario.home, ".pstack", "skills")), false);
  assert.equal(fs.existsSync(path.join(scenario.project, ".pstack", "skills")), false);
}

try {
  const personal = createScenario("personal");
  const personalInstall = install(personal, ["--provider", "claude,codex", "--scope", "personal"]);
  assert.equal(personalInstall.simulation, true);
  assertLink(path.join(personal.home, ".pstack", "providers", "claude"), "claude");
  assertLink(path.join(personal.home, ".pstack", "providers", "codex"), "codex");
  assertLink(path.join(personal.home, "plugins", "pstack"), "codex");
  const personalMarketplace = readJson(path.join(personal.home, ".agents", "plugins", "marketplace.json"));
  assert.equal(personalMarketplace.plugins[0].source.path, "./plugins/pstack");
  assert.equal(personalMarketplace.plugins[0].policy.installation, "AVAILABLE");
  assert(fs.readFileSync(path.join(personal.home, ".codex", "AGENTS.md"), "utf8").includes("pstack-managed-start"));
  assertNoLegacySkillTree(personal);
  const personalClaude = assertCachedInstall(personal, "claude", "user");
  const personalCodex = assertCachedInstall(personal, "codex", "personal");
  const personalClaudeCommands = readJson(stateFile(personal, "claude", "commands.json"));
  const personalCodexCommands = readJson(stateFile(personal, "codex", "commands.json"));
  assert.deepEqual(personalClaudeCommands, [
    ["plugin", "marketplace", "add", ROOT, "--scope", "user"],
    ["plugin", "install", "pstack@pstack-portable", "--scope", "user"],
  ]);
  assert.deepEqual(personalCodexCommands, [["plugin", "add", "pstack@personal"]]);

  const project = createScenario("project");
  const projectInstall = install(project, ["--provider", "claude,codex", "--scope", "project", "--project", project.project]);
  assert.equal(projectInstall.simulation, true);
  assertLink(path.join(project.project, "plugins", "pstack"), "codex");
  const projectMarketplace = readJson(path.join(project.project, ".agents", "plugins", "marketplace.json"));
  assert.equal(projectMarketplace.plugins[0].source.path, "./plugins/pstack");
  assert.equal(projectMarketplace.plugins[0].policy.installation, "INSTALLED_BY_DEFAULT");
  assert(fs.readFileSync(path.join(project.project, "AGENTS.md"), "utf8").includes("pstack-managed-start"));
  assert.equal(fs.existsSync(path.join(project.home, ".codex", "AGENTS.md")), false);
  assertNoLegacySkillTree(project);
  const projectClaude = assertCachedInstall(project, "claude", "project");
  const projectCodex = assertCachedInstall(project, "codex", "project");
  const projectClaudeCommands = readJson(stateFile(project, "claude", "commands.json"));
  const projectCodexCommands = readJson(stateFile(project, "codex", "commands.json"));
  assert.deepEqual(projectClaudeCommands, [
    ["plugin", "marketplace", "add", ROOT, "--scope", "project"],
    ["plugin", "install", "pstack@pstack-portable", "--scope", "project"],
  ]);
  assert.deepEqual(projectCodexCommands, [
    ["plugin", "marketplace", "add", project.project],
    ["plugin", "add", "pstack@pstack-project"],
  ]);

  const local = createScenario("local");
  const localInstall = install(local, ["--provider", "claude", "--scope", "local", "--project", local.project]);
  assert.equal(localInstall.simulation, true);
  assertLink(path.join(local.home, ".pstack", "providers", "claude"), "claude");
  assertNoLegacySkillTree(local);
  const localClaude = assertCachedInstall(local, "claude", "local");
  const localClaudeCommands = readJson(stateFile(local, "claude", "commands.json"));
  assert.deepEqual(localClaudeCommands, [
    ["plugin", "marketplace", "add", ROOT, "--scope", "local"],
    ["plugin", "install", "pstack@pstack-portable", "--scope", "local"],
  ]);
  assert.equal(fs.existsSync(stateFile(local, "codex", "installed.json")), false);

  const compiled = {
    claude: compileAndCheck(personal, "claude"),
    codex: compileAndCheck(personal, "codex"),
  };
  const summary = {
    result: "passed",
    isolatedRoot,
    kept: keep,
    scenarios: {
      personal: { providers: [personalClaude, personalCodex].map(({ plugin, marketplace, scope, version }) => ({ plugin, marketplace, scope, version })) },
      project: { providers: [projectClaude, projectCodex].map(({ plugin, marketplace, scope, version }) => ({ plugin, marketplace, scope, version })) },
      local: { providers: [localClaude].map(({ plugin, marketplace, scope, version }) => ({ plugin, marketplace, scope, version })) },
    },
    compiled: {
      claude: compiled.claude.profiles,
      codex: compiled.codex.profiles,
    },
    boundary: "Provider registration and cache behavior used deterministic local shims; no authenticated provider session or model call ran.",
  };
  if (!keep) fs.rmSync(isolatedRoot, { recursive: true });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(`Simulation artifacts preserved at ${isolatedRoot}`);
  throw error;
}
