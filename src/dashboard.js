const STORAGE_KEY = 'architectureLastSchedule';
const AVAILABILITY_KEY = 'architectureAvailability';
const TASKS_KEY = 'architectureTasks';
const Planner = window.ArchitecturePlanner;
const dateLabel = document.getElementById('current-date-label');
const timelineContainer = document.getElementById('timeline-container');
const timelineView = document.getElementById('timeline-view');
const calendarView = document.getElementById('calendar-view');
const timelineScrollArea = document.getElementById('timeline-view');
const currentTimeLine = document.getElementById('current-time-line');
const currentTimeLabel = document.getElementById('current-time-label');
const passedTimeOverlay = document.getElementById('passed-time-overlay');
const todayBlockedBlocks = document.getElementById('today-blocked-blocks');
const todayTaskBlocks = document.getElementById('today-task-blocks');
const pulseCards = document.getElementById('pulse-cards');
const queueList = document.getElementById('queue-list');
const calendarGrid = document.getElementById('calendar-grid');
const remainingHoursEl = document.getElementById('dashboard-remaining-hours');
const scheduledCountEl = document.getElementById('dashboard-scheduled-count');
const unscheduledCountEl = document.getElementById('dashboard-unscheduled-count');
const newCountEl = document.getElementById('dashboard-new-count');
const progressCountEl = document.getElementById('dashboard-progress-count');
const showTimelineBtn = document.getElementById('show-timeline');
const showCalendarBtn = document.getElementById('show-calendar');
const taskModal = document.getElementById('task-modal');
const taskModalTitle = document.getElementById('task-modal-title');
const openTaskModalBtn = document.getElementById('open-task-modal');
const closeTaskModalBtn = document.getElementById('close-task-modal');
const deleteTaskBtn = document.getElementById('delete-task');
const reviewModal = document.getElementById('review-modal');
const openReviewModalBtn = document.getElementById('open-review-modal');
const closeReviewModalBtn = document.getElementById('close-review-modal');
const reviewList = document.getElementById('review-list');
const reviewFeedback = document.getElementById('review-feedback');
const saveReviewBtn = document.getElementById('save-review');
const reviewBanner = document.getElementById('review-banner');
const dismissReviewBannerBtn = document.getElementById('dismiss-review-banner');
const triggerReviewBannerBtn = document.getElementById('trigger-review-banner');
const addTaskBtn = document.getElementById('dashboard-add-task');
const quickTaskTitle = document.getElementById('quick-task-title');
const quickTaskEstimate = document.getElementById('quick-task-estimate');
const quickTaskDue = document.getElementById('quick-task-due');
const quickTaskStatus = document.getElementById('quick-task-status');
const quickTaskPriority = document.getElementById('quick-task-priority');
const quickTaskCognitive = document.getElementById('quick-task-cognitive');
const quickAddFeedback = document.getElementById('quick-add-feedback');
let forceReviewBanner = false;
let activeTaskId = null;

const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
dateLabel.textContent = new Date().toLocaleDateString('en-US', dateOptions);
deleteTaskBtn.classList.add('hidden');

function readSchedule() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return Planner.normalizeAvailabilityWindow(JSON.parse(raw), (normalized) => {
      window.localStorage.setItem(AVAILABILITY_KEY, JSON.stringify(normalized));
    });
  } catch (error) {
    return null;
  }
}

function readAvailability() {
  const raw = window.localStorage.getItem(AVAILABILITY_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function readTasks() {
  const raw = window.localStorage.getItem(TASKS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    const cleaned = parsed.filter((task) => {
      if (task.status !== 'completed') {
        return true;
      }
      return parseDueDateStart(task.dueDate) >= new Date();
    });
    if (cleaned.length !== parsed.length) {
      writeTasks(cleaned);
    }
    return cleaned.map((task) => ({
      priority: 'medium',
      cognitiveLoad: 'medium',
      ...task
    }));
  } catch (error) {
    return [];
  }
}

function writeTasks(tasks) {
  window.localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function parseDueDateStart(dueDate) {
  return new Date(`${dueDate}T00:01:00`);
}

function formatDueDate(dueDate) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parseDueDateStart(dueDate));
}

function formatStatus(status) {
  return status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1);
}

