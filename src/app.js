const API_BASE_URL = 'http://127.0.0.1:5050';
const STORAGE_KEYS = {
  availability: 'architectureAvailability',
  tasks: 'architectureTasks',
  lastSchedule: 'architectureLastSchedule'
};

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
const DEFAULT_TASKS = [
  {
    id: crypto.randomUUID(),
    title: 'Site analysis package',
    estimateMinutes: 180,
    dueDate: '2026-04-17',
    status: 'new',
    priority: 'high',
    cognitiveLoad: 'high',
    notes: ''
  },
  {
    id: crypto.randomUUID(),
    title: 'Zoning research summary',
    estimateMinutes: 120,
    dueDate: '2026-04-19',
    status: 'in_progress',
    priority: 'medium',
    cognitiveLoad: 'medium',
    notes: ''
  },
  {
    id: crypto.randomUUID(),
    title: 'Concept sketch revisions',
    estimateMinutes: 90,
    dueDate: '2026-04-21',
    status: 'new',
    priority: 'high',
    cognitiveLoad: 'low',
    notes: ''
  }
];

let tasks = pruneCompletedTasks(loadTasks());
let autoGenerateTimer = null;
let isGenerating = false;
let activeTaskId = null;

function loadTasks() {
  const raw = window.localStorage.getItem(STORAGE_KEYS.tasks);
  if (!raw) {
    return DEFAULT_TASKS;
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
      : DEFAULT_TASKS;
  } catch (error) {
    return DEFAULT_TASKS;
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
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  const minutes = next.getMinutes();
  next.setMinutes(minutes < 30 ? 30 : 60, 0, 0);
  return next;
}

function getDefaultStartMonday() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diffToMonday = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const startMonday = new Date(today);
  startMonday.setHours(0, 0, 0, 0);
  startMonday.setDate(diffToMonday);
  return startMonday;
}

