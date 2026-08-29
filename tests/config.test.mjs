import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compileAgents, loadEffectiveConfig } from "../scripts/lib.mjs";

test("sparse overrides change only named roles", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-config-"));
  const override = path.join(root, "codex.json");
  fs.writeFileSync(override, JSON.stringify({ schemaVersion: 1, roles: { feature: { inheritParent: true } } }));
  const config = loadEffectiveConfig("codex", override);
  assert.deepEqual(config.roles.feature, { inheritParent: true });
  assert.deepEqual(config.roles["how-explorer"], { model: "gpt-5.6-luna", effort: "xhigh" });
});

test("unknown roles fail before writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-config-"));
  const override = path.join(root, "codex.json");
  const output = path.join(root, "agents");
  fs.writeFileSync(override, JSON.stringify({ schemaVersion: 1, roles: { unknown: { inheritParent: true } } }));
  assert.throws(() => compileAgents({ provider: "codex", output, overridePath: override }), /unknown role/);
  assert.equal(fs.existsSync(output), false);
});

test("unavailable models fail before writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-config-"));
  const output = path.join(root, "agents");
  assert.throws(() => compileAgents({ provider: "codex", output, availableRoutes: [{ model: "gpt-5.6-sol", effort: "max" }] }), /not in the confirmed runtime roster/);
  assert.equal(fs.existsSync(output), false);
});

test("unavailable model-effort pairs fail before writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-config-"));
  const output = path.join(root, "agents");
  const availableRoutes = [
    { model: "gpt-5.6-sol", effort: "max" },
    { model: "gpt-5.6-sol", effort: "xhigh" },
    { model: "gpt-5.6-terra", effort: "xhigh" },
    { model: "gpt-5.6-luna", effort: "max" },
  ];
  assert.throws(() => compileAgents({ provider: "codex", output, availableRoutes }), /gpt-5\.6-luna at xhigh/);
  assert.equal(fs.existsSync(output), false);
});

test("managed profile modification is guarded", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-config-"));
  const availableRoutes = [
    { model: "gpt-5.6-sol", effort: "max" },
    { model: "gpt-5.6-sol", effort: "xhigh" },
    { model: "gpt-5.6-terra", effort: "xhigh" },
    { model: "gpt-5.6-luna", effort: "xhigh" },
  ];
  compileAgents({ provider: "codex", output: root, availableRoutes, potetoInstructions: "contract" });
  const file = path.join(root, "pstack-role-feature.toml");
  fs.appendFileSync(file, "modified\n");
  assert.throws(() => compileAgents({ provider: "codex", output: root, availableRoutes, potetoInstructions: "contract" }), /managed payload was modified/);
});

test("modified Codex helper fails before role profiles are updated", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-config-"));
  const script = path.resolve(import.meta.dirname, "..", "scripts", "compile-agents.mjs");
  const routes = [
    ["gpt-5.6-sol", "max"],
    ["gpt-5.6-sol", "xhigh"],
    ["gpt-5.6-terra", "xhigh"],
    ["gpt-5.6-luna", "xhigh"],
  ];
  const args = [script, "--provider", "codex", "--output", root, ...routes.flatMap(([model, effort]) => ["--available-route", model, effort])];
  const first = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const role = path.join(root, "pstack-role-feature.toml");
  const before = fs.readFileSync(role, "utf8");
  fs.appendFileSync(path.join(root, "pstack-poteto-agent.toml"), "modified\n");
  const override = path.join(root, "override.json");
  fs.writeFileSync(override, JSON.stringify({ schemaVersion: 1, roles: { feature: { inheritParent: true } } }));
  const second = spawnSync(process.execPath, [...args, "--config", override], { encoding: "utf8" });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /managed payload was modified/);
  assert.equal(fs.readFileSync(role, "utf8"), before);
});
