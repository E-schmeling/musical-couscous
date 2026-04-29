# Architecture

Desktop planning app for a rolling 2-week sprint. Electron hosts the UI, a local Flask server handles schedule generation, and the frontend is built with plain HTML, vanilla JavaScript, and Tailwind CSS via CDN.

## Stack

- Electron desktop shell
- Vanilla HTML, CSS, and JavaScript
- Tailwind CSS via CDN
- Python Flask backend
- Local storage for tasks, availability, and the latest generated schedule

## Current App Flow

The app is split into three pages:

- `Dashboard`: shows today's timeline, the queue, blocked time, the 2-week calendar, task editing, and the day review flow
- `Schedule Refiner`: captures blocked and available time across the next 2 weeks
- `Task Scheduling`: provides the full task board and auto-runs optimization in the background

## Project Structure

See [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) for file-by-file documentation.

## Requirements

Install these first:

- `pyenv` or `pyenv-win`
- Python `3.11`
- `Node.js 18+` recommended
- `npm`

## Full Setup

### 1. Install Python 3.11 with pyenv

This project does not require a global Python install. Use `pyenv` to install and select a local `3.11` runtime instead.

On Windows with `pyenv-win`:

```powershell
pyenv install 3.11.9
pyenv local 3.11.9
python --version
```

On macOS or Linux with `pyenv`:

```bash
pyenv install 3.11.9
pyenv local 3.11.9
python --version
```

You should see `Python 3.11.x` before continuing.

### 2. Create and activate a Python virtual environment

From the project root:

```powershell
python -m venv .venv
```

Activate it in shell:

```powershell
.\.venv\Scripts\activate
```

If you are using Command Prompt instead:

```bat
.venv\Scripts\activate.bat
```

If you are using Git Bash instead:

```bash
source .venv/Scripts/activate
```

### 3. Install backend dependencies

```powershell
python -m pip install --upgrade pip
python -m pip install -r .\backend\requirements.txt
```

### 4. Install Electron dependencies

```powershell
npm install
```

## Running The App

### Recommended: run the desktop app

With `.venv` created in the project root, Electron will automatically use `.venv\Scripts\python.exe` for the backend in development.

Keep the virtual environment active, then run:

```powershell
npm start
```

Electron will launch and automatically start the Flask server on `http://127.0.0.1:5050`.

### Optional: run the backend by itself for testing

With the virtual environment active:

```powershell
python .\backend\server.py
```

Then open the Electron app in a separate terminal with:

```powershell
npm start
```

## Running Tests

### Run the backend test suite

With the virtual environment active:

```powershell
python .\backend\run_tests.py
```

This discovers and runs all `test_*.py` files under `backend/`.

### Run a single backend test file

```powershell
python .\backend\test_server.py
```

### Optional smoke benchmark

```powershell
python .\backend\smoke_benchmark.py
```

## Development Notes

- The backend is started by Electron from `backend/server.py`
- In development, `npm start` will use `.venv\Scripts\python.exe` if that local virtual environment exists
- Tasks, availability, and the latest merged schedule are stored in browser local storage
- The task board and dashboard can both edit tasks
- The task board automatically re-optimizes in the background after task changes
- The dashboard can also update tasks and rerun scheduling after modal edits
- Saving the schedule refiner also reruns optimization in the background when tasks already exist
- The task board includes a `Debug Reset` button that clears all saved tasks and the saved schedule state

## Data Model

Tasks are stored locally and currently support:

- `title`
- `estimateMinutes`
- `dueDate`
- `status`: `new`, `in_progress`, `completed`
- `priority`: `high`, `medium`, `low`
- `cognitiveLoad`: `high`, `medium`, `low`
- `notes`

Availability is stored as a 14-day schedule plus weekly routine overrides. The last generated schedule is also stored locally so past scheduled items can remain visible while future time is re-optimized.

## Scheduler Behavior

The scheduler currently:

- sorts tasks by earliest due date first
- treats due dates as `00:01` on the due date
- only schedules into future availability starting from the next half hour
- preserves already-past scheduled segments when a new plan is generated
- keeps the 60-minute minimum segment rule for tasks that need 60 minutes or more
- allows tasks under 60 minutes to use a shorter slot if the whole task itself is under 60 minutes
- leaves leftover time unscheduled if there is not enough time for the task's minimum valid segment
- exits cleanly when there are no remaining schedulable tasks instead of treating that state as an optimizer failure

## Python Optimizer Contract

The Flask backend accepts a `POST` request at `/api/schedule`.

### Input

```json
{
  "timeBlocks": [
    {
      "start": "2026-04-14T16:00:00.000Z",
      "end": "2026-04-14T18:00:00.000Z"
    },
    {
      "start": "2026-04-15T09:00:00.000Z",
      "end": "2026-04-15T12:00:00.000Z"
    },
    {
      "start": "2026-04-15T14:00:00.000Z",
      "end": "2026-04-15T16:00:00.000Z"
    }
  ],
  "tasks": [
    {
      "id": "task-1",
      "title": "Facade precedent sketches",
      "estimateMinutes": 180,
      "dueDate": "2026-04-16",
      "priority": "high",
      "cognitiveLoad": "high"
    },
    {
      "id": "task-2",
      "title": "Section redraw set",
      "estimateMinutes": 120,
      "dueDate": "2026-04-17",
      "priority": "medium",
      "cognitiveLoad": "medium"
    },
    {
      "id": "task-3",
      "title": "Material board captions",
      "estimateMinutes": 45,
      "dueDate": "2026-04-18",
      "priority": "low",
      "cognitiveLoad": "low"
    }
  ]
}
```

