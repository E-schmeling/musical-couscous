const API_BASE_URL = 'http://127.0.0.1:5050';
const API_TIMEOUT_MS = 15000;
const STORAGE_KEYS = {
  availability: 'architectureAvailability',
  tasks: 'architectureTasks',
  lastSchedule: 'architectureLastSchedule'
};
const Planner = window.ArchitecturePlanner;

const taskListRoot = document.getElementById('task-list');
const feedbackEl = document.getElementById('feedback');
const healthIndicator = document.getElementById('health-indicator');
const planMeta = document.getElementById('plan-meta');
const planRuntime = document.getElementById('plan-runtime');
const availabilityNote = document.getElementById('availability-note');
const debugResetBtn = document.getElementById('debug-reset');
const debugForceReoptimizeBtn = document.getElementById('debug-force-reoptimize');
const debugRandomTaskBtn = document.getElementById('debug-random-task');
const debugExportBundleBtn = document.getElementById('debug-export-bundle');
const developerToolsEl = document.getElementById('developer-tools');
const availableHoursEl = document.getElementById('summary-available-hours');
const taskCountEl = document.getElementById('summary-task-count');
const scheduledCountEl = document.getElementById('summary-scheduled-count');
const completedCountEl = document.getElementById('summary-completed-count');
const scheduleHealthEl = document.getElementById('summary-schedule-health');
const taskModal = document.getElementById('task-modal');
const taskModalTitle = document.getElementById('task-modal-title');
const closeTaskModalBtn = document.getElementById('close-task-modal');
const deleteTaskBtn = document.getElementById('delete-task');
const saveTaskBtn = document.getElementById('save-task');
const taskModalFeedback = document.getElementById('task-modal-feedback');
const modalTaskTitle = document.getElementById('modal-task-title');
const modalTaskEstimate = document.getElementById('modal-task-estimate');
const modalTaskDue = document.getElementById('modal-task-due');
const modalTaskPriority = document.getElementById('modal-task-priority');
const modalTaskCognitive = document.getElementById('modal-task-cognitive');
const modalTaskStatus = document.getElementById('modal-task-status');
const modalTaskNotes = document.getElementById('modal-task-notes');

const START_HOUR = 6;
const END_HOUR = 23;
const STATUS_ORDER = ['new', 'in_progress', 'completed'];
const STATUS_META = {
  new: {
    label: 'New',
    tone: 'border-terracotta/15 bg-terracotta/8 text-[#8f3f29]'
  },
  in_progress: {
    label: 'In Progress',
    tone: 'border-olive/15 bg-olive/10 text-[#4d5a3e]'
  },
  completed: {
    label: 'Completed',
    tone: 'border-graphite/10 bg-graphite/5 text-graphite/65'
  }
};
let tasks = pruneCompletedTasks(loadTasks());
let autoGenerateTimer = null;
let isGenerating = false;
let activeTaskId = null;

const BASE_RANDOM_TASK_TEMPLATES = [
  { title: 'Facade precedent matrix', estimateMinutes: 180 },
  { title: 'Stair core compliance review', estimateMinutes: 120 },
  { title: 'Lighting study revision', estimateMinutes: 135 },
  { title: 'Model export cleanup', estimateMinutes: 90 },
  { title: 'Material palette captions', estimateMinutes: 75 },
  { title: 'Envelope section redraw', estimateMinutes: 150 },
  { title: 'Accessibility markup pass', estimateMinutes: 105 },
  { title: 'Render board sequencing', estimateMinutes: 165 }
];

/**
 * Returns an ISO 8601 date string (YYYY-MM-DD) for a date offset from today.
 *
 * @param {number} daysFromToday - Number of days to offset from today. Use 0 for today,
 *   positive values for future dates, and negative values for past dates.
 * @returns {string} ISO date string in YYYY-MM-DD format.
 */
function formatLocalDateOffset(daysFromToday) {
  const nextDate = new Date();
  nextDate.setHours(0, 0, 0, 0);
  nextDate.setDate(nextDate.getDate() + daysFromToday);
  return nextDate.toISOString().slice(0, 10);
}

/**
 * Creates and returns a default set of three starter tasks for first-time users.
 *
 * Each task is assigned a unique ID, a due date offset from today, and
 * sensible default values for priority, cognitive load, and status.
 *
 * @returns {Array<Object>} An array of three default task objects.
 */
function createDefaultTasks() {
  return [
    {
      id: crypto.randomUUID(),
      title: 'Site analysis package',
      estimateMinutes: 180,
      dueDate: formatLocalDateOffset(2),
      status: 'new',
      priority: 'high',
      cognitiveLoad: 'high',
      notes: ''
    },
    {
      id: crypto.randomUUID(),
      title: 'Zoning research summary',
      estimateMinutes: 120,
      dueDate: formatLocalDateOffset(4),
      status: 'in_progress',
      priority: 'medium',
      cognitiveLoad: 'medium',
      notes: ''
    },
    {
      id: crypto.randomUUID(),
      title: 'Concept sketch revisions',
      estimateMinutes: 90,
      dueDate: formatLocalDateOffset(6),
      status: 'new',
      priority: 'high',
      cognitiveLoad: 'low',
      notes: ''
    }
  ];
}

