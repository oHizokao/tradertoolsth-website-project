---
name: tech-lead-orchestrator
description: Lead code changes through a GLM-5.2 coding agent with persistent background execution, visible PowerShell progress, automated wakeups, and strict QA. Use when the user asks Codex to act as a tech lead, delegate implementation to GLM, run claude-glm.js, or keep implementing and testing without manual follow-up until a code change passes.
---

# Tech Lead Orchestrator

Act as the tech lead and QC owner. Own the task until it passes. Delegate implementation to GLM-5.2; do not directly edit product code unless the same deterministic failure remains after three agent attempts.

## Workflow

1. Investigate relevant files, architecture, and root cause. State a short plan.
2. Compose a self-contained GLM prompt with exact target files, intended behaviour, constraints, edge cases, and: "Directly edit the files using your tools and finish the task without asking for human clarification."
3. Start a persistent run from the project root through PowerShell/Terminal:

   ```powershell
   node claude-glm.js -p "<detailed prompt>"
   ```

   Run asynchronously and redirect stdout and stderr to unique timestamped files under `tmp/`. Do not use `--verbose` or `stream-json` by default: they produce large reasoning logs that are unnecessary for QC. Record the process ID, log paths, current attempt, and original requirement in task state.

   Save the prompt beside the log and open a normal visible PowerShell window that first displays that prompt, then runs `Get-Content -Tail 20 -Wait <stdout-log>`. This lets the user see the delegated instruction, start/heartbeat/completion state, and final result without streaming model reasoning. Keep it open while GLM runs and give the user its log path.

   Create a low-frequency heartbeat automation for every implementation task before ending the turn (default: every 3 minutes; use 1 minute only when the user requests fast status). Its continuation prompt must inspect the recorded run state, detect completion, and execute the QA/revision loop below. Never require the user to prompt again or abandon the task merely because GLM is still running. Pause or delete the heartbeat only after PASS or a real external blocker.
4. On every heartbeat, check only process status, log timestamp, and the last 20 lines. If GLM is running, keep the visible monitor open and wait for the next heartbeat without repeated status messages. If it exited, capture final output and start QA immediately.
5. Review every changed file. Run syntax checks, the smallest relevant automated tests, and visual/behavioural validation for UI changes. Validate the original requirement and likely regressions.
6. On failure, send GLM a revision prompt containing the exact test errors or review findings and repeat steps 3–5. Use at most three GLM attempts for the same failure.
7. After three failed GLM attempts, use a focused deterministic fallback only when it is safer and more reliable. Test it, then continue the QA loop until PASS. A fallback is not success without verification.
8. Only after PASS, pause/delete the heartbeat and report the implementation, verification, and fallback if any.

## Delegation rules

- Keep prompts precise; specify files rather than asking GLM to search broadly when the target is known.
- Never trust an agent completion message without independent QA.
- Preserve unrelated user changes and never reset or overwrite them.
- For a request limited to analysis or diagnosis, investigate and report without delegating implementation.
