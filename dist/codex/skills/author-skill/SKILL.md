---
name: author-skill
description: Author or update a standalone provider-native skill through the provider's official skill creator. Asks for project or personal scope and never writes under .pstack/skills or another provider.
---

# Author a skill

1. Determine whether this is a new skill or an update. Preserve the existing scope when updating unless the user explicitly changes it.
2. Ask whether a new general skill belongs in project or personal scope. Verification skills are always project-scoped.
3. Delegate the complete authoring job to $skill-creator. Do not copy or reinterpret its authoring contract.
4. Install only in the active provider: `.agents/skills/<name>/` for project scope or `~/.agents/skills/<name>/` for personal scope.
5. Keep the skill standalone. It may tell delegated agents to load it when composition matters, but pstack does not register it in a private skill tree or fan it out to other providers.
6. If $skill-creator is unavailable, stop with the exact missing capability. Do not hand-roll a replacement.
