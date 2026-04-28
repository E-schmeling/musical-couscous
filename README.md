# Architecture

Reference documentation has been moved into the [`ref/`](./ref) folder.

Docs:

- [Project Overview And Setup](./ref/README.md)
- [Project Structure](./ref/PROJECT_STRUCTURE.md)
- [Scheduler Guidelines](./ref/SCHEDULER_GUIDELINES.md)
- [QA Checklist](./ref/ROBOTS.md)

Developer note:

- Hold `Shift` in the app to reveal the developer tools cluster, including `Debug Reset`, `Random Task`, and `Test Review`.

Build note:

- Windows packaging expects `dist/architecture-backend.exe`, then use `npm run build:win-portable`.
- Linux packaging expects `dist/architecture-backend`, then use `npm run build:linux-portable`.
- Build the Python backend executable on the target OS before running the Electron packaging command.
- These commands are configured to produce single-file outputs in `builds/`:
  - Windows: portable `.exe`
  - Linux: `.AppImage`