function formatLevel(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

for (let hour = 6; hour <= 23; hour += 1) {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;

  const marker = document.createElement('div');
  marker.className = 'absolute -left-[64px] w-[52px] text-right text-[11px] font-semibold text-graphite/55';
  marker.style.top = `${(hour - 6) * 60 - 8}px`;
  marker.textContent = `${displayHour} ${ampm}`;
  timelineContainer.appendChild(marker);

  const line = document.createElement('div');
  line.className = 'timeline-tick';
  line.style.top = `${(hour - 6) * 60}px`;
  timelineContainer.appendChild(line);
}

function updateTimelineNow() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (hours >= 6 && hours <= 23) {
    const pxPos = (hours - 6) * 60 + minutes;
    currentTimeLine.style.top = `${pxPos}px`;
    currentTimeLine.style.display = 'flex';
    passedTimeOverlay.style.height = `${pxPos}px`;
    currentTimeLabel.textContent = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(now);

    if (!window.__timelineScrolled) {
      timelineScrollArea.scrollTop = Math.max(0, pxPos - 140);
      window.__timelineScrolled = true;
    }
  } else {
    currentTimeLine.style.display = 'none';
    passedTimeOverlay.style.height = hours > 23 ? '100%' : '0%';
  }
}

function sameDay(first, second) {
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

function formatRange(startIso, endIso) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  return `${formatter.format(new Date(startIso))} to ${formatter.format(new Date(endIso))}`;
}

function flattenScheduled(schedule) {
  return schedule.flatMap((task) =>
    task.segments.map((segment) => ({
      taskId: task.id,
      title: task.title,
      dueDate: task.dueDate,
      estimateMinutes: task.estimateMinutes,
      ...segment
    }))
  );
}

function getTimeSlots() {
  return Planner.getTimeSlots();
}

function getNextHalfHour() {
  return Planner.getNextHalfHour();
}

function deriveAvailabilityBlocks() {
  const availability = readAvailability();
  if (!availability) {
    return { openBlocks: [], blockedBlocks: [], startMonday: getCalendarStartMonday() };
  }

  const routine = availability.routine || Array.from({ length: 7 }, () => ({}));
  const specific = availability.schedule14 || Array.from({ length: 14 }, () => ({}));
  const startMonday = availability.startMonday ? new Date(availability.startMonday) : getCalendarStartMonday();
  const slots = getTimeSlots();
  const openBlocks = [];
  const blockedBlocks = [];

  for (let dayIndex = 0; dayIndex < 14; dayIndex += 1) {
    const currentDate = new Date(startMonday);
    currentDate.setDate(startMonday.getDate() + dayIndex);
    currentDate.setHours(0, 0, 0, 0);

    let currentOpen = null;
    let currentBlocked = null;

    slots.forEach((slot, slotIndex) => {
      const routineBlocked = Boolean((routine[dayIndex % 7] || {})[slot]);
      const specificBlocked = Boolean((specific[dayIndex] || {})[slot]);
      const isBlocked = routineBlocked || specificBlocked;
      const isLastSlot = slotIndex === slots.length - 1;

      if (isBlocked) {
        if (!currentBlocked) {
          currentBlocked = slot;
        }
        if (currentOpen) {
          openBlocks.push({ start: toIsoDateTime(currentDate, currentOpen), end: toIsoDateTime(currentDate, slot) });
          currentOpen = null;
        }
      } else {
        if (!currentOpen) {
          currentOpen = slot;
        }
        if (currentBlocked) {
          blockedBlocks.push({ start: toIsoDateTime(currentDate, currentBlocked), end: toIsoDateTime(currentDate, slot) });
          currentBlocked = null;
        }
      }

      if (isLastSlot) {
        const endIso = addThirtyMinutes(currentDate, slot);
        if (currentOpen) {
          openBlocks.push({ start: toIsoDateTime(currentDate, currentOpen), end: endIso });
          currentOpen = null;
        }
        if (currentBlocked) {
          blockedBlocks.push({ start: toIsoDateTime(currentDate, currentBlocked), end: endIso });
          currentBlocked = null;
        }
      }
    });
  }

  return {
    openBlocks: trimBlocksToFuture(openBlocks),
    blockedBlocks,
    startMonday
  };
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

function openTaskEditor(task = null) {
  activeTaskId = task?.id || null;
  taskModalTitle.textContent = activeTaskId ? 'Edit Task' : 'Add Task';
  quickTaskTitle.value = task?.title || '';
  quickTaskEstimate.value = String(task?.estimateMinutes || 60);
  quickTaskDue.value = task?.dueDate || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  quickTaskStatus.value = task?.status || 'new';
  quickTaskPriority.value = task?.priority || 'medium';
  quickTaskCognitive.value = task?.cognitiveLoad || 'medium';
  quickAddFeedback.textContent = '';
  deleteTaskBtn.classList.toggle('hidden', !activeTaskId);
  taskModal.classList.remove('hidden');
  taskModal.classList.add('flex');
}

function closeTaskEditor() {
  activeTaskId = null;
  taskModal.classList.add('hidden');
  taskModal.classList.remove('flex');
  quickAddFeedback.textContent = '';
}

function buildSchedulingTasks(taskList, previousSchedule, cutoff) {
  return Planner.buildSchedulingTasks(taskList, previousSchedule, cutoff);
}

function mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff) {
  return Planner.mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff);
}

