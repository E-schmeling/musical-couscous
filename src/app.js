const API_BASE_URL = 'http://127.0.0.1:5050';
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
const availabilityNote = document.getElementById('availability-note');
const debugResetBtn = document.getElementById('debug-reset');
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

function formatLocalDateOffset(daysFromToday) {
  const nextDate = new Date();
  nextDate.setHours(0, 0, 0, 0);
  nextDate.setDate(nextDate.getDate() + daysFromToday);
  return nextDate.toISOString().slice(0, 10);
}

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

function saveTasks() {
  window.localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
}

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

function writeLastSchedule(schedule) {
  window.localStorage.setItem(STORAGE_KEYS.lastSchedule, JSON.stringify(schedule));
}

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

function parseDueDateStart(dueDate) {
  return new Date(`${dueDate}T00:01:00`);
}

function getNextHalfHour() {
  return Planner.getNextHalfHour();
}

function getDefaultStartMonday() {
  return Planner.getCurrentMonday();
}

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

function getTimeSlots() {
  return Planner.getTimeSlots(START_HOUR, END_HOUR);
}

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

function trimBlocksToFuture(blocks) {
  return Planner.trimBlocksToFuture(blocks);
}

function subtractSegmentsFromBlocks(blocks, segments) {
  return Planner.subtractSegmentsFromBlocks(blocks, segments);
}

function toIsoDateTime(date, time) {
  return Planner.toIsoDateTime(date, time);
}

function addThirtyMinutes(date, time) {
  return Planner.addThirtyMinutes(date, time);
}

function updateAvailabilitySummary() {
  const timeBlocks = deriveTimeBlocks();
  const totalMinutes = timeBlocks.reduce(
    (sum, block) => sum + (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60000,
    0
  );

  availableHoursEl.textContent = `${(totalMinutes / 60).toFixed(totalMinutes % 60 === 0 ? 0 : 1)}h`;
  availabilityNote.textContent = timeBlocks.length
    ? `${timeBlocks.length} future availability blocks are ready. Optimization runs automatically in the background.`
    : 'No saved availability yet. Mark time in Schedule Refiner first.';
}

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

function formatLevel(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDateOnly(isoString) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(parseDueDateStart(isoString));
}

function openTaskModal(task = null) {
  const isNewTask = !task;
  activeTaskId = task?.id || null;
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

function closeTaskModal() {
  taskModal.classList.add('hidden');
  taskModal.classList.remove('flex');
  activeTaskId = null;
  taskModalFeedback.textContent = '';
}

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

function bindEvents() {
  document.getElementById('add-task').addEventListener('click', () => {
    openTaskModal();
  });

  document.getElementById('clear-completed').addEventListener('click', () => {
    tasks = tasks.filter((task) => task.status !== 'completed');
    saveTasks();
    renderTasks();
    scheduleAutoOptimization('Completed tasks cleared. Optimizing in the background...');
  });

  debugResetBtn.addEventListener('click', () => {
    tasks = [];
    window.localStorage.removeItem(STORAGE_KEYS.tasks);
    window.localStorage.removeItem(STORAGE_KEYS.lastSchedule);
    renderTasks();
    updateScheduleSummary(null);
    hideFeedback();
    planMeta.textContent = 'Planner reset for debugging';
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

    if (activeTaskId) {
      tasks = tasks.map((task) => (
        task.id === activeTaskId
          ? { ...task, ...nextTask }
          : task
      ));
      closeTaskModal();
      renderTasks();
      scheduleAutoOptimization('Task updated. Optimizing in the background...');
      return;
    }

    tasks.push({
      id: crypto.randomUUID(),
      ...nextTask
    });
    closeTaskModal();
    renderTasks();
    scheduleAutoOptimization('Task added. Optimizing in the background...');
  });

  deleteTaskBtn.addEventListener('click', () => {
    if (!activeTaskId) {
      return;
    }
    tasks = tasks.filter((task) => task.id !== activeTaskId);
    closeTaskModal();
    renderTasks();
    scheduleAutoOptimization('Task removed. Optimizing in the background...');
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
      scheduleAutoOptimization('Availability changed. Optimizing in the background...');
    }
    if (event.key === STORAGE_KEYS.tasks) {
      tasks = pruneCompletedTasks(loadTasks());
      renderTasks();
      updateScheduleSummary(readLastSchedule());
    }
  });
}

async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) {
      throw new Error('Backend unavailable');
    }

    healthIndicator.textContent = 'Running';
    healthIndicator.className = 'rounded-full border border-olive/20 bg-olive/10 px-3 py-1 text-sm text-olive';
  } catch (error) {
    healthIndicator.textContent = 'Offline';
    healthIndicator.className = 'rounded-full border border-red-300/40 bg-red-50 px-3 py-1 text-sm text-red-700';
    window.setTimeout(checkHealth, 1500);
  }
}