function loadAvailability() {
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

function getTimeSlots() {
  const slots = [];
  for (let hour = START_HOUR; hour <= END_HOUR; hour += 1) {
    slots.push(`${hour}:00`);
    slots.push(`${hour}:30`);
  }
  return slots;
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
  const nextHalfHour = getNextHalfHour();
  return blocks
    .map((block) => {
      const start = new Date(block.start);
      const end = new Date(block.end);
      if (end <= nextHalfHour) {
        return null;
      }
      return {
        start: (start < nextHalfHour ? nextHalfHour : start).toISOString(),
        end: end.toISOString()
      };
    })
    .filter((block) => block && new Date(block.end) > new Date(block.start));
}

function subtractSegmentsFromBlocks(blocks, segments) {
  return blocks.flatMap((block) => {
    let remaining = [{ start: new Date(block.start), end: new Date(block.end) }];

    segments.forEach((segment) => {
      const segStart = new Date(segment.start);
      const segEnd = new Date(segment.end);

      remaining = remaining.flatMap((part) => {
        if (segEnd <= part.start || segStart >= part.end) {
          return [part];
        }

        const nextParts = [];
        if (segStart > part.start) {
          nextParts.push({ start: part.start, end: segStart });
        }
        if (segEnd < part.end) {
          nextParts.push({ start: segEnd, end: part.end });
        }
        return nextParts;
      });
    });

    return remaining
      .filter((part) => part.end > part.start)
      .map((part) => ({
        start: part.start.toISOString(),
        end: part.end.toISOString()
      }));
  });
}

function toIsoDateTime(date, time) {
  const [hourText, minuteText] = time.split(':');
  const nextDate = new Date(date);
  nextDate.setHours(Number(hourText), Number(minuteText), 0, 0);
  return nextDate.toISOString();
}

function addThirtyMinutes(date, time) {
  const [hourText, minuteText] = time.split(':');
  const next = new Date(date);
  next.setHours(Number(hourText), Number(minuteText), 0, 0);
  next.setMinutes(next.getMinutes() + 30);
  return next.toISOString();
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
      if (estimateMinutes < 0 || estimateMinutes > 20160) {
          taskModalFeedback.textContent = 'Estimate must be 0 to 2 weeks.';
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
    if (!isBackgroundRun) {
      showFeedback('No availability found. Save time in Schedule Refiner first.', 'error');
    }
    return;
  }

  if (!schedulableTasks.length) {
    const emptySchedule = mergeScheduleHistory(previousSchedule, { summary: null, schedule: [], unscheduled: [] }, tasks, cutoff);
    writeLastSchedule({
      summary: {
        timeBlockCount: availableBlocks.length,
        taskCount: 0,
        scheduledCount: emptySchedule.schedule.length,
        unscheduledCount: 0,
        totalAvailableMinutes: availableBlocks.reduce(
          (sum, block) => sum + (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60000,
          0
        ),
        totalPlannedMinutes: 0
      },
      schedule: emptySchedule.schedule,
      unscheduled: []
    });
    updateScheduleSummary(readLastSchedule());
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

    const mergedSchedule = mergeScheduleHistory(previousSchedule, payload, tasks, cutoff);
    writeLastSchedule(mergedSchedule);
    updateScheduleSummary(mergedSchedule);
    planMeta.textContent = 'Plan synced in the background';
    if (!isBackgroundRun) {
      showFeedback('Schedule updated.', 'success');
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
  const allocatedMinutes = new Map();

  (previousSchedule?.schedule || []).forEach((task) => {
    const spentMinutes = task.segments
      .filter((segment) => new Date(segment.start) < cutoff)
      .reduce((sum, segment) => sum + Number(segment.allocatedMinutes || 0), 0);
    allocatedMinutes.set(task.id, spentMinutes);
  });

  return taskList
    .filter((task) => task.status !== 'completed')
    .map((task) => {
      const remainingMinutes = Math.max(0, task.estimateMinutes - (allocatedMinutes.get(task.id) || 0));
      const normalizedRemainingMinutes = remainingMinutes > 0 && remainingMinutes < 60 && task.estimateMinutes >= 60
        ? 60
        : remainingMinutes;

      return {
        ...task,
        estimateMinutes: normalizedRemainingMinutes
      };
    })
    .filter((task) => task.estimateMinutes > 0);
}

function mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff) {
  const taskMap = new Map(taskList.map((task) => [task.id, task]));
  const merged = new Map();

  (previousSchedule?.schedule || []).forEach((task) => {
    const fixedSegments = task.segments.filter((segment) => new Date(segment.start) < cutoff);
    if (!fixedSegments.length) {
      return;
    }

    merged.set(task.id, {
      id: task.id,
      title: task.title,
      estimateMinutes: taskMap.get(task.id)?.estimateMinutes ?? task.estimateMinutes,
      dueDate: taskMap.get(task.id)?.dueDate ?? task.dueDate,
      priority: taskMap.get(task.id)?.priority ?? task.priority,
      cognitiveLoad: taskMap.get(task.id)?.cognitiveLoad ?? task.cognitiveLoad,
      segments: fixedSegments
    });
  });

  (nextSchedule.schedule || []).forEach((task) => {
    const current = merged.get(task.id);
    if (current) {
      current.estimateMinutes = taskMap.get(task.id)?.estimateMinutes ?? task.estimateMinutes;
      current.dueDate = taskMap.get(task.id)?.dueDate ?? task.dueDate;
      current.priority = taskMap.get(task.id)?.priority ?? task.priority;
      current.cognitiveLoad = taskMap.get(task.id)?.cognitiveLoad ?? task.cognitiveLoad;
      current.segments = [...current.segments, ...task.segments].sort((a, b) => new Date(a.start) - new Date(b.start));
      return;
    }

    merged.set(task.id, {
      ...task,
      estimateMinutes: taskMap.get(task.id)?.estimateMinutes ?? task.estimateMinutes,
      dueDate: taskMap.get(task.id)?.dueDate ?? task.dueDate,
      priority: taskMap.get(task.id)?.priority ?? task.priority,
      cognitiveLoad: taskMap.get(task.id)?.cognitiveLoad ?? task.cognitiveLoad
    });
  });

  return {
    ...nextSchedule,
    schedule: Array.from(merged.values()).sort((a, b) => new Date(a.segments[0].start) - new Date(b.segments[0].start))
  };
}

function updateScheduleSummary(payload) {
  const summary = payload?.summary;
  if (!summary) {
    scheduledCountEl.textContent = '0';
    return;
  }

  scheduledCountEl.textContent = String(summary.scheduledCount || 0);
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