async function syncSchedule(taskList) {
  const timeBlocks = deriveAvailabilityBlocks().openBlocks;
  const previousSchedule = readSchedule();
  const cutoff = getNextHalfHour();
  const fixedSegments = (previousSchedule?.schedule || [])
    .flatMap((task) => task.segments)
    .filter((segment) => new Date(segment.start) < cutoff);
  const availableBlocks = subtractSegmentsFromBlocks(timeBlocks, fixedSegments);
  const schedulableTasks = buildSchedulingTasks(taskList, previousSchedule, cutoff);

  if (!availableBlocks.length) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergeScheduleHistory(previousSchedule, { summary: null, schedule: [], unscheduled: [] }, taskList, cutoff)));
    return;
  }

  if (!schedulableTasks.length) {
    const mergedSchedule = mergeScheduleHistory(previousSchedule, { summary: null, schedule: [], unscheduled: [] }, taskList, cutoff);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      summary: {
        timeBlockCount: availableBlocks.length,
        taskCount: 0,
        scheduledCount: mergedSchedule.schedule.length,
        unscheduledCount: 0,
        totalAvailableMinutes: availableBlocks.reduce(
          (sum, block) => sum + (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60000,
          0
        ),
        totalPlannedMinutes: 0
      },
      schedule: mergedSchedule.schedule,
      unscheduled: []
    }));
    return;
  }

  const response = await fetch('http://127.0.0.1:5050/api/schedule', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      timeBlocks: availableBlocks,
      tasks: schedulableTasks
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Unable to update the schedule.');
  }

  const mergedSchedule = mergeScheduleHistory(previousSchedule, payload, taskList, cutoff);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedSchedule));
}

function renderPulse(schedule, todaySegments) {
  if (!schedule) {
    pulseCards.innerHTML = `
      <div class="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
        <p class="text-sm text-cream/75">Generate a schedule on the task page to populate today and the queue.</p>
      </div>
    `;
    return;
  }

  const now = new Date();
  const currentSegment = todaySegments.find((segment) => new Date(segment.start) <= now && new Date(segment.end) >= now);
  const nextSegment = todaySegments.find((segment) => new Date(segment.start) > now);

  pulseCards.innerHTML = [currentSegment, nextSegment]
    .filter(Boolean)
    .map((segment, index) => `
      <div class="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
        <p class="text-xs uppercase tracking-[0.16em] text-clay">${index === 0 ? 'Now' : 'Next'}</p>
        <p class="mt-2 text-lg font-semibold">${segment.title}</p>
        <p class="mt-1 text-sm text-cream/70">${formatRange(segment.start, segment.end)}</p>
      </div>
    `)
    .join('') || `
      <div class="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
        <p class="text-sm text-cream/75">Nothing scheduled today yet.</p>
      </div>
    `;
}

