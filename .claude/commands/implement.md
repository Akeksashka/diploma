---
description: Phase 4 - implement a task from an approved plan
argument-hint: <plan-file> [task-id]
---
First verify the plan file in $ARGUMENTS has `status: approved`; if not, stop and tell me.
Then use the `data-engineer` subagent to implement the specified task (or the next unfinished one). Run tests and lint, report real results, and update task status in the plan.
