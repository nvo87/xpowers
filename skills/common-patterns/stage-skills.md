# Stage Skills Protocol

Projects can pin extra skills to each XPowers stage in `.claude/xpowers-skills.json`, grouped into named profiles so a whole run can be repeated with a different skill set by changing one line. Every stage below follows this protocol. When the config is absent or the stage key is missing, the stage behaves exactly as stock XPowers.

## Tool

All stages use one script. Never parse the config or the transcripts by hand.

```bash
XP_STAGE="$(ls -d ~/.claude/plugins/cache/*/xpowers/*/ 2>/dev/null | tail -1)scripts/stage-skills.js"
node "$XP_STAGE" resolve <stage>                                  # what the stage must load
node "$XP_STAGE" verify --agent-id <id> --require <a,b>           # did a subagent really load it
node "$XP_STAGE" agents                                           # built-in agents allowed as reviewers
```

Run `resolve` from the project directory; it walks up to the nearest `.claude/xpowers-skills.json`.

## Stages

| Stage | Where | Result of `resolve` |
|---|---|---|
| `brainstorm` | brainstorming | `skills` |
| `plan` | writing-plans, sre-task-refinement | `skills` |
| `implement` | implementation subagent (execute-ralph-cc Phase 2) | `skills` |
| `task-review` | execute-ralph-cc Phase 3 quick review | `reviewers` |
| `final-review` | execute-ralph-cc Phase 4 specialized reviews | `reviewers` |
| `final-gate` | execute-ralph-cc Phase 4 final gate | `reviewers` |
| `finish` | finishing-a-development-branch | `mode`: `keep-branch` (default) or `merge-local`; pushing is never allowed |

## Rules

**Main-session stages (`brainstorm`, `plan`):** run `resolve`. If `configured` is true, invoke every listed skill with the Skill tool before starting the stage, announce `Stage skills (<profile>): a, b`, and apply them throughout the stage.

**Subagent stages (`implement`, reviewer stages):** run `resolve`, then add this block to the subagent prompt for every skill list that is configured:

```text
<stage_skills profile="<profile>">
Before any other work, invoke each of these skills with the Skill tool and follow them for the whole task:
- skill-a
- skill-b
End your final summary with the line: Stage skills loaded: skill-a, skill-b
</stage_skills>
```

Reviewers additionally get `<review_focus><focus></review_focus>` when `focus` is not empty.

**Verification (orchestrator, after each subagent returns):** take `agentId` from the Agent tool result and run `verify` with that subagent's skills.

| Exit | Status | Action |
|---|---|---|
| 0 | `OK` | continue |
| 1 | `MISSING` | re-dispatch the same subagent once with "You skipped required stage skills: <missing>"; if still `MISSING`, STOP and alert the user (this overrides autonomous no-stop rules) |
| 2 | `NOT_FOUND` | fall back to the `Stage skills loaded:` line in the summary; if it lacks a required skill, treat as `MISSING` |

**Reviewer stages:** dispatch every reviewer from `reviewers` in parallel, each with its own `agent`, `skills` and `focus`. Verify each one. Combine verdicts with the existing Verdict Normalization Matrix: any non-approval verdict from any reviewer means remediation.

**Traceability:** when `implement` is configured, every commit message ends with `XPowers-Profile: <profile>`, and after a task closes the orchestrator adds a comment to the task: `tm comment <id> "XPowers-Profile: <profile>; verified skills: <loaded>"`.

**Errors:** `resolve` exiting 2 means an invalid config. STOP and show the error to the user; never guess the intended skills.

## Config example

```json
{
  "profile": "django-baseline",
  "profiles": {
    "django-baseline": {
      "brainstorm": ["fans-django-architecture"],
      "plan": ["fans-django-services", "fans-django-models"],
      "implement": ["fans-django-services", "fans-django-tests"],
      "task-review": [
        { "name": "tests", "agent": "autonomous-reviewer", "focus": "test quality and coverage", "skills": ["fans-django-tests"] },
        { "name": "architecture", "agent": "autonomous-reviewer", "focus": "layers, services, models", "skills": ["fans-django-review"] }
      ],
      "final-review": [
        { "name": "quality", "agent": "review-quality", "skills": ["fans-django-review"] },
        { "name": "security", "agent": "security-scanner" },
        { "name": "tests", "agent": "test-effectiveness-analyst", "skills": ["fans-django-tests"] }
      ],
      "final-gate": [
        { "name": "spec", "agent": "review-implementation" },
        { "name": "architecture", "agent": "autonomous-reviewer", "skills": ["fans-django-review"] }
      ],
      "finish": { "mode": "keep-branch" }
    }
  }
}
```
