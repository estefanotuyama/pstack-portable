#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib.mjs";

function parseArgs() {
  const result = { providers: [], scopes: {}, forceTargets: [], dryRun: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provider") result.providers.push(...args[++i].split(","));
    else if (arg === "--scope") result.defaultScope = args[++i];
    else if (arg === "--claude-scope") result.scopes.claude = args[++i];
    else if (arg === "--codex-scope") result.scopes.codex = args[++i];
    else if (arg === "--project") result.project = path.resolve(args[++i]);
    else if (arg === "--home") result.home = path.resolve(args[++i]);
    else if (arg === "--force-target") result.forceTargets.push(path.resolve(args[++i]));
    else if (arg === "--simulation-bin") result.simulationBin = path.resolve(args[++i]);
    else if (arg === "--dry-run") result.dryRun = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function canForce(target, options) {
  return options.forceTargets.includes(path.resolve(target));
}

function executable(name, options) {
  if (options.simulationBin) {
    try {
      fs.accessSync(path.join(options.simulationBin, name), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return spawnSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" }).status === 0;
}

function ensureSymlink(source, target, options, actions) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (stat) {
    if (stat.isSymbolicLink() && path.resolve(path.dirname(target), fs.readlinkSync(target)) === source) return;
    if (!canForce(target, options)) throw new Error(`${target}: refusing to replace an unmanaged target; rerun with --force-target ${target}`);
    actions.push({ action: "replace", target, source });
    if (!options.dryRun) fs.rmSync(target, { recursive: true, force: true });
  } else actions.push({ action: "link", target, source });
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(source, target, "dir");
  }
}

function updateMarketplace(file, pluginPath, marketplaceRoot, scope, options, actions) {
  const marketplace = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { name: scope === "personal" ? "personal" : "pstack-project", interface: { displayName: scope === "personal" ? "Personal" : "pstack project" }, plugins: [] };
  if (!Array.isArray(marketplace.plugins) || typeof marketplace.name !== "string") throw new Error(`${file}: invalid marketplace`);
  const entry = {
    name: "pstack",
    source: { source: "local", path: `./${path.relative(marketplaceRoot, pluginPath).split(path.sep).join("/")}` },
    policy: { installation: scope === "project" ? "INSTALLED_BY_DEFAULT" : "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Productivity",
  };
  const index = marketplace.plugins.findIndex((item) => item?.name === "pstack");
  if (index !== -1) {
    const current = JSON.stringify(marketplace.plugins[index]);
    if (current !== JSON.stringify(entry) && !canForce(file, options)) throw new Error(`${file}: pstack entry exists with different ownership or policy; pass --force-target ${file}`);
    marketplace.plugins[index] = entry;
  } else marketplace.plugins.push(entry);
  actions.push({ action: "marketplace", target: file, pluginPath });
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temp, `${JSON.stringify(marketplace, null, 2)}\n`);
    fs.renameSync(temp, file);
  }
  return marketplace.name;
}

function runNative(command, options) {
  const executablePath = options.simulationBin ? path.join(options.simulationBin, command[0]) : command[0];
  const env = options.simulationBin
    ? {
        ...process.env,
        PSTACK_SIM_HOME: options.home,
        PSTACK_SIM_STATE: path.join(options.home, ".pstack", "simulation"),
      }
    : process.env;
  const result = spawnSync(executablePath, command.slice(1), { cwd: options.project ?? ROOT, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command.join(" ")} failed with ${result.status}`);
}

function installStickyAgents(base, scope, options, actions) {
  const root = scope === "personal" ? path.join(base, ".codex") : base;
  const override = path.join(root, "AGENTS.override.md");
  const normal = path.join(root, "AGENTS.md");
  const file = fs.existsSync(override) && fs.readFileSync(override, "utf8").trim() ? override : normal;
  const body = "If `$pstack:poteto-mode` has been invoked in the current conversation, keep applying it across turns until the user explicitly opts out. Do not activate it merely because this file exists.";
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  const start = `<!-- pstack-managed-start sha256:${hash} -->`;
  const end = "<!-- pstack-managed-end -->";
  const block = `${start}\n${body}\n${end}`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const pattern = /<!-- pstack-managed-start sha256:([a-f0-9]{64}) -->[\s\S]*?<!-- pstack-managed-end -->/;
  const match = pattern.exec(current);
  if (match && match[0] !== block && !canForce(file, options)) throw new Error(`${file}: managed pstack block was modified; rerun with --force-target ${file}`);
  const next = match ? current.replace(pattern, block) : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`;
  actions.push({ action: "managed-block", target: file });
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next);
  }
}

async function select(options) {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    if (options.providers.length === 0) {
      if (!interactive) throw new Error("--provider is required without a TTY");
      const detected = [executable("claude", options) ? "claude" : null, executable("codex", options) ? "codex" : null].filter(Boolean);
      const answer = await rl.question(`Providers (${detected.join(", ") || "none detected"}; comma-separated): `);
      options.providers = answer.split(",").map((value) => value.trim()).filter(Boolean);
    }
    options.providers = [...new Set(options.providers)];
    for (const provider of options.providers) {
      if (!['claude', 'codex'].includes(provider)) throw new Error(`unsupported provider: ${provider}`);
      if (!options.scopes[provider]) options.scopes[provider] = options.defaultScope;
      if (!options.scopes[provider]) {
        if (!interactive) throw new Error(`scope required for ${provider}`);
        const choices = provider === "claude" ? "personal/project/local" : "personal/project";
        options.scopes[provider] = (await rl.question(`${provider} scope (${choices}) [personal]: `)).trim() || "personal";
      }
      const allowed = provider === "claude" ? ["personal", "project", "local"] : ["personal", "project"];
      if (!allowed.includes(options.scopes[provider])) throw new Error(`${provider}: scope must be ${allowed.join(", ")}`);
    }
    if (options.providers.some((provider) => ["project", "local"].includes(options.scopes[provider])) && !options.project) {
      if (!interactive) throw new Error("--project is required for project or local scope; the installer will not guess from its own checkout");
      const answer = (await rl.question("Absolute project path: ")).trim();
      if (!path.isAbsolute(answer)) throw new Error("project path must be absolute");
      options.project = path.resolve(answer);
    }
  } finally {
    await rl?.close();
  }
}