function scheduleAutoOptimization(message = 'Optimizing in the background...') {
  if (autoGenerateTimer) {
    window.clearTimeout(autoGenerateTimer);
  }
  planMeta.textContent = message;
  autoGenerateTimer = window.setTimeout(() => {
    generatePlan(true);
  }, 500);
}

async function generatePlan(isBackgroundRun = false) {
  if (isGenerating) {
    return;
  }

  hideFeedback();
  const timeBlocks = deriveTimeBlocks();
  const cutoff = getNextHalfHour();
  const previousSchedule = readLastSchedule();
  const fixedSegments = (previousSchedule?.schedule || [])
    .flatMap((task) => task.segments)
    .filter((segment) => new Date(segment.start) < cutoff);
  const availableBlocks = subtractSegmentsFromBlocks(timeBlocks, fixedSegments);
  const schedulableTasks = buildSchedulingTasks(tasks, previousSchedule, cutoff);

  if (!availableBlocks.length) {
    planMeta.textContent = 'Waiting for availability';
    updateScheduleSummary(previousSchedule);
    renderScheduleHealth(previousSchedule);
    if (!isBackgroundRun) {
      showFeedback('No availability found. Save time in Schedule Refiner first.', 'error');
    }
    return;
  }

  if (!schedulableTasks.length) {
    const mergedSchedule = mergeScheduleHistory(previousSchedule, { summary: null, schedule: [], unscheduled: [] }, tasks, cutoff, availableBlocks);
    writeLastSchedule(mergedSchedule);
    updateScheduleSummary(mergedSchedule);
    renderScheduleHealth(mergedSchedule);
    planMeta.textContent = 'No remaining tasks to optimize';
    if (!isBackgroundRun) {
      showFeedback('Nothing new needs scheduling right now.', 'success');
    }
    return;
  }

  isGenerating = true;
  planMeta.textContent = 'Optimizing now...';

  try {
    const response = await fetch(`${API_BASE_URL}/api/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        timeBlocks: availableBlocks.map((block) => ({
          start: block.start,
          end: block.end
        })),
        tasks: schedulableTasks
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to generate a schedule.');
    }

    const mergedSchedule = mergeScheduleHistory(previousSchedule, payload, tasks, cutoff, availableBlocks);
    writeLastSchedule(mergedSchedule);
    updateScheduleSummary(mergedSchedule);
    renderScheduleHealth(mergedSchedule);
    planMeta.textContent = mergedSchedule.summary?.incompleteCount
      ? 'Plan synced with unresolved task deadlines'
      : 'Plan synced in the background';
    if (!isBackgroundRun) {
      showFeedback(
        mergedSchedule.summary?.incompleteCount
          ? 'Schedule updated, but some tasks still cannot be fully completed before their due dates.'
          : 'Schedule updated.',
        mergedSchedule.summary?.incompleteCount ? 'error' : 'success'
      );
    }
  } catch (error) {
    planMeta.textContent = 'Optimization paused';
    console.error('Background optimization failed:', error);
    showFeedback(error.message, 'error');
  } finally {
    isGenerating = false;
  }
}

function buildSchedulingTasks(taskList, previousSchedule, cutoff) {
  return Planner.buildSchedulingTasks(taskList, previousSchedule, cutoff);
}

function mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff) {
  return Planner.mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff);
}

function updateScheduleSummary(payload) {
  const summary = payload?.summary;
  if (!summary) {
    scheduledCountEl.textContent = '0';
    renderScheduleHealth(null);
    return;
  }

  scheduledCountEl.textContent = String(summary.scheduledCount || 0);
  renderScheduleHealth(payload);
}

function showFeedback(message, tone) {
  feedbackEl.textContent = message;
  feedbackEl.classList.remove('hidden', 'bg-red-50', 'text-red-700', 'bg-olive/10', 'text-olive');
  if (tone === 'error') {
    feedbackEl.classList.add('bg-red-50', 'text-red-700');
  } else {
    feedbackEl.classList.add('bg-olive/10', 'text-olive');
  }
}

function hideFeedback() {
  feedbackEl.classList.add('hidden');
}

tasks = pruneCompletedTasks(tasks);
saveTasks();
renderTasks();
bindEvents();
checkHealth();
updateAvailabilitySummary();
updateScheduleSummary(readLastSchedule());
scheduleAutoOptimization();