/**
 * Builds a randomized developer task for schedule stress testing.
 *
 * Selects a random template from BASE_RANDOM_TASK_TEMPLATES, applies a small
 * time variation, and randomizes priority, cognitive load, status, and due date.
 * Ensures the resulting estimate can be validly partitioned before returning.
 *
 * @returns {Object} A task object with a unique ID and randomized fields.
 */
function buildRandomDeveloperTask() {
  const template = BASE_RANDOM_TASK_TEMPLATES[Math.floor(Math.random() * BASE_RANDOM_TASK_TEMPLATES.length)];
  const variationSteps = [-30, -15, 0, 15, 30, 45];
  const dueOffsetDays = [1, 2, 3, 4, 5, 6, 7, 9][Math.floor(Math.random() * 8)];
  const priority = ['high', 'medium', 'low'][Math.floor(Math.random() * 3)];
  const cognitiveLoad = ['high', 'medium', 'low'][Math.floor(Math.random() * 3)];
  const status = Math.random() < 0.35 ? 'in_progress' : 'new';
  let estimateMinutes = Math.max(60, template.estimateMinutes + variationSteps[Math.floor(Math.random() * variationSteps.length)]);

  while (!Planner.canPartitionTaskEstimate(estimateMinutes, cognitiveLoad, formatLocalDateOffset(dueOffsetDays)) && estimateMinutes < 20160) {
    estimateMinutes += 15;
  }

  return {
    id: crypto.randomUUID(),
    title: `${template.title} ${Math.floor(Math.random() * 90 + 10)}`,
    estimateMinutes,
    dueDate: formatLocalDateOffset(dueOffsetDays),
    status,
    priority,
    cognitiveLoad,
    notes: 'Developer seeded task for complex schedule testing.'
  };
}

/**
 * Loads the task list from localStorage, returning default tasks if none are saved.
 *
 * Applies default values for optional fields (priority, cognitiveLoad, status, notes)
 * to handle tasks saved before those fields were introduced. Falls back to default
 * tasks if the stored value is missing, empty, or unparseable.
 *
 * @returns {Array<Object>} The loaded (or default) array of task objects.
 */
function loadTasks() {
  const raw = window.localStorage.getItem(STORAGE_KEYS.tasks);
  if (!raw) {
    return createDefaultTasks();
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length
      ? parsed.map((task) => ({
          priority: 'medium',
          cognitiveLoad: 'medium',
          status: 'new',
          notes: '',
          ...task
        }))
      : createDefaultTasks();
  } catch (error) {
    return createDefaultTasks();
  }
}

/**
 * Persists the current in-memory task list to localStorage.
 */
function saveTasks() {
  window.localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
}

/**
 * Triggers a browser download of a JSON file with the given filename and payload.
 *
 * Creates a temporary anchor element, clicks it programmatically, then removes it.
 *
 * @param {string} filename - The name of the downloaded file (e.g. 'export.json').
 * @param {Object} payload - The data to serialize as JSON and download.
 */
function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Reads and parses the last generated schedule from localStorage.
 *
 * @returns {Object|null} The parsed schedule object, or null if not found or invalid.
 */
