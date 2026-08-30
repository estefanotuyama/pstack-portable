#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ROOT, compileAgents, listFiles, validateManagedExisting, writeFile } from "./lib.mjs";

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: node scripts/compile-agents.mjs --provider claude|codex --available-route <model> <effort> [--available-route <model> <effort> ...] [--output <dir>] [--config <file>] [--project <repo>] [--force-target <file> ...]");
  process.exit(2);
}

const args = process.argv.slice(2);
const options = { availableRoutes: [], forceTargets: [] };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--provider") options.provider = args[++i];
  else if (arg === "--available-route") options.availableRoutes.push({ model: args[++i], effort: args[++i] });
  else if (arg === "--output") options.output = path.resolve(args[++i]);
  else if (arg === "--config") options.overridePath = path.resolve(args[++i]);
  else if (arg === "--project") options.project = path.resolve(args[++i]);
  else if (arg === "--force-target") options.forceTargets.push(path.resolve(args[++i]));
  else usage(`unknown argument: ${arg}`);
}
if (!['claude', 'codex'].includes(options.provider)) usage("--provider is required");
if (options.availableRoutes.length === 0 || options.availableRoutes.some((route) => !route.model || !route.effort)) usage("at least one complete --available-route <model> <effort> is required; compile refuses an unverified roster");

const home = os.homedir();
options.output ??= options.provider === "claude"
  ? path.join(home, ".claude", "agents", "pstack")
  : path.join(home, ".codex", "agents");
options.overridePath ??= path.join(home, ".pstack", "config", `${options.provider}.json`);

if (options.provider === "claude") {
  for (const variable of ["CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_EFFORT_LEVEL"]) {
    if (process.env[variable]) throw new Error(`${variable} shadows generated pstack routing; unset it or stop setup`);
  }
}

if (options.project) {
  const collisionRoot = options.provider === "claude"
    ? path.join(options.project, ".claude", "agents")
    : path.join(options.project, ".codex", "agents");
  if (fs.existsSync(collisionRoot)) {
    const extension = options.provider === "claude" ? ".md" : ".toml";
    const collisions = listFiles(collisionRoot)
      .filter((file) => file.endsWith(extension))
      .map((file) => {
        const text = fs.readFileSync(path.join(collisionRoot, file), "utf8");
        const match = options.provider === "claude"
          ? /^name:\s*([^\n]+)$/m.exec(text)
          : /^name\s*=\s*"([^"]+)"\s*$/m.exec(text);
        return match && (match[1].startsWith("pstack-role-") || ["pstack-poteto-agent", "pstack-comment-sicko"].includes(match[1])) ? `${file} (${match[1]})` : null;
      })
      .filter(Boolean);
    if (collisions.length) throw new Error(`project profiles would shadow personal pstack routing: ${collisions.join(", ")}`);
  }
}

const helpers = [];
if (options.provider === "codex") {
  const installedPlugin = fs.existsSync(path.join(ROOT, "dist", options.provider, "skills", "poteto-mode", "SKILL.md"))
    ? path.join(ROOT, "dist", options.provider)
    : ROOT;
  for (const file of ["pstack-poteto-agent.toml", "pstack-comment-sicko.toml"]) {
    const source = path.join(installedPlugin, "runtime", "agents", file);
    const target = path.join(options.output, file);
    validateManagedExisting(target, options.forceTargets.includes(path.resolve(target)));
    helpers.push([target, fs.readFileSync(source, "utf8")]);
  }
}
const written = compileAgents(options);

for (const [target, value] of helpers) {
    writeFile(target, value);
    written.push(target);
}

console.log(JSON.stringify({ provider: options.provider, written }, null, 2));
