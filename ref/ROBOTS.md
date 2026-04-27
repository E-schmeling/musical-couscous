# ROBOTS

Working notes for automated checks, QA passes, and future contributors.

## Purpose

Use this file as a lightweight behavior checklist for the current desktop scheduler.

## Environment Setup Check

Before testing app behavior:

- Create a Python virtual environment with `python -m venv .venv`
- Activate it with `.\.venv\Scripts\Activate.ps1` in PowerShell
- Install backend packages with `python -m pip install -r .\backend\requirements.txt`
- Install frontend packages with `npm install`
- Start the app with `npm start`

## Core Checks

- Confirm Electron opens the dashboard and the Flask backend starts without manual API bootstrapping.
- Confirm availability saved in `Schedule Refiner` is used by both `Task Scheduling` and `Dashboard` updates.
- Confirm saving in `Schedule Refiner` reruns optimization when tasks already exist.
- Confirm `Debug Reset` clears all saved tasks and the saved schedule, including tasks marked `In Progress`.
- Confirm tasks persist across reloads.
- Confirm the last generated schedule persists across reloads.
- Confirm blocked timeslots appear on the dashboard timeline and 2-week view.

## Task Editing Checks

- Confirm the task board shows `New`, `In Progress`, and `Completed` side by side.
- Confirm no task starts expanded on the task board.
- Confirm `Add Task` opens a popup instead of inline editing.
- Confirm clicking an existing task on the task board opens the same popup editor.
- Confirm clicking a task on the dashboard queue opens the popup editor there too.
- Confirm saving a task reruns optimization in the background.
- Confirm deleting a task from the popup reruns optimization in the background.

## Scheduling Checks

- Confirm new scheduling starts from the next half hour onward.
- Confirm past scheduled items remain visible after regenerating the plan.
- Confirm tasks are ordered by due date.
- Confirm due dates are treated as `00:01` on the due date.
- Confirm work is only assigned into future available time.
- Confirm any open window shorter than `60 minutes` is left unused for tasks needing `60+ minutes`.
- Confirm tasks under `60 minutes` can be scheduled into a matching short slot.
- Confirm any task already started before re-optimization remains fixed in the saved schedule.
- Confirm saving availability with no remaining schedulable tasks reports a clean "nothing new to schedule" state instead of an optimizer failure.

## Dashboard Review Checks

- Confirm the review banner appears after `8:00 PM` local time when there is work scheduled today.
- Confirm the `Test Review` header button forces the review banner to appear before `8:00 PM`.
- Confirm tasks scheduled for today can be auto-marked `In Progress` in the review modal.
- Confirm the in-progress default is highlighted and can be manually changed.
- Confirm if today's worked minutes reduce a task to `0 min left`, it defaults to `Completed`.
- Confirm the completed default is highlighted and can still be changed before saving.
- Confirm saving review updates task status, notes, priority, cognitive load, and remaining estimate.

## Edge Cases

- `30-minute slot`: should remain unscheduled for tasks that need at least `60 minutes`.
- `45-minute task + 45-minute slot`: should be schedulable.
- `Now is 3:30 PM`: the next scheduled work should not appear earlier than the next valid future opening, and never in already-passed time.
- `Completed task past due date threshold`: should clear automatically from local task storage.
- `Dashboard edit`: editing a task from the dashboard should update queue and scheduling state without opening the task board page.

## Manual Smoke Test

1. Activate the venv and start the app with `npm start`.
2. Add or edit availability in `Schedule Refiner`.
3. Add tasks from the task board popup and from the dashboard popup.
4. Confirm the schedule updates automatically after each save.
5. Open the dashboard queue and edit an existing task.
6. Force the review banner with `Test Review`.
7. Save a day review and confirm status and remaining time changes persist.
8. Save the schedule in `Schedule Refiner` and confirm queue/timeline data updates without manual plan generation.
