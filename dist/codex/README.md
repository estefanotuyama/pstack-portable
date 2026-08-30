# pstack for Codex

This directory is the generated Codex distribution from [pstack portable](https://github.com/estefanotuyama/pstack-portable). It adapts the upstream pstack plugin to provider-native skills, agent profiles, paths, question tools, and long-running-work mechanics.

Upstream pstack was created by [Lauren Tan (poteto)](https://github.com/poteto). The portable repository preserves provider-neutral source files byte for byte and records every provider-specific transformation, omission, rename, and addition in its portability manifests.

## Install

From a clone of the portable repository:

```bash
node scripts/install.mjs --provider codex --scope personal
```

For project scope, pass `--scope project --project /absolute/path/to/repo`. The installer uses Codex's native plugin registration and refuses unmanaged collisions.

Start a new task after installation, then configure the role mappings:

```text
$pstack:setup-pstack
```

Setup validates the available model and effort pairs, writes only personal overrides, and compiles guarded native profiles. Start another new task after setup so Codex loads them.

## Use

Invoke the main workflow with:

```text
$pstack:poteto-mode
```

The mode selects a playbook and routes each delegated role through its configured native profile. See the [pstack guide](./docs/guide/README.md) for the workflow and the [setup skill](./skills/setup-pstack/SKILL.md) for routing details.

## Port guarantees

- `upstream/pstack/` in the portable repository is the immutable source snapshot.
- Provider-neutral files remain byte-identical.
- Provider adaptations are deterministic and hash-recorded.
- Missing native profiles, models, efforts, or exact fan-out fail closed instead of silently falling back.
- The current compatibility label is `behavior-unverified`. Static checks validate the port mechanics, not identical model behavior.

Do not edit this generated directory directly. Change the portable generator or provider configuration, run `npm run accept-generation`, and review the resulting manifest and hashes.

## License

MIT. See [LICENSE](./LICENSE) and the portable repository's [provenance record](https://github.com/estefanotuyama/pstack-portable/blob/main/PROVENANCE.json).
