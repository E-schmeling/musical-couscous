# Scheduler Guidelines

This document defines how the scheduler should interpret task data and make scheduling decisions. It starts with the task fields because every scheduling rule depends on those inputs being clearly defined.

## Task Parameters

Each task is treated as a schedulable unit of work. The current task model includes the following parameters.

### `id`

- Purpose: uniquely identifies a task across the app.
- Type: string.
- Source: generated on the frontend when a task is created.
- Scheduler use: used to match task records with previously scheduled segments and preserve schedule history across re-optimization.
- Rule: must stay stable for the life of the task.

### `title`

- Purpose: human-readable name of the task.
- Type: string.
- Source: entered by the user.
- Scheduler use: does not change scheduling priority directly, but is returned in schedule results and used as a final tie-breaker when tasks otherwise sort the same.
- Rule: should be non-empty after trimming whitespace.

### `estimateMinutes`

- Purpose: the total amount of work time still required for the task.
- Type: integer number of minutes.
- Source: entered by the user and later reduced as scheduled work is treated as already allocated.
- Scheduler use: determines how much time must be placed into available blocks.
- Rules:
- must be greater than `0` to be schedulable.
- values under `60` mean the whole task may fit in a shorter block.
- values of `60` or more are subject to the minimum `60-minute` work block rule.
- when re-optimizing, the frontend subtracts already-fixed past segments before sending the remaining estimate to the backend.

### `dueDate`

- Purpose: the date by which the task should be completed.
- Type: ISO date string in `YYYY-MM-DD` format.
- Source: entered by the user.
- Scheduler use: primary ordering signal for task selection. Earlier due dates are scheduled first.
- Rules:
- interpreted as starting at `00:01` on that date in the frontend logic.
- used for sorting and for dashboard/task display.
- should always be a valid calendar date.

### `status`

- Purpose: tracks the workflow state of the task.
- Type: enum string.
- Allowed values:
- `new`
- `in_progress`
- `completed`
- Source: entered or updated by the user, and sometimes adjusted by the dashboard review flow.
- Scheduler use: determines whether the task is eligible to be scheduled.
- Rules:
- tasks marked `completed` are excluded from future scheduling.
- `new` and `in_progress` tasks are eligible for scheduling.
- completed tasks may later be pruned from storage once their due date threshold has passed.

### `priority`

- Purpose: describes the user-assigned urgency level of the task.
- Type: enum string.
- Allowed values:
- `high`
- `medium`
- `low`
- Source: entered by the user.
- Scheduler use: currently stored and returned with schedule data, but not yet used as an active sort factor in the backend algorithm.
- Rule: should still be preserved in the task model because it is part of the intended planner behavior and UI.

### `cognitiveLoad`

- Purpose: describes how mentally demanding the task is expected to be.
- Type: enum string.
- Allowed values:
- `high`
- `medium`
- `low`
- Source: entered by the user.
- Scheduler use: currently stored and returned with schedule data, but not yet used as an active placement rule in the backend algorithm.
- Rule: should be preserved for future scheduling heuristics, reporting, and UI decisions.

### `notes`

- Purpose: free-form supporting context for the task.
- Type: string.
- Source: entered by the user.
- Scheduler use: not currently used by the backend scheduler.
- Rule: kept in local task storage and review flows, but not sent as part of the optimizer request payload.

## Which Task Parameters Affect Scheduling Today

The current backend scheduler directly depends on these task parameters:

- `id`
- `title`
- `estimateMinutes`
- `dueDate`
- `priority`
- `cognitiveLoad`

The current frontend scheduling pipeline also depends on:

- `status`, to exclude completed tasks before they are sent to the backend

The current system stores but does not directly schedule against:

- `notes`

## Current Interpretation Summary

- A task must have a stable `id`, a non-empty `title`, a positive `estimateMinutes`, and a valid `dueDate`.
- A task with `status = completed` is not sent for future scheduling.
- The scheduler currently orders tasks mainly by earliest `dueDate`, then by smaller `estimateMinutes`, then alphabetically by `title`.
- `priority` and `cognitiveLoad` are part of the task contract now, even though the backend does not yet use them to change order or placement.

## Hard Rules

These rules are mandatory. A schedule that breaks any of them should be treated as invalid.

### Scheduling Resolution

- The scheduling resolution is `15 minutes`.
- All internal scheduling calculations should align to `15-minute` windows.

### Valid Time Placement

- Work must be placed only inside valid available time blocks.
- No task segment may overlap blocked time or lie outside the saved availability window.

### Minimum Segment Length

- No scheduled segment may be shorter than `60 minutes`.
- This minimum reflects setup and wrap-up overhead that makes shorter sessions unproductive.

### Cognitive Load Maximum Continuous Time

