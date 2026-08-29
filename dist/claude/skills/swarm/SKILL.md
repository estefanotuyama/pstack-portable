---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /pstack:swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

Fan out N parallel isolated local workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is the exact total requested; a provider runtime limit is surfaced as an error, never a reason to shrink N silently.
4. Invoke `pstack-role-swarm-worker` for every ordinary worker. For an explicit model race, name each ad hoc arm's model and effort up front.
5. Give each worker its own writable output when it writes. Use a worktree, branch, or `/tmp/swarm-<slug>/worker-<n>/`.

## Phase B: Fan out

Spawn all N `pstack-role-swarm-worker` profiles concurrently in one message. Mutating workers each use a local isolated worktree at the intended base SHA. A worker that needs machine-local state stays in the current checkout and must remain read-only unless it is the sole writer.

When a worker must start from a non-default pushed branch, pass `starting branch`.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence.

If a worker drops out, respawn that position with the same semantic profile and brief. Continue only after exactly N results exist; if the provider cannot produce N, fail closed instead of shrinking the swarm.

## Phase C: Aggregate

Read the terminal results. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or failed-attempt records.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or failed-attempt records, and the race rule when used.
