# TODO

## Scheduler

- Update the backend scheduler to enforce the hard rules in [ref/SCHEDULER_GUIDELINES.md](./ref/SCHEDULER_GUIDELINES.md), including excluding all post-due work from generated schedules.
- Extend the backend test suite with focused scheduler edge-case coverage for due-date cutoffs, anti-fragmentation behavior, cognitive-load caps, and incomplete-task reporting.
- Add explicit schedule output states or reason codes for fully scheduled, partially scheduled, and unscheduled tasks.

## Frontend

- When a task cannot be completed by its due date, consider automatically switching or suggesting switching that task to `high` priority.
- Decide whether the frontend should auto-apply that priority change or prompt the user first.
- Surface incomplete or overdue task warnings clearly in the dashboard and task editor.

## Later

- Add support for prioritizing `in_progress` tasks and eventually limiting active in-progress projects to `5`.
- Explore low-priority balancing rules for evenly distributed free time and daily cognitive workload.