function renderTodayTimeline(todaySegments) {
  const availability = deriveAvailabilityBlocks();
  const today = new Date();
  const todayBlocked = availability.blockedBlocks
    .filter((block) => sameDay(new Date(block.start), today))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  todayBlockedBlocks.innerHTML = '';
  todayBlocked.forEach((block) => {
    const start = new Date(block.start);
    const end = new Date(block.end);
    const top = (start.getHours() - 6) * 60 + start.getMinutes();
    const height = Math.max(18, (end.getTime() - start.getTime()) / 60000);
    const element = document.createElement('div');
    element.className = 'absolute left-4 right-4 z-[15] rounded-[1rem] border border-graphite/10 bg-graphite/10';
    element.style.top = `${top}px`;
    element.style.height = `${height}px`;
    todayBlockedBlocks.appendChild(element);
  });

  todayTaskBlocks.innerHTML = '';

  if (!todaySegments.length) {
    todayTaskBlocks.innerHTML = `
      <div class="absolute left-4 right-4 top-8 rounded-[1.25rem] border border-dashed border-graphite/15 bg-white/80 p-4 text-sm text-graphite/55">
        No tasks scheduled today.
      </div>
    `;
    return;
  }

  todaySegments.forEach((segment, index) => {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    const top = (start.getHours() - 6) * 60 + start.getMinutes();
    const height = Math.max(42, (end.getTime() - start.getTime()) / 60000);
    const colorClass = index % 2 === 0
      ? 'border-terracotta/10 bg-terracotta/15 text-[#8f3f29]'
      : 'border-olive/10 bg-olive/15 text-[#4d5a3e]';

    const block = document.createElement('div');
    block.className = `absolute left-4 right-4 z-20 rounded-[1.25rem] border p-3 shadow-sm ${colorClass}`;
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    block.innerHTML = `
      <p class="font-semibold">${segment.title}</p>
      <p class="mt-1 text-sm text-graphite/60">${formatRange(segment.start, segment.end)}</p>
    `;
    todayTaskBlocks.appendChild(block);
  });
}

function renderQueue(schedule, unscheduled, tasks) {
  if (!schedule && !unscheduled && !tasks.length) {
    queueList.innerHTML = `
      <article class="rounded-[1.5rem] border border-dashed border-graphite/12 bg-cream/75 p-5">
        <p class="text-sm italic text-graphite/55">Generate a schedule to populate the queue.</p>
      </article>
    `;
    return;
  }

  const scheduledCards = (schedule || []).map((task) => {
    const firstSegment = task.segments[0];
    const taskMeta = tasks.find((candidate) => candidate.id === task.id);
    return `
      <button class="block w-full rounded-[1.5rem] border border-graphite/10 bg-white p-5 text-left transition hover:border-terracotta/20" type="button" data-edit-task="${task.id}">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-lg font-semibold">${task.title}</h3>
          <span class="chip bg-olive/15 text-olive">${formatStatus(taskMeta?.status || 'new')}</span>
        </div>
        <p class="mt-3 text-sm text-graphite/60">${task.estimateMinutes} min | Due ${formatDueDate(task.dueDate)}</p>
        <p class="mt-1 text-sm text-graphite/50">${formatLevel(taskMeta?.priority || 'medium')} priority | ${formatLevel(taskMeta?.cognitiveLoad || 'medium')} load</p>
        <p class="mt-2 text-sm text-graphite/50">${formatRange(firstSegment.start, firstSegment.end)}</p>
        ${task.missingMinutes ? `<p class="mt-2 text-sm text-terracotta">${task.missingMinutes} min still needs space.</p>` : ''}
      </button>
    `;
  });

  const unscheduledCards = (unscheduled || []).map((task) => `
    <button class="block w-full rounded-[1.5rem] border border-red-200 bg-red-50 p-5 text-left transition hover:border-red-300" type="button" data-edit-task="${task.id}">
      <div class="flex items-start justify-between gap-3">
        <h3 class="text-lg font-semibold text-red-900">${task.title}</h3>
        <span class="chip bg-white text-red-700">New</span>
      </div>
      <p class="mt-3 text-sm text-red-800">Due ${formatDueDate(task.dueDate)}</p>
      <p class="mt-1 text-sm text-red-700">${formatLevel(task.priority || 'medium')} priority | ${formatLevel(task.cognitiveLoad || 'medium')} load</p>
      <p class="mt-2 text-sm text-red-700">${task.missingMinutes} minutes still need space.</p>
    </button>
  `);

  const completedCards = tasks
    .filter((task) => task.status === 'completed')
    .map((task) => `
      <button class="block w-full rounded-[1.5rem] border border-graphite/10 bg-cream p-5 text-left transition hover:border-graphite/20" type="button" data-edit-task="${task.id}">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-lg font-semibold">${task.title}</h3>
          <span class="chip bg-white text-graphite/60">Completed</span>
        </div>
        <p class="mt-3 text-sm text-graphite/60">Due ${formatDueDate(task.dueDate)}</p>
        <p class="mt-1 text-sm text-graphite/50">${formatLevel(task.priority || 'medium')} priority | ${formatLevel(task.cognitiveLoad || 'medium')} load</p>
      </button>
    `);

  queueList.innerHTML = [...scheduledCards, ...unscheduledCards, ...completedCards].join('');
}