function readLastSchedule() {
  const raw = window.localStorage.getItem(STORAGE_KEYS.lastSchedule);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

/**
 * Persists a schedule object to localStorage under the lastSchedule key.
 *
 * @param {Object} schedule - The schedule object to save.
 */
function writeLastSchedule(schedule) {
  window.localStorage.setItem(STORAGE_KEYS.lastSchedule, JSON.stringify(schedule));
}

/**
 * Generates a timestamp string safe for use in filenames.
 *
 * Replaces colons and periods in the ISO timestamp with hyphens so the
 * string can be used as part of a filename on all platforms.
 *
 * @returns {string} A filename-safe timestamp string (e.g. '2024-06-01T12-00-00-000Z').
 */
function buildExportStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Filters out completed tasks whose due date has already passed.
 *
 * Keeps all non-completed tasks and completed tasks whose due date is today
 * or in the future. Used on startup and after changes to prevent stale
 * completed tasks from accumulating in storage.
 *
 * @param {Array<Object>} taskList - The full list of task objects to filter.
 * @returns {Array<Object>} A filtered list with expired completed tasks removed.
 */
function pruneCompletedTasks(taskList) {
  const now = new Date();
  return taskList.filter((task) => {
    if (task.status !== 'completed') {
      return true;
    }
    const dueDate = new Date(`${task.dueDate}T00:01:00`);
    return dueDate >= now;
  });
}

/**
 * Parses a due date string into a Date object set to 00:01 local time.
 *
 * Using 00:01 instead of midnight avoids off-by-one issues with timezone
 * conversions that could shift the date to the previous day.
 *
 * @param {string} dueDate - An ISO date string in YYYY-MM-DD format.
 * @returns {Date} A Date object representing the start of the due date.
 */
function parseDueDateStart(dueDate) {
  return new Date(`${dueDate}T00:01:00`);
}

/**
 * Returns the next half-hour boundary from the current time.
 *
 * Delegates to the shared Planner utility.
 *
 * @returns {Date} A Date object snapped to the next :00 or :30 minute mark.
 */
function getNextHalfHour() {
  return Planner.getNextHalfHour();
}

/**
 * Returns the Monday of the current week as the default schedule start date.
 *
 * Delegates to the shared Planner utility.
 *
 * @returns {Date} A Date object set to 00:00 on the most recent Monday.
 */
function getDefaultStartMonday() {
  return Planner.getCurrentMonday();
}

/**
 * Reads and normalizes the availability data from localStorage.
 *
 * If the stored availability window is stale, normalizes it and writes the
 * updated version back to storage. Returns null if nothing is stored or
 * if parsing fails.
 *
 * @returns {Object|null} The normalized availability object, or null if unavailable.
 */
function loadAvailability() {
  const raw = window.localStorage.getItem(STORAGE_KEYS.availability);
  if (!raw) {
    return null;
  }

  try {
    return Planner.normalizeAvailabilityWindow(JSON.parse(raw), (normalized) => {
      window.localStorage.setItem(STORAGE_KEYS.availability, JSON.stringify(normalized));
    });
  } catch (error) {
    return null;
  }
}

/**
 * Returns an array of time slot strings for the day between START_HOUR and END_HOUR.
 *
 * Delegates to the shared Planner utility using the page-level hour constants.
 *
 * @returns {Array<string>} An array of time slot strings (e.g. ['06:00', '06:30', ...]).
 */
function getTimeSlots() {
  return Planner.getTimeSlots(START_HOUR, END_HOUR);
}

/**
 * Derives the list of future available time blocks from stored availability data.
 *
 * Combines the routine weekly template with any specific 14-day overrides to
 * produce a flat list of open time blocks. Blocks are clipped to start from
 * the next scheduling step and blocks in the past are removed.
 *
 * @returns {Array<{start: string, end: string}>} Sorted array of future open time block objects.
 */
function deriveTimeBlocks() {
  const availability = loadAvailability();
  if (!availability) {
    return [];
  }

  const routine = availability.routine || Array.from({ length: 7 }, () => ({}));
  const specific = availability.schedule14 || Array.from({ length: 14 }, () => ({}));
  const startMonday = availability.startMonday ? new Date(availability.startMonday) : getDefaultStartMonday();
  const slots = getTimeSlots();
  const blocks = [];

  for (let dayIndex = 0; dayIndex < 14; dayIndex += 1) {
    const currentDate = new Date(startMonday);
    currentDate.setDate(startMonday.getDate() + dayIndex);
    currentDate.setHours(0, 0, 0, 0);

    let activeStart = null;

    slots.forEach((slot, slotIndex) => {
      const routineBlocked = Boolean((routine[dayIndex % 7] || {})[slot]);
      const specificBlocked = Boolean((specific[dayIndex] || {})[slot]);
      const isBlocked = routineBlocked || specificBlocked;

      if (!isBlocked && activeStart === null) {
        activeStart = slot;
      }

      const isLastSlot = slotIndex === slots.length - 1;
      if ((isBlocked || isLastSlot) && activeStart !== null) {
        blocks.push({
          start: toIsoDateTime(currentDate, activeStart),
          end: isBlocked ? toIsoDateTime(currentDate, slot) : addThirtyMinutes(currentDate, slot)
        });
        activeStart = null;
      }
    });
  }

  return trimBlocksToFuture(blocks);
}

/**
 * Removes time blocks that fall entirely in the past.
 *
 * Delegates to the shared Planner utility.
 *
 * @param {Array<Object>} blocks - Array of time block objects to filter.
 * @returns {Array<Object>} Blocks with any fully past entries removed.
 */
function trimBlocksToFuture(blocks) {
  return Planner.trimBlocksToFuture(blocks);
}

/**
 * Subtracts committed segments from availability blocks, returning free blocks.
 *
 * Delegates to the shared Planner utility.
 *
 * @param {Array<Object>} blocks - The full available time blocks.
 * @param {Array<Object>} segments - Already-committed segments to remove.
 * @returns {Array<Object>} Remaining free time blocks after subtraction.
 */
function subtractSegmentsFromBlocks(blocks, segments) {
  return Planner.subtractSegmentsFromBlocks(blocks, segments);
}

/**
 * Combines a Date object and a time slot string into an ISO 8601 datetime string.
 *
 * Delegates to the shared Planner utility.
 *
 * @param {Date} date - The date to combine.
 * @param {string} time - A time slot string in 'HH:MM' format.
 * @returns {string} An ISO 8601 datetime string.
 */
function toIsoDateTime(date, time) {
  return Planner.toIsoDateTime(date, time);
}

/**
 * Returns an ISO 8601 datetime string for 30 minutes after a given date and time slot.
 *
 * Delegates to the shared Planner utility.
 *
 * @param {Date} date - The base date.
 * @param {string} time - A time slot string in 'HH:MM' format.
 * @returns {string} An ISO 8601 datetime string 30 minutes after the input.
 */
function addThirtyMinutes(date, time) {
  return Planner.addThirtyMinutes(date, time);
}

/**
 * Updates the availability summary section with total available hours and block count.
 *
 * Reads current availability blocks and updates the DOM elements showing
 * total available hours and a short status note about upcoming blocks.
 */
function updateAvailabilitySummary() {
  const timeBlocks = deriveTimeBlocks();
  const totalMinutes = timeBlocks.reduce(
    (sum, block) => sum + (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60000,
    0
  );

  availableHoursEl.textContent = `${(totalMinutes / 60).toFixed(totalMinutes % 60 === 0 ? 0 : 1)}h`;
  availabilityNote.textContent = timeBlocks.length
    ? `${timeBlocks.length} future block${timeBlocks.length === 1 ? '' : 's'} ready.`
    : 'No availability saved yet.';
}

/**
 * Renders the full task list grouped by status (new, in_progress, completed).
 *
 * Clears the task list container and rebuilds it with a section per status group,
 * each containing task cards sorted by due date. Also updates the task count
 * and completed count summary elements and saves the current task list.
 */
function renderTasks() {
  taskListRoot.innerHTML = '';

  STATUS_ORDER.forEach((status) => {
    const groupedTasks = tasks
      .filter((task) => task.status === status)
      .sort((a, b) => parseDueDateStart(a.dueDate) - parseDueDateStart(b.dueDate));

    const section = document.createElement('section');
    section.className = 'rounded-[1.75rem] border border-graphite/10 bg-cream/45 p-4';
    section.innerHTML = `
      <div class="border-b border-graphite/10 pb-3">
        <p class="text-xs uppercase tracking-[0.18em] text-olive">${STATUS_META[status].label}</p>
        <h3 class="mt-1 font-display text-2xl">${groupedTasks.length}</h3>
      </div>
      <div class="mt-4 space-y-3" data-status-group="${status}"></div>
    `;
    taskListRoot.appendChild(section);

    const groupRoot = section.querySelector(`[data-status-group="${status}"]`);

    if (!groupedTasks.length) {
      groupRoot.innerHTML = `
        <div class="rounded-[1.25rem] border border-dashed border-graphite/12 bg-white/65 px-4 py-3 text-sm text-graphite/50">
          No ${STATUS_META[status].label.toLowerCase()} tasks.
        </div>
      `;
      return;
    }

    groupedTasks.forEach((task) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'panel-appear block w-full rounded-[1.35rem] border border-graphite/10 bg-white/90 px-4 py-4 text-left transition hover:border-terracotta/25 hover:bg-white';
      card.dataset.editTask = task.id;
      card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h4 class="truncate text-base font-semibold">${task.title}</h4>
            <p class="mt-2 text-sm text-graphite/55">Due ${formatDateOnly(task.dueDate)}</p>
            <p class="mt-1 text-sm text-graphite/50">${task.estimateMinutes} min | ${formatLevel(task.priority)} priority | ${formatLevel(task.cognitiveLoad)} load</p>
          </div>
          <span class="rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${STATUS_META[task.status].tone}">${STATUS_META[task.status].label}</span>
        </div>
      `;
      groupRoot.appendChild(card);
    });
  });

  taskCountEl.textContent = String(tasks.filter((task) => task.status !== 'completed').length);
  completedCountEl.textContent = String(tasks.filter((task) => task.status === 'completed').length);
  saveTasks();
}

/**
 * Updates the schedule health banner with the appropriate message and color tone.
 *
 * Reads the health message and tone from the Planner utility, then applies
 * the corresponding CSS classes to the health element. Supports 'warning',
 * 'success', and neutral tones.
 *
 * @param {Object|null} payload - The current schedule payload, or null if no schedule exists.
 */
function renderScheduleHealth(payload) {
  const health = Planner.getScheduleHealthMessage(payload);
  scheduleHealthEl.textContent = health.message;
  scheduleHealthEl.classList.remove(
    'hidden',
    'border-red-300/40',
    'bg-red-50/10',
    'text-red-100',
    'border-olive/20',
    'bg-olive/10',
    'text-cream',
    'border-white/10',
    'bg-white/5',
    'text-cream/75'
  );

  if (health.tone === 'warning') {
    scheduleHealthEl.classList.add('border-red-300/40', 'bg-red-50/10', 'text-red-100');
    return;
  }
  if (health.tone === 'success') {
    scheduleHealthEl.classList.add('border-olive/20', 'bg-olive/10', 'text-cream');
    return;
  }

  scheduleHealthEl.classList.add('border-white/10', 'bg-white/5', 'text-cream/75');
}

/**
 * Capitalizes the first letter of a priority or cognitive load value for display.
 *
 * @param {string} value - A lowercase level string (e.g. 'high', 'medium', 'low').
 * @returns {string} The value with its first letter capitalized.
 */
function formatLevel(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Formats an ISO date string into a short human-readable date (e.g. 'Jun 3').
 *
 * Uses the browser's locale for month/day formatting.
 *
 * @param {string} isoString - An ISO date string in YYYY-MM-DD format.
 * @returns {string} A formatted date string showing month and day.
 */
function formatDateOnly(isoString) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(parseDueDateStart(isoString));
}

/**
 * Ensures the 'Completed' option is present or absent in a status select element.
 *
 * Used to prevent new tasks from being created with a completed status while
 * allowing existing tasks to be set to completed during editing.
 *
 * @param {HTMLSelectElement} selectEl - The status dropdown element to modify.
 * @param {boolean} includeCompleted - If true, adds the 'Completed' option if missing.
 *   If false, removes it and resets the value to 'new' if currently set to 'completed'.
 */
function ensureStatusOptions(selectEl, includeCompleted) {
  const completedOption = selectEl.querySelector('option[value="completed"]');
  if (includeCompleted) {
    if (!completedOption) {
      const option = document.createElement('option');
      option.value = 'completed';
      option.textContent = 'Completed';
      selectEl.appendChild(option);
    }
    return;
  }
  if (completedOption) {
    completedOption.remove();
  }
  if (selectEl.value === 'completed') {
    selectEl.value = 'new';
  }
}

/**
 * Reads the raw availability object from localStorage without normalization.
 *
 * Used when exporting a debug bundle to capture the exact stored state.
 *
 * @returns {Object|null} The raw parsed availability object, or null if unavailable.
 */
function readAvailabilityRaw() {
  const raw = window.localStorage.getItem(STORAGE_KEYS.availability);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

/**
 * Shows or hides the developer tools cluster by toggling CSS classes.
 *
 * @param {boolean} isVisible - If true, shows the developer tools; if false, hides them.
 */
function setDeveloperVisibility(isVisible) {
  developerToolsEl.classList.toggle('hidden', !isVisible);
  developerToolsEl.classList.toggle('flex', isVisible);
}

/**
 * Opens the task modal pre-filled with the given task's data, or blank for a new task.
 *
 * Sets the modal title, populates all form fields, controls visibility of the
 * delete button, and clears any previous feedback text.
 *
 * @param {Object|null} task - The task to edit, or null to open the modal for a new task.
 */
function openTaskModal(task = null) {
  const isNewTask = !task;
  activeTaskId = task?.id || null;
  ensureStatusOptions(modalTaskStatus, !isNewTask);
  taskModalTitle.textContent = isNewTask ? 'Add Task' : 'Edit Task';
  modalTaskTitle.value = task?.title || '';
  modalTaskEstimate.value = String(task?.estimateMinutes || 60);
  modalTaskDue.value = task?.dueDate || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  modalTaskPriority.value = task?.priority || 'medium';
  modalTaskCognitive.value = task?.cognitiveLoad || 'medium';
  modalTaskStatus.value = task?.status || 'new';
  modalTaskNotes.value = task?.notes || '';
  taskModalFeedback.textContent = '';
  deleteTaskBtn.classList.toggle('hidden', isNewTask);
  taskModal.classList.remove('hidden');
  taskModal.classList.add('flex');
}

/**
 * Closes the task modal and resets the active task ID and feedback text.
 */
function closeTaskModal() {
  taskModal.classList.add('hidden');
  taskModal.classList.remove('flex');
  activeTaskId = null;
  taskModalFeedback.textContent = '';
}

/**
 * Reads the current form values from the task modal and returns them as a task object.
 *
 * Does not include an ID — callers are responsible for assigning one if needed.
 *
 * @returns {{title: string, estimateMinutes: number, dueDate: string, priority: string,
 *   cognitiveLoad: string, status: string, notes: string}} The task field values from the modal.
 */
function readModalTask() {
  return {
    title: modalTaskTitle.value.trim(),
    estimateMinutes: Number(modalTaskEstimate.value),
    dueDate: modalTaskDue.value,
    priority: modalTaskPriority.value,
    cognitiveLoad: modalTaskCognitive.value,
    status: modalTaskStatus.value,
    notes: modalTaskNotes.value.trim()
  };
}

/**
 * Attaches all event listeners for the task page.
 *
 * Covers: add task button, clear completed, developer tool buttons,
 * modal open/close/save/delete, task card edit clicks, cross-tab storage
 * sync, and Shift key developer tools visibility toggle.
 */
function bindEvents() {
  document.getElementById('add-task').addEventListener('click', () => {
    openTaskModal();
  });

  document.getElementById('clear-completed').addEventListener('click', () => {
    tasks = tasks.filter((task) => task.status !== 'completed');
    saveTasks();
    renderTasks();
    scheduleAutoOptimization('Updating...');
  });

  debugResetBtn.addEventListener('click', () => {
    tasks = [];
    saveTasks();
    window.localStorage.removeItem(STORAGE_KEYS.lastSchedule);
    renderTasks();
    updateScheduleSummary(null);
    hideFeedback();
    planMeta.textContent = 'Reset';
  });

  debugRandomTaskBtn.addEventListener('click', () => {
    tasks.push(buildRandomDeveloperTask());
    saveTasks();
    renderTasks();
    scheduleAutoOptimization('Updating...');
  });

  debugForceReoptimizeBtn.addEventListener('click', () => {
    forceReoptimize();
  });

  debugExportBundleBtn.addEventListener('click', () => {
    const requestPayload = buildScheduleRequestPayload();
    downloadJsonFile(`architecture-debug-bundle-${buildExportStamp()}.json`, {
      exportedAt: new Date().toISOString(),
      availability: readAvailabilityRaw(),
      schedule: readLastSchedule(),
      tasks,
      scheduleRequest: {
        cutoff: requestPayload.cutoff.toISOString(),
        availableBlocks: requestPayload.availableBlocks,
        schedulableTasks: requestPayload.schedulableTasks,
        request: requestPayload.request
      }
    });
    showFeedback('Debug bundle exported for troubleshooting.', 'success');
  });

  closeTaskModalBtn.addEventListener('click', closeTaskModal);
  taskModal.addEventListener('click', (event) => {
    if (event.target === taskModal) {
      closeTaskModal();
    }
  });

  saveTaskBtn.addEventListener('click', () => {
    const nextTask = readModalTask();
    if (!nextTask.title || !nextTask.dueDate || !nextTask.estimateMinutes) {
      taskModalFeedback.textContent = 'Add a title, estimate, and due date.';
      return;
    }
    if (nextTask.estimateMinutes <= 0 || nextTask.estimateMinutes > 20160) {
      taskModalFeedback.textContent = 'Estimate must be between 15 minutes and 2 weeks.';
      return;
    }
    const estimateValidationMessage = Planner.getTaskEstimateValidationMessage(
      nextTask.estimateMinutes,
      nextTask.cognitiveLoad,
      nextTask.dueDate
    );
    if (estimateValidationMessage) {
      taskModalFeedback.textContent = estimateValidationMessage;
      return;
    }
    if (!activeTaskId && nextTask.status === 'completed') {
      taskModalFeedback.textContent = 'New tasks cannot start as completed.';
      return;
    }

    if (activeTaskId) {
      tasks = tasks.map((task) => (
        task.id === activeTaskId
          ? { ...task, ...nextTask }
          : task
      ));
      saveTasks();
      closeTaskModal();
      renderTasks();
      scheduleAutoOptimization('Updating...');
      return;
    }

    tasks.push({
      id: crypto.randomUUID(),
      ...nextTask
    });
    saveTasks();
    closeTaskModal();
    renderTasks();
    scheduleAutoOptimization('Updating...');
  });

  deleteTaskBtn.addEventListener('click', () => {
    if (!activeTaskId) {
      return;
    }
    tasks = tasks.filter((task) => task.id !== activeTaskId);
    saveTasks();
    closeTaskModal();
    renderTasks();
    scheduleAutoOptimization('Updating...');
  });

  document.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit-task]');
    if (editButton) {
      const task = tasks.find((item) => item.id === editButton.dataset.editTask);
      if (task) {
        openTaskModal(task);
      }
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.availability) {
      updateAvailabilitySummary();
      scheduleAutoOptimization('Updating...');
    }
    if (event.key === STORAGE_KEYS.tasks) {
      tasks = pruneCompletedTasks(loadTasks());
      renderTasks();
      scheduleAutoOptimization('Updating...');
    }
    if (event.key === STORAGE_KEYS.lastSchedule) {
      const latestSchedule = readLastSchedule();
      updateScheduleSummary(latestSchedule);
      renderScheduleHealth(latestSchedule);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Shift') {
      setDeveloperVisibility(true);
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Shift') {
      setDeveloperVisibility(false);
    }
  });

  window.addEventListener('blur', () => {
    setDeveloperVisibility(false);
  });
}

/**
 * Polls the backend health endpoint and updates the health indicator badge.
 *
 * On success, shows a green 'Connected' badge. On failure, shows a red 'Offline'
 * badge and retries after 1500ms. Errors are logged to the console.
 *
 * @returns {Promise<void>}
 */
async function checkHealth() {
  try {
    console.info('[tasks] checking backend health', { url: `${API_BASE_URL}/health` });
    const response = await fetchWithTimeout(`${API_BASE_URL}/health`);
    if (!response.ok) {
      throw new Error('Backend unavailable');
    }
    console.info('[tasks] backend health connected');

    healthIndicator.textContent = 'Connected';
    healthIndicator.className = 'rounded-full border border-olive/20 bg-olive/10 px-3 py-1 text-sm text-olive';
  } catch (error) {
    console.error('[tasks] backend health failed', error);
    healthIndicator.textContent = 'Offline';
    healthIndicator.className = 'rounded-full border border-red-300/40 bg-red-50 px-3 py-1 text-sm text-red-700';
    window.setTimeout(checkHealth, 1500);
  }
}

/**
 * Wraps the Fetch API with an AbortController-based timeout.
 *
 * Automatically aborts the request if it exceeds the given timeout and throws
 * a descriptive error. The timeout is always cleared whether the request
 * succeeds or fails.
 *
 * @param {string} url - The URL to fetch.
 * @param {RequestInit} [options={}] - Standard fetch options.
 * @param {number} [timeoutMs=API_TIMEOUT_MS] - Timeout in milliseconds before aborting.
 * @returns {Promise<Response>} The fetch Response if the request completes in time.
 * @throws {Error} If the request times out or the fetch itself fails.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Backend request timed out.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Reads and parses a backend API response, throwing descriptive errors on failure.
 *
 * Handles non-JSON responses, non-OK HTTP statuses, backend error message extraction,
 * and empty response bodies. Always throws an Error with a human-readable message
 * so callers can display feedback directly.
 *
 * @param {Response} response - The fetch Response object to read.
 * @returns {Promise<Object>} The parsed JSON payload.
 * @throws {Error} If the response is not OK, not valid JSON, or empty.
 */
async function readApiResponse(response) {
  const rawText = await response.text();
  let payload = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (error) {
      if (response.ok) {
        throw new Error(`Backend returned invalid JSON (${response.status} ${response.statusText}).`);
      }

      const excerpt = rawText.replace(/\s+/g, ' ').trim().slice(0, 160);
      throw new Error(
        excerpt
          ? `Backend error ${response.status} ${response.statusText}: ${excerpt}`
          : `Backend error ${response.status} ${response.statusText}.`
      );
    }
  }

  if (!response.ok) {
    const backendMessage = payload?.error || payload?.message;
    throw new Error(
      backendMessage
        ? `Backend error ${response.status}: ${backendMessage}`
        : `Backend error ${response.status} ${response.statusText}.`
    );
  }

  if (!payload) {
    throw new Error('Backend returned an empty response.');
  }

  return payload;
}

/**
 * Debounces automatic schedule optimization by resetting a 500ms timer on each call.
 *
 * If called repeatedly (e.g. during rapid task edits), only the final call
 * after a 500ms pause triggers a full optimization run. Updates the plan
 * meta label immediately with the given message.
 *
 * @param {string} [message='Updating...'] - The status text to show while waiting.
 */
function scheduleAutoOptimization(message = 'Updating...') {
  if (autoGenerateTimer) {
    window.clearTimeout(autoGenerateTimer);
  }
  planMeta.textContent = message;
  autoGenerateTimer = window.setTimeout(() => {
    generatePlan(true);
  }, 500);
}

/**
 * Immediately triggers a full schedule re-optimization, bypassing the debounce timer.
 *
 * Cancels any pending debounced run and blocks if a generation is already in progress.
 *
 * @param {string} [message='Re-optimizing...'] - The status text to display during the run.
 */
function forceReoptimize(message = 'Re-optimizing...') {
  if (autoGenerateTimer) {
    window.clearTimeout(autoGenerateTimer);
    autoGenerateTimer = null;
  }
  if (isGenerating) {
    showFeedback('A schedule run is already in progress.', 'error');
    return;
  }
  planMeta.textContent = message;
  generatePlan(false);
}

/**
 * Assembles the full payload needed to send a schedule request to the backend.
 *
 * Reads availability, derives free time blocks, subtracts already-fixed segments
 * before the scheduling cutoff, and filters tasks to only those needing scheduling.
 *
 * @returns {{cutoff: Date, previousSchedule: Object|null, availableBlocks: Array,
 *   schedulableTasks: Array, request: {timeBlocks: Array, tasks: Array}}}
 *   All data needed for a schedule API call, plus intermediate values for logging.
 */
function buildScheduleRequestPayload() {
  const timeBlocks = deriveTimeBlocks();
  const cutoff = getNextHalfHour();
  const previousSchedule = readLastSchedule();
  const fixedSegments = Planner.getFixedSegmentsBeforeCutoff(previousSchedule?.schedule || [], cutoff);
  const availableBlocks = subtractSegmentsFromBlocks(timeBlocks, fixedSegments);
  const schedulableTasks = buildSchedulingTasks(tasks, previousSchedule, cutoff);

  return {
    cutoff,
    previousSchedule,
    availableBlocks,
    schedulableTasks,
    request: {
      timeBlocks: availableBlocks.map((block) => ({
        start: block.start,
        end: block.end
      })),
      tasks: schedulableTasks
    }
  };
}

/**
 * Runs a full schedule optimization cycle against the backend API.
 *
 * Handles the complete lifecycle: availability check, task check, API call,
 * merging with history, saving, and updating the UI. Background runs suppress
 * user-facing feedback messages; foreground runs show success or error toasts.
 *
 * @param {boolean} [isBackgroundRun=false] - If true, suppresses feedback banners
 *   and runs silently in the background.
 * @returns {Promise<void>}
 */
async function generatePlan(isBackgroundRun = false) {
  if (isGenerating) {
    return;
  }

  hideFeedback();
  const { cutoff, previousSchedule, availableBlocks, schedulableTasks, request } = buildScheduleRequestPayload();

  if (!availableBlocks.length) {
    planMeta.textContent = 'No availability';
    updateScheduleSummary(previousSchedule);
    renderScheduleHealth(previousSchedule);
    if (!isBackgroundRun) {
      showFeedback('No availability found.', 'error');
    }
    return;
  }

  if (!schedulableTasks.length) {
    const mergedSchedule = mergeScheduleHistory(previousSchedule, { summary: null, schedule: [], unscheduled: [] }, tasks, cutoff, availableBlocks);
    writeLastSchedule(mergedSchedule);
    updateScheduleSummary(mergedSchedule);
    renderScheduleHealth(mergedSchedule);
    planMeta.textContent = 'Up to date';
    if (!isBackgroundRun) {
      showFeedback('Nothing new to schedule.', 'success');
    }
    return;
  }

  isGenerating = true;
  planMeta.textContent = 'Updating...';

  try {
    console.info('[tasks] schedule request starting', {
      availableBlockCount: availableBlocks.length,
      schedulableTaskCount: schedulableTasks.length,
      request
    });
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    const payload = await readApiResponse(response);
    console.info('[tasks] schedule request finished', {
      scheduledCount: payload.summary?.scheduledCount,
      unscheduledCount: payload.summary?.unscheduledCount,
      solver: payload.meta?.solver,
      elapsedMs: payload.meta?.elapsedMs
    });

    const mergedSchedule = mergeScheduleHistory(previousSchedule, payload, tasks, cutoff, availableBlocks);
    writeLastSchedule(mergedSchedule);
    updateScheduleSummary(mergedSchedule);
    renderScheduleHealth(mergedSchedule);
    const statusText = mergedSchedule.summary?.incompleteCount
      ? 'Needs attention'
      : 'Up to date';
    const solverMeta = formatSolverMeta(mergedSchedule);
    planMeta.textContent = solverMeta ? `${statusText} - ${solverMeta}` : statusText;
    if (!isBackgroundRun) {
      showFeedback(
        mergedSchedule.summary?.incompleteCount
          ? `Updated. Some tasks still miss their deadlines.${solverMeta ? ` ${solverMeta}.` : ''}`
          : `Updated.${solverMeta ? ` ${solverMeta}.` : ''}`,
        mergedSchedule.summary?.incompleteCount ? 'error' : 'success'
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scheduling error.';
    console.error('[tasks] schedule request failed', error);
    planMeta.textContent = message;
    console.error('Background optimization failed:', error);
    showFeedback(message, 'error');
  } finally {
    isGenerating = false;
  }
}

/**
 * Filters and formats the task list for submission to the backend scheduler.
 *
 * Delegates to the shared Planner utility. Excludes tasks already fully
 * scheduled before the cutoff and applies any necessary field transformations.
 *
 * @param {Array<Object>} taskList - The full list of task objects.
 * @param {Object|null} previousSchedule - The last saved schedule, used to detect already-placed tasks.
 * @param {Date} cutoff - The scheduling cutoff time; segments before this are treated as fixed.
 * @returns {Array<Object>} Tasks formatted for the backend API request.
 */
function buildSchedulingTasks(taskList, previousSchedule, cutoff) {
  return Planner.buildSchedulingTasks(taskList, previousSchedule, cutoff);
}

/**
 * Merges a new backend schedule result with the preserved history from the previous schedule.
 *
 * Delegates to the shared Planner utility. Fixed segments before the cutoff
 * are preserved and combined with the newly scheduled segments.
 *
 * @param {Object|null} previousSchedule - The last saved schedule object.
 * @param {Object} nextSchedule - The new schedule result from the backend.
 * @param {Array<Object>} taskList - The current full task list.
 * @param {Date} cutoff - The scheduling cutoff time.
 * @returns {Object} A merged schedule object ready to be saved and rendered.
 */
function mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff) {
  return Planner.mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff);
}

/**
 * Formats the solver name and elapsed time from a schedule into a short display string.
 *
 * Returns an empty string if solver metadata is missing or incomplete.
 *
 * @param {Object|null} scheduleData - The schedule object containing meta.solver and meta.elapsedMs.
 * @returns {string} A formatted string like 'python-cp-sat in 42.3 ms', or '' if unavailable.
 */
function formatSolverMeta(scheduleData) {
  const solver = scheduleData?.meta?.solver;
  const elapsedMs = scheduleData?.meta?.elapsedMs;
  if (!solver || typeof elapsedMs !== 'number') {
    return '';
  }
  return `${solver} in ${elapsedMs.toFixed(elapsedMs < 10 ? 2 : 1)} ms`;
}

/**
 * Updates the plan runtime display element with the last solver timing string.
 *
 * Does nothing if the planRuntime element is not present in the DOM.
 *
 * @param {Object|null} scheduleData - The schedule object to read solver metadata from.
 */
function updatePlanRuntime(scheduleData) {
  if (!planRuntime) {
    return;
  }

  const solverMeta = formatSolverMeta(scheduleData);
  planRuntime.textContent = solverMeta ? `Last search time: ${solverMeta}` : 'No recent search time.';
}

/**
 * Updates the schedule summary section with counts and health status from a schedule payload.
 *
 * Resets all summary values to zero and clears health/runtime if the payload is null.
 *
 * @param {Object|null} payload - The schedule payload to read summary data from.
 */
function updateScheduleSummary(payload) {
  const summary = payload?.summary;
  if (!summary) {
    scheduledCountEl.textContent = '0';
    renderScheduleHealth(null);
    updatePlanRuntime(null);
    return;
  }

  scheduledCountEl.textContent = String(summary.scheduledCount || 0);
  renderScheduleHealth(payload);
  updatePlanRuntime(payload);
}

/**
 * Displays a feedback banner with the given message and color tone.
 *
 * Removes the 'hidden' class and applies error (red) or success (olive) styling.
 *
 * @param {string} message - The text to display in the feedback banner.
 * @param {'error'|'success'} tone - The visual style to apply.
 */
function showFeedback(message, tone) {
  feedbackEl.textContent = message;
  feedbackEl.classList.remove('hidden', 'bg-red-50', 'text-red-700', 'bg-olive/10', 'text-olive');
  if (tone === 'error') {
    feedbackEl.classList.add('bg-red-50', 'text-red-700');
  } else {
    feedbackEl.classList.add('bg-olive/10', 'text-olive');
  }
}

/**
 * Hides the feedback banner by adding the 'hidden' class.
 */
function hideFeedback() {
  feedbackEl.classList.add('hidden');
}

tasks = pruneCompletedTasks(tasks);
saveTasks();
setDeveloperVisibility(false);
renderTasks();
bindEvents();
checkHealth();
updateAvailabilitySummary();
updateScheduleSummary(readLastSchedule());