import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function fail(message) {
  throw new Error(`pstack ${message}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function simulationPaths(provider) {
  const home = path.resolve(process.env.PSTACK_SIM_HOME ?? fail("simulation requires PSTACK_SIM_HOME"));
  const state = path.resolve(process.env.PSTACK_SIM_STATE ?? fail("simulation requires PSTACK_SIM_STATE"));
  const expectedState = path.join(home, ".pstack", "simulation");
  if (state !== expectedState) fail(`simulation state must be ${expectedState}`);
  return { home, state: path.join(state, provider) };
}

function recordCommand(state, args) {
  const file = path.join(state, "commands.json");
  const commands = fs.existsSync(file) ? readJson(file) : [];
  commands.push(args);
  writeJson(file, commands);
}

function codexMarketplaceRoot(file) {
  const suffix = path.join(".agents", "plugins", "marketplace.json");
  if (!file.endsWith(suffix)) fail(`cannot determine Codex marketplace root for ${file}`);
  return path.dirname(path.dirname(path.dirname(file)));
}

function marketplaceFile(provider, source) {
  const file = provider === "claude"
    ? path.join(source, ".claude-plugin", "marketplace.json")
    : path.join(source, ".agents", "plugins", "marketplace.json");
  if (!fs.existsSync(file)) fail(`${provider} marketplace is missing ${file}`);
  return file;
}

function resolveEntry(provider, file, pluginName) {
  const marketplace = readJson(file);
  const entry = marketplace.plugins?.find((candidate) => candidate?.name === pluginName);
  if (!entry) fail(`${file} does not declare ${pluginName}`);
  const relative = provider === "claude" ? entry.source : entry.source?.path;
  const sourceKind = provider === "codex" ? entry.source?.source : "local";
  if (typeof relative !== "string" || sourceKind !== "local") fail(`${file} has an unsupported source for ${pluginName}`);
  const root = provider === "claude"
    ? path.dirname(path.dirname(file))
    : codexMarketplaceRoot(file);
  const pluginRoot = path.resolve(root, relative);
  const manifest = path.join(pluginRoot, provider === "claude" ? ".claude-plugin" : ".codex-plugin", "plugin.json");
  if (!fs.existsSync(manifest)) fail(`${pluginName} source does not contain ${manifest}`);
  return { marketplace, pluginRoot, manifest: readJson(manifest) };
}

function registryFile(state) {
  return path.join(state, "marketplaces.json");
}

function registerMarketplace(provider, state, source) {
  const file = marketplaceFile(provider, path.resolve(source));
  const payload = readJson(file);
  if (typeof payload.name !== "string" || !Array.isArray(payload.plugins)) fail(`${file} is not a marketplace`);
  const plugins = {};
  for (const entry of payload.plugins) {
    if (typeof entry?.name !== "string") continue;
    const resolved = resolveEntry(provider, file, entry.name);
    const snapshot = path.join(state, "marketplaces", payload.name, "plugins", entry.name);
    if (fs.existsSync(snapshot)) fail(`duplicate simulated marketplace snapshot ${snapshot}`);
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    fs.cpSync(resolved.pluginRoot, snapshot, { recursive: true, dereference: true });
    plugins[entry.name] = snapshot;
  }
  const filePath = registryFile(state);
  const registry = fs.existsSync(filePath) ? readJson(filePath) : {};
  registry[payload.name] = { source: path.resolve(source), plugins };
  writeJson(filePath, registry);
  return payload.name;
}

function installPlugin(provider, paths, selector, scope) {
  const [pluginName, marketplaceName, extra] = selector.split("@");
  if (!pluginName || !marketplaceName || extra) fail(`invalid plugin selector ${selector}`);
  let pluginRoot;
  if (provider === "codex" && marketplaceName === "personal") {
    const file = path.join(paths.home, ".agents", "plugins", "marketplace.json");
    pluginRoot = resolveEntry(provider, file, pluginName).pluginRoot;
  } else {
    const file = registryFile(paths.state);
    const registry = fs.existsSync(file) ? readJson(file) : {};
    pluginRoot = registry[marketplaceName]?.plugins?.[pluginName];
    if (!pluginRoot) fail(`${selector} is not present in a registered marketplace`);
  }
  const manifestPath = path.join(pluginRoot, provider === "claude" ? ".claude-plugin" : ".codex-plugin", "plugin.json");
  const manifest = readJson(manifestPath);
  if (manifest.name !== pluginName || typeof manifest.version !== "string") fail(`${manifestPath} has invalid identity metadata`);
  const cache = path.join(paths.state, "cache", scope, pluginName, manifest.version);
  if (fs.existsSync(cache)) fail(`duplicate simulated install cache ${cache}`);
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.cpSync(pluginRoot, cache, { recursive: true, dereference: true });
  const installedFile = path.join(paths.state, "installed.json");
  const installed = fs.existsSync(installedFile) ? readJson(installedFile) : [];
  installed.push({ plugin: pluginName, marketplace: marketplaceName, scope, version: manifest.version, cache });
  writeJson(installedFile, installed);
}

function exact(args, expected) {
  return args.length === expected.length && args.every((value, index) => value === expected[index]);
}

export function simulateProvider(provider) {
  if (!["claude", "codex"].includes(provider)) fail(`unsupported provider ${provider}`);
  const args = process.argv.slice(2);
  const paths = simulationPaths(provider);
  recordCommand(paths.state, args);

  if (provider === "claude" && args.length === 6 && exact(args.slice(0, 3), ["plugin", "marketplace", "add"]) && args[4] === "--scope") {
    registerMarketplace(provider, paths.state, args[3]);
    return;
  }
  if (provider === "claude" && args.length === 5 && exact(args.slice(0, 2), ["plugin", "install"]) && args[3] === "--scope") {
    if (!["user", "project", "local"].includes(args[4])) fail(`unsupported Claude scope ${args[4]}`);
    installPlugin(provider, paths, args[2], args[4]);
    return;
  }
  if (provider === "codex" && args.length === 4 && exact(args.slice(0, 3), ["plugin", "marketplace", "add"])) {
    registerMarketplace(provider, paths.state, args[3]);
    return;
  }
  if (provider === "codex" && args.length === 3 && exact(args.slice(0, 2), ["plugin", "add"])) {
    const marketplaceName = args[2].split("@")[1];
    installPlugin(provider, paths, args[2], marketplaceName === "personal" ? "personal" : "project");
    return;
  }
  fail(`${provider} shim rejects unsupported command: ${args.join(" ")}`);
}