function renderCalendar(schedule) {
  const segments = flattenScheduled(schedule || []);
  const grouped = new Map();
  const availability = deriveAvailabilityBlocks();
  const openByDay = new Map();
  const blockedByDay = new Map();

  segments.forEach((segment) => {
    const key = segment.start.slice(0, 10);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(segment);
  });

  availability.openBlocks.forEach((block) => {
    const key = block.start.slice(0, 10);
    openByDay.set(key, (openByDay.get(key) || 0) + (new Date(block.end) - new Date(block.start)) / 60000);
  });

  availability.blockedBlocks.forEach((block) => {
    const key = block.start.slice(0, 10);
    blockedByDay.set(key, (blockedByDay.get(key) || 0) + (new Date(block.end) - new Date(block.start)) / 60000);
  });

  const startMonday = availability.startMonday || getCalendarStartMonday();
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(startMonday);
    date.setDate(startMonday.getDate() + index);
    return date;
  });

  calendarGrid.innerHTML = days.map((date) => {
    const key = date.toISOString().slice(0, 10);
    const daySegments = (grouped.get(key) || []).sort((a, b) => new Date(a.start) - new Date(b.start));
    const availableHours = ((openByDay.get(key) || 0) / 60).toFixed((openByDay.get(key) || 0) % 60 === 0 ? 0 : 1);
    const blockedHours = ((blockedByDay.get(key) || 0) / 60).toFixed((blockedByDay.get(key) || 0) % 60 === 0 ? 0 : 1);
    return `
      <section class="rounded-[1.5rem] border border-graphite/10 bg-white p-4">
        <p class="text-xs uppercase tracking-[0.18em] text-olive">${new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date)}</p>
        <div class="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <span class="rounded-full bg-olive/12 px-3 py-1 text-olive">${availableHours}h open</span>
          <span class="rounded-full bg-graphite/8 px-3 py-1 text-graphite/65">${blockedHours}h blocked</span>
        </div>
        <div class="mt-3 space-y-3">
          ${daySegments.length
            ? daySegments.map((segment) => `
              <div class="rounded-2xl bg-cream px-4 py-3">
                <p class="font-semibold">${segment.title}</p>
                <p class="mt-1 text-sm text-graphite/60">${formatRange(segment.start, segment.end)}</p>
              </div>
            `).join('')
            : '<div class="rounded-2xl bg-cream/70 px-4 py-3 text-sm text-graphite/50">No tasks</div>'}
        </div>
      </section>
    `;
  }).join('');
}

function getCalendarStartMonday() {
  return Planner.getCurrentMonday();
}