- `high` cognitive load: maximum continuous segment length is `90 minutes`.
- `medium` cognitive load: maximum continuous segment length is `120 minutes`.
- `low` cognitive load: maximum continuous segment length is `180 minutes`.
- No task segment may exceed the cap defined by that task's `cognitiveLoad`.
- Emergency overload exception:
- if a task is due within the next `2 days`, the scheduler may temporarily override the normal cognitive-load maximum continuous time
- this near-deadline overload rule is intended to protect urgent work from being blocked by otherwise-valid cap limits
- the `60-minute` minimum segment length and `15-minute` alignment rules still apply during overload scheduling

### Cognitive Load Recovery Gaps

- `high` cognitive load tasks require recovery spacing between segments.
- There must be at least `3 hours` between two segments of the same `high` cognitive load task.
- There must be at least `2 hours` between segments of different `high` cognitive load tasks.
- `medium` cognitive load tasks also require recovery spacing between segments of the same task.
- There must be at least `1.5 hours` between two segments of the same `medium` cognitive load task.
- There is no required gap between different `medium` cognitive load tasks.
- `low` cognitive load tasks currently have no required recovery-gap rule.
- These recovery-gap rules apply continuously across time, including across midnight and across different calendar days.

### Due Date Completion Rule

- Work must be completed before the task's due date to count as complete.
- A task scheduled partly before and partly after its due date does not count as fully completed on time.
- The scheduler should not rely on post-deadline time to claim a task is complete.
- Post-due work should be completely excluded from the schedule and reported only as missing work.
- If the user changes the due date, that should be treated as a normal new scheduling case using the updated deadline.

### Explicit Incomplete Reporting

- If full completion is impossible, the scheduler must report that explicitly.
- The scheduler output should distinguish between:
- tasks fully completed before their due date
- tasks only partially completed before their due date
- tasks that could not be scheduled at all
- Any incomplete task should include the remaining unscheduled time, such as `missingMinutes`.

### Valid Segment Construction

- Every scheduled segment must be both:
- at least `60 minutes`
- at most the task's cognitive-load cap
- A task should only be split in ways that keep all resulting segments valid.
- The scheduler should not create an early segment that forces an invalid leftover fragment later.

## Soft Optimization Rules

These rules should influence optimization and ranking, but can be relaxed if required to satisfy the hard rules.

### Primary Scheduling Objective

- The main objective is to complete all tasks before their due dates.
- Due date and priority should be balanced, rather than using either one alone.

### Priority Handling

- Higher-priority tasks should generally be completed before lower-priority tasks.
- Priority should be balanced against due date urgency rather than replacing it.
- A lower-priority task with a much earlier due date may still need to be scheduled first.

### Exact Priority Versus Due-Date Ranking Logic

- If a task is due in less than `4` days, due date urgency should rank ahead of priority.
- If a task is due in `4` days or more, priority should rank ahead of due date.
- Within whichever factor is currently dominant, the other factor should still be used as a secondary ordering signal.
- This rule is meant to shift the scheduler from long-range importance planning toward short-range deadline protection as the due date approaches.

### Exact Priority Versus Due-Date Ranking Logic

- If a task is due in less than `4` days, due date urgency should rank ahead of priority.
- If a task is due in `4` days or more, priority should rank ahead of due date.
- Within whichever factor is currently dominant, the other factor should still be used as a secondary ordering signal.
- This rule is meant to shift the scheduler from long-range importance planning toward short-range deadline protection as the due date approaches.

### In-Progress Preference

- Tasks with `status = in_progress` should be preferred over equally comparable `new` tasks.
- This reduces context switching and encourages finishing already-started work.

### Anti-Fragmentation Rule

- Prefer schedules that use the fewest segments possible.
- Prefer larger segments, up to the task's cognitive-load cap.
- Prefer segment splits that are as even as possible.
- Avoid leaving a final fragment under `60 minutes`.
- If a naive split would leave an invalid leftover segment, redistribute time across earlier segments when possible.

### Failure Preference

- If not all tasks can be completed, prefer not to finish the longest low-priority item first.
- More generally, lower-priority and longer tasks should be the first candidates to remain incomplete when a full solution is impossible.

### Urgent High-Priority Completion Preference

- If an urgent `high` priority task can still be completed before its deadline, the scheduler should strongly prefer completing it over finishing multiple lower-priority tasks.
- This is especially important when a `high` priority task is near its deadline and medium-priority tasks would otherwise consume the remaining valid time.
- The optimizer should treat successful completion of urgent `high` priority work as more valuable than completing a larger number of less important tasks.
- Emergency overload may be used for this case if that is the only way to complete the urgent `high` priority task on time.

### Stable Re-Optimization

