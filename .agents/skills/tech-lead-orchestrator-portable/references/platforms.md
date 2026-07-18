# Platform installation

Copy the entire `tech-lead-orchestrator-portable` folder, not only `SKILL.md`.

| Host | Project location | Personal/global location | Invocation |
|---|---|---|---|
| Codex | `.agents/skills/tech-lead-orchestrator-portable/` | `~/.codex/skills/tech-lead-orchestrator-portable/` | Mention `$tech-lead-orchestrator-portable` |
| Antigravity | `.agents/skills/tech-lead-orchestrator-portable/` | `~/.gemini/config/skills/tech-lead-orchestrator-portable/` | Mention the skill name |
| Claude Code | `.claude/skills/tech-lead-orchestrator-portable/` | `~/.claude/skills/tech-lead-orchestrator-portable/` | Run `/tech-lead-orchestrator-portable` |
| Gemini CLI | `.gemini/skills/tech-lead-orchestrator-portable/` | `~/.gemini/skills/tech-lead-orchestrator-portable/` | Mention the skill or activate it from `/skills` |

## Machine requirements

- Node.js 18 or newer.
- Claude Code CLI available as `claude`, or its executable path supplied in `CLAUDE_CLI_COMMAND`.
- An Anthropic-compatible GLM endpoint and a newly issued token.
- A writable project root and trusted QA commands.

## First-run validation

Windows attached dry run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/orchestrate.ps1 --config C:\path\to\job.json --dry-run
```

Windows visible background window:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/launch-visible.ps1 -Config C:\path\to\job.json -DryRun
```

macOS/Linux attached dry run:

```bash
bash scripts/orchestrate.sh --config /path/to/job.json --dry-run
```

The dry run validates paths and configuration without calling GLM or executing QA commands.

## Host behavior

The Node runner owns all GLM attempts and QA retries, so the host does not need to wake between attempts. A host-specific automation is useful only for observing `state.json`, notifying the user, or applying a deterministic fallback after the three-attempt stop-loss.
