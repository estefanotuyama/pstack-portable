import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function install(args) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), ...args], { cwd: root, encoding: "utf8" });
}

test("personal multi-provider dry run preserves provider-specific scope", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-home-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-project-"));
  const result = install(["--provider", "claude,codex", "--scope", "personal", "--home", home, "--project", project, "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert(value.actions.some((action) => action.target === path.join(home, ".pstack", "providers", "claude")));
  assert(value.actions.some((action) => action.command?.join(" ") === "claude plugin marketplace add " + root + " --scope user"));
  assert(value.actions.some((action) => action.command?.join(" ") === "claude plugin install pstack@pstack-portable --scope user"));
  assert(value.actions.some((action) => action.target === path.join(home, "plugins", "pstack")));
  assert(value.actions.some((action) => action.target === path.join(home, ".agents", "plugins", "marketplace.json")));
  assert(value.actions.some((action) => action.command?.join(" ") === "codex plugin add pstack@personal"));
});

test("project dry run plans only the requested provider project registration", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-home-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-project-"));
  const result = install(["--provider", "codex", "--scope", "project", "--home", home, "--project", project, "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert(value.actions.some((action) => action.target === path.join(project, "plugins", "pstack")));
  assert(value.actions.some((action) => action.target === path.join(project, ".agents", "plugins", "marketplace.json")));
  assert(value.actions.some((action) => action.target === path.join(project, "AGENTS.md")));
  assert(value.actions.some((action) => action.command?.join(" ") === `codex plugin marketplace add ${project}`));
  assert(value.actions.some((action) => action.command?.join(" ") === "codex plugin add pstack@pstack-project"));
  assert.equal(value.actions.some((action) => action.target?.includes(".claude")), false);
  assert.equal(value.actions.some((action) => action.target?.includes(path.join(".pstack", "skills"))), false);
});

test("project and local scopes require an explicit project", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-home-"));
  const result = install(["--provider", "claude", "--scope", "local", "--home", home, "--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--project is required/);
});

test("installer refuses an unmanaged target", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-home-"));
  const target = path.join(home, ".pstack", "providers", "claude");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "mine"), "keep");
  const result = install(["--provider", "claude", "--scope", "personal", "--home", home, "--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to replace an unmanaged target/);
  assert.equal(fs.readFileSync(path.join(target, "mine"), "utf8"), "keep");
});

test("custom live home requires the repository simulation shim", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-home-"));
  const result = install(["--provider", "claude", "--scope", "personal", "--home", home]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be used for live native registration/);
  assert.equal(fs.existsSync(path.join(home, ".pstack")), false);
});

test("simulation refuses arbitrary shims and aliases of the real home", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-home-"));
  const arbitraryBin = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-bin-"));
  const arbitrary = install(["--provider", "claude", "--scope", "personal", "--home", home, "--simulation-bin", arbitraryBin]);
  assert.notEqual(arbitrary.status, 0);
  assert.match(arbitrary.stderr, /must be the repository test shim directory/);

  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-home-alias-"));
  const homeAlias = path.join(aliasRoot, "home");
  fs.symlinkSync(os.homedir(), homeAlias, "dir");
  const aliased = install(["--provider", "claude", "--scope", "personal", "--home", homeAlias, "--simulation-bin", path.join(root, "scripts", "simulation", "bin")]);
  assert.notEqual(aliased.status, 0);
  assert.match(aliased.stderr, /refuses the real home directory/);
});

test("isolated end-to-end installation simulation passes", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "simulate-install.mjs")], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const value = JSON.parse(result.stdout);
  assert.equal(value.result, "passed");
  assert.equal(value.kept, false);
  assert.equal(value.compiled.claude > 0, true);
  assert.equal(value.compiled.codex, value.compiled.claude + 2);
  assert.equal(fs.existsSync(value.isolatedRoot), false);
});