async function main() {
  const options = parseArgs();
  await select(options);
  if (options.simulationBin) {
    if (options.dryRun) throw new Error("--simulation-bin and --dry-run are mutually exclusive");
    if (!options.home) throw new Error("--simulation-bin requires an explicit --home");
    const expected = fs.realpathSync(path.join(ROOT, "scripts", "simulation", "bin"));
    if (fs.realpathSync(options.simulationBin) !== expected) throw new Error(`--simulation-bin must be the repository test shim directory: ${expected}`);
    if (!fs.existsSync(options.home) || !fs.statSync(options.home).isDirectory()) throw new Error("--simulation-bin requires an existing isolated --home directory");
    if (fs.realpathSync(options.home) === fs.realpathSync(os.homedir())) throw new Error("--simulation-bin refuses the real home directory");
  }
  options.home ??= os.homedir();
  if (options.project && (!fs.existsSync(options.project) || !fs.statSync(options.project).isDirectory())) throw new Error(`${options.project}: project must be an existing directory`);
  if (!options.dryRun && !options.simulationBin && options.home !== os.homedir()) throw new Error("--home is a dry-run or simulation test seam and cannot be used for live native registration");
  const actions = [];

  if (!options.dryRun) {
    for (const provider of options.providers) {
      if (!executable(provider, options)) throw new Error(`${provider} executable is required for native plugin registration`);
    }
  }

  for (const provider of options.providers) {
    const scope = options.scopes[provider];
    const source = path.join(ROOT, "dist", provider);
    if (!fs.existsSync(source)) throw new Error(`${source}: run npm run generate first`);
    const runtimePointer = path.join(options.home, ".pstack", "providers", provider);
    ensureSymlink(source, runtimePointer, options, actions);
    if (provider === "claude") {
      const nativeScope = scope === "personal" ? "user" : scope;
      const commands = [
        ["claude", "plugin", "marketplace", "add", ROOT, "--scope", nativeScope],
        ["claude", "plugin", "install", "pstack@pstack-portable", "--scope", nativeScope],
      ];
      for (const command of commands) actions.push({ action: "native-command", command });
      if (!options.dryRun) {
        for (const command of commands) runNative(command, options);
      }
    } else {
      const pluginTarget = scope === "personal"
        ? path.join(options.home, "plugins", "pstack")
        : path.join(options.project, "plugins", "pstack");
      ensureSymlink(source, pluginTarget, options, actions);
      const marketplace = scope === "personal"
        ? path.join(options.home, ".agents", "plugins", "marketplace.json")
        : path.join(options.project, ".agents", "plugins", "marketplace.json");
      const marketplaceRoot = scope === "personal" ? options.home : options.project;
      const marketplaceName = updateMarketplace(marketplace, pluginTarget, marketplaceRoot, scope, options, actions);
      installStickyAgents(scope === "personal" ? options.home : options.project, scope, options, actions);
      const commands = scope === "personal"
        ? [["codex", "plugin", "add", `pstack@${marketplaceName}`]]
        : [
            ["codex", "plugin", "marketplace", "add", options.project],
            ["codex", "plugin", "add", `pstack@${marketplaceName}`],
          ];
      for (const command of commands) actions.push({ action: "native-command", command });
      if (!options.dryRun) for (const command of commands) runNative(command, options);
    }
  }
  console.log(JSON.stringify({ dryRun: options.dryRun, simulation: Boolean(options.simulationBin), actions, next: "Start a new provider session, run setup-pstack, and confirm the runtime model roster before profiles are written." }, null, 2));
}

await main();