function renderDashboard() {
  const scheduleData = readSchedule();
  const tasks = readTasks();
  const availability = deriveAvailabilityBlocks();
  const today = new Date();
  const scheduled = scheduleData?.schedule || [];
  const unscheduled = scheduleData?.unscheduled || [];
  const flatSegments = flattenScheduled(scheduled);
  const todaySegments = flatSegments
    .filter((segment) => sameDay(new Date(segment.start), today))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const todayMinutes = todaySegments.reduce(
    (sum, segment) => sum + (new Date(segment.end).getTime() - new Date(segment.start).getTime()) / 60000,
    0
  );
  const remainingMinutes = availability.openBlocks.reduce(
    (sum, block) => sum + (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60000,
    0
  );

  remainingHoursEl.textContent = `${(remainingMinutes / 60).toFixed(remainingMinutes % 60 === 0 ? 0 : 1)}h`;
  scheduledCountEl.textContent = String(scheduled.length);
  unscheduledCountEl.textContent = String(unscheduled.length);
  newCountEl.textContent = String(tasks.filter((task) => task.status === 'new').length);
  progressCountEl.textContent = String(tasks.filter((task) => task.status === 'in_progress').length);

  renderPulse(scheduleData, todaySegments);
  renderTodayTimeline(todaySegments);
  renderQueue(scheduled, unscheduled, tasks);
  renderCalendar(scheduled);
  updateReviewBanner(todaySegments.length);
}

function updateReviewBanner(hasTodayWork) {
  const dismissed = window.sessionStorage.getItem('architectureReviewBannerDismissed') === 'true';
  const shouldShow = forceReviewBanner || ((new Date().getHours() >= 20) && hasTodayWork && !dismissed);
  reviewBanner.classList.toggle('hidden', !shouldShow);
}

function renderReviewList() {
  const scheduleData = readSchedule();
  const tasks = readTasks();
  const today = new Date();
  const todaySegments = flattenScheduled(scheduleData?.schedule || [])
    .filter((segment) => sameDay(new Date(segment.start), today))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const grouped = new Map();
  todaySegments.forEach((segment) => {
    if (!grouped.has(segment.taskId)) {
      grouped.set(segment.taskId, []);
    }
    grouped.get(segment.taskId).push(segment);
  });

  if (!grouped.size) {
    reviewList.innerHTML = `
      <div class="rounded-[1.5rem] border border-dashed border-graphite/12 bg-cream/75 p-5 text-sm text-graphite/55">
        No tasks scheduled today.
      </div>
    `;
    return;
  }

  reviewList.innerHTML = Array.from(grouped.entries()).map(([taskId, segments]) => {
    const task = tasks.find((item) => item.id === taskId) || { title: segments[0].title, estimateMinutes: segments.reduce((sum, segment) => sum + segment.allocatedMinutes, 0), dueDate: segments[0].dueDate, status: 'new', priority: 'medium', cognitiveLoad: 'medium', notes: '' };
    const actualMinutes = segments.reduce((sum, segment) => sum + Number(segment.allocatedMinutes || 0), 0);
    const projectedRemaining = Math.max(0, Number(task.estimateMinutes) - actualMinutes);
    const autoProgress = task.status === 'new';
    const autoComplete = projectedRemaining === 0;
    const reviewStatus = autoComplete ? 'completed' : (autoProgress ? 'in_progress' : task.status);

    return `
      <article class="rounded-[1.5rem] border border-graphite/10 bg-white p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-xl font-semibold">${task.title}</h3>
            <p class="mt-1 text-sm text-graphite/55">${actualMinutes} min scheduled today | Due ${formatDueDate(task.dueDate)}</p>
          </div>
          <span class="chip bg-cream text-graphite/70">${formatStatus(reviewStatus)}</span>
        </div>
        ${autoComplete ? `
          <div class="mt-4 rounded-[1.25rem] border border-olive/20 bg-olive/10 px-4 py-3 text-sm text-[#4d5a3e]">
            Task fulfilled required time, moved to <strong>Completed</strong>.
          </div>
        ` : (autoProgress ? `
          <div class="mt-4 rounded-[1.25rem] border border-terracotta/20 bg-terracotta/10 px-4 py-3 text-sm text-[#8f3f29]">
            Marked as <strong>In Progress</strong> for today because it was scheduled. You can switch it back before saving.
          </div>
        ` : '')}
        <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label class="text-sm font-semibold text-graphite/80">
            Extra Time
            <input class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta" type="number" min="0" step="15" value="0" data-review-id="${taskId}" data-field="extraMinutes" />
          </label>
          <label class="text-sm font-semibold text-graphite/80">
            Status
            <select class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta ${autoComplete ? 'ring-2 ring-olive/25' : (autoProgress ? 'ring-2 ring-terracotta/25' : '')}" data-review-id="${taskId}" data-field="status" data-auto-progress="${autoProgress ? 'true' : 'false'}">
              <option value="new" ${reviewStatus === 'new' ? 'selected' : ''}>New</option>
              <option value="in_progress" ${reviewStatus === 'in_progress' ? 'selected' : ''}>In Progress</option>
              <option value="completed" ${reviewStatus === 'completed' ? 'selected' : ''}>Completed</option>
            </select>
          </label>
          <label class="text-sm font-semibold text-graphite/80">
            Priority
            <select class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta" data-review-id="${taskId}" data-field="priority">
              <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
            </select>
          </label>
          <label class="text-sm font-semibold text-graphite/80">
            Cognitive Load
            <select class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta" data-review-id="${taskId}" data-field="cognitiveLoad">
              <option value="high" ${task.cognitiveLoad === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${task.cognitiveLoad === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${task.cognitiveLoad === 'low' ? 'selected' : ''}>Low</option>
            </select>
          </label>
        </div>
        <label class="mt-4 block text-sm font-semibold text-graphite/80">
          Review Notes
          <textarea class="mt-2 min-h-24 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta" data-review-id="${taskId}" data-field="notes">${task.notes || ''}</textarea>
        </label>
      </article>
    `;
  }).join('');
}

addTaskBtn.addEventListener('click', async () => {
  const title = quickTaskTitle.value.trim();
  const dueDate = quickTaskDue.value;
  const estimate = Number(quickTaskEstimate.value);
  const status = quickTaskStatus.value;
  const priority = quickTaskPriority.value;
  const cognitiveLoad = quickTaskCognitive.value;

  if (!title || !dueDate || !estimate) {
    quickAddFeedback.textContent = 'Add a title, estimate, and due date.';
    return;
  }

  const tasks = readTasks();
  const nextTask = {
    id: activeTaskId || crypto.randomUUID(),
    title,
    estimateMinutes: estimate,
    dueDate,
    status,
    priority,
    cognitiveLoad
  };

  const nextTasks = activeTaskId
    ? tasks.map((task) => (task.id === activeTaskId ? { ...task, ...nextTask } : task))
    : [...tasks, nextTask];

  writeTasks(nextTasks);

  try {
    await syncSchedule(nextTasks);
    closeTaskEditor();
    renderDashboard();
  } catch (error) {
    quickAddFeedback.textContent = error.message;
  }
});

quickTaskDue.value = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
openTaskModalBtn.addEventListener('click', () => {
  openTaskEditor();
});
closeTaskModalBtn.addEventListener('click', () => {
  closeTaskEditor();
});
taskModal.addEventListener('click', (event) => {
  if (event.target === taskModal) {
    closeTaskEditor();
  }
});
deleteTaskBtn.addEventListener('click', async () => {
  if (!activeTaskId) {
    return;
  }

  const nextTasks = readTasks().filter((task) => task.id !== activeTaskId);
  writeTasks(nextTasks);

  try {
    await syncSchedule(nextTasks);
    closeTaskEditor();
    renderDashboard();
  } catch (error) {
    quickAddFeedback.textContent = error.message;
  }
});
queueList.addEventListener('click', (event) => {
  const editTarget = event.target.closest('[data-edit-task]');
  if (!editTarget) {
    return;
  }

  const task = readTasks().find((item) => item.id === editTarget.dataset.editTask);
  if (task) {
    openTaskEditor(task);
  }
});
openReviewModalBtn.addEventListener('click', () => {
  renderReviewList();
  reviewModal.classList.remove('hidden');
  reviewModal.classList.add('flex');
});
closeReviewModalBtn.addEventListener('click', () => {
  reviewModal.classList.add('hidden');
  reviewModal.classList.remove('flex');
});
reviewModal.addEventListener('click', (event) => {
  if (event.target === reviewModal) {
    reviewModal.classList.add('hidden');
    reviewModal.classList.remove('flex');
  }
});
saveReviewBtn.addEventListener('click', async () => {
  const tasks = readTasks();
  const inputs = reviewModal.querySelectorAll('[data-review-id]');
  const updates = new Map();
  const scheduleData = readSchedule();
  const today = new Date();
  const actualMinutesByTask = new Map();

  flattenScheduled(scheduleData?.schedule || [])
    .filter((segment) => sameDay(new Date(segment.start), today))
    .forEach((segment) => {
      actualMinutesByTask.set(
        segment.taskId,
        (actualMinutesByTask.get(segment.taskId) || 0) + Number(segment.allocatedMinutes || 0)
      );
    });

  inputs.forEach((input) => {
    const taskId = input.dataset.reviewId;
    const field = input.dataset.field;
    if (!updates.has(taskId)) {
      updates.set(taskId, {});
    }
    updates.get(taskId)[field] = field === 'estimateMinutes' ? Number(input.value) : input.value;
  });

  const nextTasks = tasks.map((task) => (
    updates.has(task.id)
      ? (() => {
          const update = updates.get(task.id);
          const actualMinutes = actualMinutesByTask.get(task.id) || 0;
          const nextEstimate = Math.max(0, Number(task.estimateMinutes) - actualMinutes + Number(update.extraMinutes || 0));

          return {
            ...task,
            ...update,
            estimateMinutes: nextEstimate,
            status: update.status || task.status
          };
        })()
      : task
  ));

  const cleanedTasks = nextTasks.map((task) => {
    const copy = { ...task };
    delete copy.extraMinutes;
    return copy;
  });
  writeTasks(cleanedTasks);
  try {
    await syncSchedule(cleanedTasks);
  } catch (error) {
    reviewFeedback.textContent = error.message;
    return;
  }
  reviewFeedback.textContent = 'Day review saved.';
  window.sessionStorage.setItem('architectureReviewBannerDismissed', 'true');
  forceReviewBanner = false;
  reviewModal.classList.add('hidden');
  reviewModal.classList.remove('flex');
  reviewBanner.classList.add('hidden');
  renderDashboard();
});
dismissReviewBannerBtn.addEventListener('click', () => {
  window.sessionStorage.setItem('architectureReviewBannerDismissed', 'true');
  forceReviewBanner = false;
  reviewBanner.classList.add('hidden');
});
triggerReviewBannerBtn.addEventListener('click', () => {
  forceReviewBanner = true;
  window.sessionStorage.removeItem('architectureReviewBannerDismissed');
  renderDashboard();
});

showTimelineBtn.addEventListener('click', () => {
  timelineView.classList.remove('hidden');
  calendarView.classList.add('hidden');
  showTimelineBtn.className = 'rounded-full bg-white px-4 py-2 text-sm font-bold text-graphite shadow';
  showCalendarBtn.className = 'rounded-full px-4 py-2 text-sm font-bold text-graphite/60 transition hover:bg-white/50';
});

showCalendarBtn.addEventListener('click', () => {
  calendarView.classList.remove('hidden');
  timelineView.classList.add('hidden');
  showCalendarBtn.className = 'rounded-full bg-white px-4 py-2 text-sm font-bold text-graphite shadow';
  showTimelineBtn.className = 'rounded-full px-4 py-2 text-sm font-bold text-graphite/60 transition hover:bg-white/50';
});

window.setInterval(updateTimelineNow, 60000);
updateTimelineNow();
renderDashboard();
