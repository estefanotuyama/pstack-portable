# Codex delegation contract

This file owns provider-specific delegation for every pstack workflow that names a `pstack-role-*` or `pstack-poteto-agent` profile.

1. Confirm the exact named custom agent is available in the current task. A matching file on disk is diagnostic evidence, not proof that this task loaded it. If it is unavailable, stop, direct the user to $pstack:setup-pstack, and require a new task. Never substitute a generic agent or a different profile.
2. Launch the exact named custom agent with `fork_turns: "none"`. Never accept the full-history default.
3. Give the worker a self-contained brief with its role, goal, scope, constraints, relevant file or record pointers, required fan-out, and output contract. Do not copy the original user request or pstack installation/evaluation discussion unless that content is necessary for the delegated role.
4. If the native delegation surface cannot select the exact named custom agent or preserve the required isolation, report the incompatibility and stop. Do not silently weaken routing or context isolation.
