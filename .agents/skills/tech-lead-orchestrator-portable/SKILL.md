---
name: tech-lead-orchestrator-portable
description: Delegate code changes to a GLM coding agent through Claude Code, keep execution visible or attached, run deterministic QA, and automatically send exact failures back for up to three attempts. Use when Codex, Claude Code, Gemini CLI, or Antigravity should act as a tech lead instead of editing first, especially for long-running implementation, background work, regression repair, or cross-platform agent orchestration.
---

# Portable Tech Lead Orchestrator

Lead the task. Let GLM implement first, then independently inspect and verify the result.

## Workflow

1. Inspect the repository, relevant files, current changes, architecture, and likely root cause. Preserve unrelated work.
2. Define observable acceptance criteria and concrete QA commands. Include syntax checks, targeted tests, and browser/UI automation when behavior is visual or interactive.
3. Create a task file and job configuration outside the skill folder, normally under `<project>/.orchestrator/`. Start from [job.example.json](references/job.example.json).
4. Put the complete implementation brief in the task file. Name exact files or subsystems, required behavior, constraints, edge cases, and tests. End with: `Directly edit the files using your tools and finish the task without asking for human clarification.`
5. Configure credentials through process environment variables or an ignored env file based on [env.example](references/env.example). Never embed or print a token.
6. On Windows, launch `scripts/launch-visible.ps1 -Config <job.json>` to show a separate PowerShell window. To stay attached, run `scripts/orchestrate.ps1 --config <job.json>`. On macOS/Linux, run `scripts/orchestrate.sh --config <job.json>`.
7. Let the runner control the loop. It records prompts, agent logs, QA logs, and `state.json`; retries only with exact failures; and stops after at most three GLM attempts.
8. Inspect `state.json` and the final diff. Re-run risk-relevant checks independently. Never accept the agent's success claim without evidence.
9. If the state is `passed`, report the files changed and checks passed. If the state is `failed`, take a deterministic fallback only after reviewing all three attempts; do not silently start unlimited retries.

## Job requirements

- Set `projectRoot` to the repository the worker may edit.
- Set `taskFile` to a self-contained Markdown brief.
- Supply at least one `checkCommands` entry. Do not rely only on `git diff --check` for behavioral changes.
- Keep `maxAttempts` between 1 and 3.
- Keep logs in a project-local ignored directory such as `.orchestrator/logs`.
- Use `envFile` only for a local ignored file. Prefer existing environment variables when available.

## Platform setup

Read [platforms.md](references/platforms.md) when installing or invoking this skill from another host. The `SKILL.md` workflow is portable; background windows, wakeups, and skill discovery locations are host-specific.

## Safety and integrity

- Do not run against an unclear project root.
- Do not overwrite unrelated dirty-worktree changes.
- Do not put credentials in prompts, job files, logs, or committed files.
- Treat command strings in `checkCommands` as trusted local code.
- Use `--dry-run` before first use on a new machine.
- Do not claim browser validation unless a browser test or direct visual inspection actually ran.
