import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

for (const provider of ["claude", "codex"]) {
  test(`${provider} role workflows load the provider delegation contract`, () => {
    const skills = path.join(root, "dist", provider, "skills");
    const requiredPointer = `~/.pstack/providers/${provider}/runtime/DELEGATION.md`;
    const roleWorkflows = fs.readdirSync(skills, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(skills, entry.name, "SKILL.md"))
      .filter((file) => fs.existsSync(file) && path.basename(path.dirname(file)) !== "setup-pstack" && fs.readFileSync(file, "utf8").includes("pstack-role-"));

    assert(roleWorkflows.length > 0);
    for (const file of roleWorkflows) {
      assert.match(fs.readFileSync(file, "utf8"), new RegExp(requiredPointer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), file);
    }

    const contract = fs.readFileSync(path.join(root, "dist", provider, "runtime", "DELEGATION.md"), "utf8");
    assert.match(contract, /exact named custom agent/i);
    assert.match(contract, /never substitute a generic agent/i);
    assert.match(contract, /self-contained brief/i);
    if (provider === "codex") {
      assert.match(contract, /`pstack-poteto-agent`/);
      assert.match(contract, /fork_turns: "none"/);
    } else assert.match(contract, /`pstack:poteto-agent`/);
  });

  test(`${provider} specialized role profiles stay narrow`, () => {
    const agents = path.join(root, "dist", provider, "runtime", "agents");
    const extension = provider === "claude" ? ".md" : ".toml";
    const profiles = fs.readdirSync(agents)
      .filter((file) => file.startsWith("pstack-role-") && file.endsWith(extension));

    assert(profiles.length > 0);
    for (const profile of profiles) {
      const text = fs.readFileSync(path.join(agents, profile), "utf8");
      assert.doesNotMatch(text, /# Poteto mode/);
      assert.doesNotMatch(text, /Nontrivial change, architecture decision/);
      assert.match(text, /Do not invoke pstack skills or spawn subagents unless the delegated brief explicitly requires it\./);
    }
  });
}

test("the general Codex poteto helper retains the full operating contract", () => {
  const helper = fs.readFileSync(path.join(root, "dist", "codex", "runtime", "agents", "pstack-poteto-agent.toml"), "utf8");
  assert.match(helper, /# Poteto mode/);
  assert.match(helper, /Nontrivial change, architecture decision/);
});
