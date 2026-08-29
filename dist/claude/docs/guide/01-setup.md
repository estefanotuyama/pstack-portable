# Set up pstack

In this page you install the plugin, pick which models pstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the plugin

From the portable repository, run:

```text
node scripts/install.mjs --provider claude
```

The installer asks for native scope, registers only Claude Code, and refuses unmanaged collisions.

## Pick your models

Run:

```text
/pstack:setup-pstack
```

[/pstack:setup-pstack](../../skills/setup-pstack/SKILL.md) detects the effective model roster, shows every semantic role and panel slot, and validates the exact model and effort pair behind each native profile. It writes only deviations to `~/.pstack/config/claude.json`, then compiles guarded personal agent profiles. A missing line keeps the shipped default. Resetting a role deletes its override.

Use `{"inheritParent": true}` when a role should inherit the parent model. An unavailable model, unsupported effort, higher-priority collision, or runtime override stops setup. pstack never picks a closest model or silently reduces a panel or swarm.
## Accept the verification offer, or don't

At the end of setup, `/pstack:setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/pstack:create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.claude/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/pstack:create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers when it earns its place.

After setup, start a new session so Claude Code loads the compiled profiles.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/pstack:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. The first item is always "read the Principles section". The rest are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/pstack:poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. `/pstack:poteto-mode` is sticky. It stays on for the conversation until you opt out by saying so.

Next: [Route work through `/pstack:poteto-mode`](./02-poteto-mode.md).