### Input Fields

- `timeBlocks`: future availability windows passed from the frontend
- `timeBlocks[].start`: ISO datetime
- `timeBlocks[].end`: ISO datetime
- `tasks`: active tasks to schedule
- `tasks[].id`: unique task id
- `tasks[].title`: task name
- `tasks[].estimateMinutes`: total estimated time remaining
- `tasks[].dueDate`: ISO date in `YYYY-MM-DD`
- `tasks[].priority`: `high`, `medium`, or `low`
- `tasks[].cognitiveLoad`: `high`, `medium`, or `low`

### Output

```json
{
  "summary": {
    "timeBlockCount": 3,
    "taskCount": 3,
    "scheduledCount": 3,
    "unscheduledCount": 0,
    "totalAvailableMinutes": 420,
    "totalPlannedMinutes": 345
  },
  "schedule": [
    {
      "id": "task-1",
      "title": "Facade precedent sketches",
      "estimateMinutes": 180,
      "dueDate": "2026-04-16",
      "priority": "high",
      "cognitiveLoad": "high",
      "segments": [
        {
          "blockStart": "2026-04-14T16:00:00",
          "blockEnd": "2026-04-14T18:00:00",
          "start": "2026-04-14T16:00:00",
          "end": "2026-04-14T18:00:00",
          "allocatedMinutes": 120
        },
        {
          "blockStart": "2026-04-15T09:00:00",
          "blockEnd": "2026-04-15T12:00:00",
          "start": "2026-04-15T09:00:00",
          "end": "2026-04-15T10:00:00",
          "allocatedMinutes": 60
        }
      ]
    },
    {
      "id": "task-2",
      "title": "Section redraw set",
      "estimateMinutes": 120,
      "dueDate": "2026-04-17",
      "priority": "medium",
      "cognitiveLoad": "medium",
      "segments": [
        {
          "blockStart": "2026-04-15T09:00:00",
          "blockEnd": "2026-04-15T12:00:00",
          "start": "2026-04-15T10:00:00",
          "end": "2026-04-15T12:00:00",
          "allocatedMinutes": 120
        }
      ]
    },
    {
      "id": "task-3",
      "title": "Material board captions",
      "estimateMinutes": 45,
      "dueDate": "2026-04-18",
      "priority": "low",
      "cognitiveLoad": "low",
      "segments": [
        {
          "blockStart": "2026-04-15T14:00:00",
          "blockEnd": "2026-04-15T16:00:00",
          "start": "2026-04-15T14:00:00",
          "end": "2026-04-15T14:45:00",
          "allocatedMinutes": 45
        }
      ]
    }
  ],
  "unscheduled": []
}
```

### Segment Field Meaning

- `blockStart` and `blockEnd`: the full availability window the frontend sent to the optimizer
- `start` and `end`: the portion of that availability window actually assigned to the task

### Output Fields

- `summary`: scheduling totals for the current run
- `schedule`: tasks that were fully placed
- `schedule[].segments`: one or more assigned working windows
- `segments[].allocatedMinutes`: minutes assigned in that segment
- `unscheduled`: tasks that could not be fully placed
- `unscheduled[].missingMinutes`: time still needing a valid slot

## Dashboard Review Flow

- after `8:00 PM` local time, a review banner can appear for today's scheduled tasks
- the header also includes a `Test Review` button so the banner can be forced open during testing
- tasks worked on today can be auto-marked `In Progress` in review
- if today's worked time reduces a task to `0 min left`, review can auto-mark it `Completed`
- those auto-defaults are highlighted so the user can still change them before saving

## Troubleshooting

- If `npm start` fails because Electron dependencies are missing, run `npm install` again from the project root.
- If Python packages are missing, reactivate the virtual environment and run `python -m pip install -r .\backend\requirements.txt` again.
- If `python --version` is not `3.11.x`, run `pyenv local 3.11.9` again in the project root and recreate `.venv`.
- If `Schedule Refiner` says optimization failed, check the inline message under `Save Schedule` and the Electron terminal output. The Flask backend now logs the count of blocks/tasks received for each scheduling request.
- If PowerShell blocks venv activation, run PowerShell as your user and use:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## GitHub Publishing Notes

The repository is set up to ignore local-only files such as:

- `node_modules/`
- `.venv/`
- Python cache files
- build output and log files

## Known Edge Cases To Test

- a free `30-minute` slot should not receive a scheduled task segment for a `60+ minute` task
- a task that is itself under `60 minutes` can use a matching short slot
- if the current time is mid-day, earlier parts of the day should not be newly scheduled
- blocked time from the refiner should appear on the dashboard
- completed tasks should clear automatically once their due date time threshold passes