- When rescheduling, avoid unnecessary movement of already-planned future work unless there is a meaningful benefit.
- Re-optimization should improve the schedule, not constantly reshuffle it.

## Re-Optimization And History Preservation Rules

- Any scheduled time in the past is fixed and cannot be changed.
- The current active `15-minute` window is also fixed and cannot be changed.
- Re-optimization may only affect time after the current `15-minute` window.
- When a new task is added, the scheduler should update all eligible future periods across the planning horizon, such as the next `2` weeks.
- Previously scheduled future work may be moved during re-optimization if needed, as long as fixed past time and the current `15-minute` window remain unchanged.
- The scheduler should preserve history for reporting purposes even when future time is re-optimized.

## Formal Incomplete-Task Status Definitions

- A task is `complete` only if all of its required time is scheduled before its due date.
- A task is `incomplete` if all of its total required time is not scheduled before its due date.
- A task should not be considered complete simply because some portion of its work was scheduled.
- If the schedule output needs more detail, incomplete tasks may still include additional metadata such as `missingMinutes`, but the main completion distinction is binary: complete or incomplete.

## Optimization Formulation

The scheduler is implemented as a discrete optimization problem over time rather than a simple first-fit planner.

### Model Structure

- Time is modeled in discrete `15-minute` units.
- Availability blocks define the only valid windows where work may be placed.
- Each task is assigned zero or more work segments.
- Each segment must satisfy the hard scheduling rules, including:
- minimum `60-minute` length
- maximum continuous length based on `cognitiveLoad`
- recovery-gap requirements
- no placement after the task due-date cutoff

### Hard Constraints

- Segments must lie fully inside valid available time.
- Segments for different tasks may not overlap.
- A task may only be split into valid segment lengths.
- Post-due work is not allowed.
- If a task cannot be fully placed while respecting these constraints, it is reported as incomplete.

### Optimization Objective

The backend evaluates alternative valid task plans and chooses the best one using an explicit objective function.

The objective currently favors:

- completing more tasks before their due dates
- respecting the due-date versus priority ranking rules
- preferring `in_progress` work over equivalent `new` work
- reducing fragmentation by preferring fewer segments
- preferring more even segment splits when a task must be split
- avoiding weaker solutions where lower-value tasks displace higher-value tasks

### Search Method

- The backend uses a branch-and-bound search over valid task plans.
- Candidate plans are generated per task from valid segment combinations.
- Partial solutions are pruned when they cannot outperform the current best solution under the objective.
- This makes the scheduler an explicit constrained optimization process, even though it does not currently rely on an external solver library.

## Re-Optimization And History Preservation Rules

- Any scheduled time in the past is fixed and cannot be changed.
- The current active `15-minute` window is also fixed and cannot be changed.
- Re-optimization may only affect time after the current `15-minute` window.
- When a new task is added, the scheduler should update all eligible future periods across the planning horizon, such as the next `2` weeks.
- Previously scheduled future work may be moved during re-optimization if needed, as long as fixed past time and the current `15-minute` window remain unchanged.
- The scheduler should preserve history for reporting purposes even when future time is re-optimized.

## Formal Incomplete-Task Status Definitions

- A task is `complete` only if all of its required time is scheduled before its due date.
- A task is `incomplete` if all of its total required time is not scheduled before its due date.
- A task should not be considered complete simply because some portion of its work was scheduled.
- If the schedule output needs more detail, incomplete tasks may still include additional metadata such as `missingMinutes`, but the main completion distinction is binary: complete or incomplete.

## Later Rules

These are reasonable future additions, but are lower priority than the rules above.

### In-Progress Project Limit

- Prefer to keep at most `5` projects in progress at one time.
- This should be treated as a lower-priority future rule rather than a first implementation requirement.

### Evenly Distributed Free Time

- Try to spread non-working scheduled time more evenly across each week.
- Example: if there are `14` hours of schedulable work across `7` days with `3` free hours available per day, the system should prefer leaving around `1` hour open each day rather than overloading a few days and leaving others empty.

### Daily Workload Balancing

- Try to average total daily workload as evenly as possible across days.
- Workload should be measured in `15-minute` units.
- Proposed workload values:
- `high` cognitive load = `3` workload units per `15-minute` block
- `medium` cognitive load = `2` workload units per `15-minute` block
- `low` cognitive load = `1` workload unit per `15-minute` block
- Example:
- `1 hour` of high-load work = `4 x 3 = 12` units
- `2 hours` of low-load work = `8 x 1 = 8` units
- total daily workload = `20` units
- This is a lower-priority optimization goal and should only be applied when it does not interfere with more important scheduling rules.

## Next Sections To Expand

This file can still be extended further with:

- availability parameter definitions
- edge cases and validation rules
