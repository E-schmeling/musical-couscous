# Project Structure

This document explains the role of the major files and folders in the project so reviewers can understand the codebase without only relying on run instructions.

## Top Level

- `main.js`
  Starts Electron, opens the desktop window, and launches the backend process.
- `package.json`
  Defines Electron scripts, package metadata, and build configuration.
- `package-lock.json`
  Locks frontend dependency versions for reproducible installs.
- `architecture-backend.spec`
  PyInstaller configuration for bundling the Python backend into a Windows executable.
- `.gitignore`
  Excludes generated files, local environments, and build output from version control.
- `builds/`
  Contains packaged or compiled outputs such as the desktop `.exe` and backend executable.
- `ref/`
  Contains project reference documents, setup notes, QA checklists, and architecture documentation.

## Backend

- `backend/server.py`
  The active Flask backend. It exposes `/health` and `/api/schedule`, validates scheduler input, and returns scheduled plus unscheduled work.
- `backend/requirements.txt`
  Python dependency list for the backend runtime.

## Frontend

The frontend is split into three HTML entry pages and a set of matching scripts.

- `src/Dashboard.html`
  Main landing page for the desktop app. Shows current pulse, queue, timeline, calendar, and day review UI.
- `src/dashboard.js`
  Dashboard behavior: reads saved schedule/task data, renders today's view, opens task editing, and runs day review actions.
- `src/refine-schedule.html`
  Availability editor page for marking blocked time across the rolling 2-week window.
- `src/refine-schedule.js`
  Handles the refiner grid interactions, persistence of availability, and background schedule refresh after save.
- `src/tasks.html`
  Full task management page where users create, edit, clear, and organize tasks.
- `src/app.js`
  Task page behavior: task modal handling, task persistence, background optimization, and schedule summary updates.
- `src/planner-shared.js`
  Shared frontend planner utilities used by the dashboard, task page, and schedule refiner. This reduces duplicated scheduling logic across entry points.
- `src/styles.css`
  Shared CSS for the app's visual system and reusable component styling.
- `src/index.html`
  Legacy file from earlier iterations. The app currently loads `Dashboard.html` directly.
- `src/renderer.js`
  Legacy renderer script from earlier iterations. It is not the main driver for the current three-page flow.

## Data Flow

The app currently uses local storage plus a local Flask API.

- Availability is saved under the frontend availability storage key.
- Tasks are saved locally and reused across pages.
- The last generated schedule is stored locally so current and past work can remain visible while future time is re-optimized.
- When optimization runs, frontend pages assemble `timeBlocks` and `tasks`, call the Flask backend, and then merge the returned schedule with preserved fixed segments.

## Recommended Reading Order

If someone is new to the repo, this order is the easiest:

1. `main.js`
2. `src/Dashboard.html`
3. `src/dashboard.js`
4. `src/planner-shared.js`
5. `src/tasks.html` and `src/app.js`
6. `src/refine-schedule.html` and `src/refine-schedule.js`
7. `backend/server.py`

## Notes For Reviewers

- `server.py` is the active backend entry point.
- `planner-shared.js` contains the shared frontend scheduling helpers and is a good place to check first when scheduler-related frontend behavior changes.
- The app is designed around a rolling 2-week planning window, not a permanent calendar history.
