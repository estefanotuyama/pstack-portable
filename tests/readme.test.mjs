import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

for (const [provider, display, setup, mode] of [
  ["claude", "Claude Code", "/pstack:setup-pstack", "/pstack:poteto-mode"],
  ["codex", "Codex", "$pstack:setup-pstack", "$pstack:poteto-mode"],
]) {
  test(`${provider} distribution README describes the port in a neutral voice`, () => {
    const readme = fs.readFileSync(path.join(root, "dist", provider, "README.md"), "utf8");
    assert.match(readme, new RegExp(`^# pstack for ${display}$`, "m"));
    assert.match(readme, /generated .* distribution from \[pstack portable\]/i);
    assert.match(readme, /Upstream pstack was created by \[Lauren Tan \(poteto\)\]/);
    assert.match(readme, new RegExp(setup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(readme, new RegExp(mode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(readme, /i'm \[poteto\]|pstack is my answer|these are the same skills i use/i);
  });
}
