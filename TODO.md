# TODO

## Scheduler

- Update the backend scheduler to enforce the hard rules in [ref/SCHEDULER_GUIDELINES.md](./ref/SCHEDULER_GUIDELINES.md), including excluding all post-due work from generated schedules.
- Extend the backend test suite with focused scheduler edge-case coverage for due-date cutoffs, anti-fragmentation behavior, cognitive-load caps, and incomplete-task reporting.
- Add explicit schedule output states or reason codes for fully scheduled, partially scheduled, and unscheduled tasks.

## Frontend

- When a task cannot be completed by its due date, consider automatically switching or suggesting switching that task to `high` priority.
- Decide whether the frontend should auto-apply that priority change or prompt the user first.
- Surface incomplete or overdue task warnings clearly in the dashboard and task editor.

## Possible Frontend Ideas

- Add a task details drawer on the dashboard for scheduled blocks and queue items.
- Show clearer incomplete-task reason labels such as `deadline conflict` or `not enough availability`.
- Disable timeline navigation buttons at the start and end of the 2-week window.
- Make schedule warning banners clickable so they jump to affected tasks.
- Add lightweight filtering for tasks by `priority`, `status`, `cognitive load`, or incomplete state.
- Add import support for the debug export bundle to replay specific scheduler cases.
- Increase the visual distinction for incomplete scheduled tasks.
- Show a `last updated` timestamp for background schedule refreshes.
- Add a confirmation step before destructive developer actions like `Debug Reset`.
- Improve first-use empty states when no availability or tasks exist yet.

## Possible Backend Ideas

- Add explicit incomplete reason codes such as `deadline_conflict`, `insufficient_availability`, `blocked_by_constraints`, or `requires_emergency_overload`.
- Add regression tests based on exported real-world scheduler cases from the frontend.
- Stress-test larger task sets with tighter deadlines and messier availability patterns.
- Document the optimization objective more formally for project/report use.
- Add deterministic tie-breaking for equal-scoring schedules.
- Add stronger backend validation for malformed task values and invalid scheduling inputs.
- Add optional debug output describing overload use and constraint conflicts.
- Add dedicated tests for re-optimization and preserved-history behavior.
- Add performance guardrails or reporting if optimization search grows too large.
- Add an optional reproducible optimization trace mode for debugging schedule decisions.

## Later

- Add support for prioritizing `in_progress` tasks and eventually limiting active in-progress projects to `5`.
- Explore low-priority balancing rules for evenly distributed free time and daily cognitive workload.
