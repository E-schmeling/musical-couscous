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
const dashboardScheduleHealthEl = document.getElementById('dashboard-schedule-health');
const dashboardDeveloperToolsEl = document.getElementById('dashboard-developer-tools');
const dashboardSolverMetaEl = document.getElementById('dashboard-solver-meta');
const showTimelineBtn = document.getElementById('show-timeline');
const showCalendarBtn = document.getElementById('show-calendar');
const timelineDayLabel = document.getElementById('timeline-day-label');
const timelinePrevDayBtn = document.getElementById('timeline-prev-day');
const timelineTodayBtn = document.getElementById('timeline-today');
const timelineNextDayBtn = document.getElementById('timeline-next-day');
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
const dashboardSpecificWindowsReminder = document.getElementById('dashboard-specific-windows-reminder');
const dashboardSpecificWindowsReminderText = document.getElementById('dashboard-specific-windows-reminder-text');
const dismissDashboardSpecificWindowsReminderBtn = document.getElementById('dismiss-dashboard-specific-windows-reminder');
const SPECIFIC_WINDOWS_REMINDER_DISMISSED_KEY = 'architectureSpecificWindowsReminderDismissedSession';
const addTaskBtn = document.getElementById('dashboard-add-task');
const quickTaskTitle = document.getElementById('quick-task-title');
const quickTaskEstimate = document.getElementById('quick-task-estimate');
const quickTaskDue = document.getElementById('quick-task-due');
const quickTaskStatus = document.getElementById('quick-task-status');
const quickTaskPriority = document.getElementById('quick-task-priority');
const quickTaskCognitive = document.getElementById('quick-task-cognitive');
const quickAddFeedback = document.getElementById('quick-add-feedback');
const queueLoadAllBtn = document.getElementById('queue-load-all');
const unscheduledSection = document.getElementById('unscheduled-section');
const unscheduledBadge = document.getElementById('unscheduled-badge');
const unscheduledList = document.getElementById('unscheduled-list');
let forceReviewBanner = false;
let activeTaskId = null;
let selectedTimelineDate = createDayStart(new Date());
let dashboardTaskActionError = '';
let showAllQueueItems = false;

const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
dateLabel.textContent = new Date().toLocaleDateString('en-US', dateOptions);
deleteTaskBtn.classList.add('hidden');

/**
 * Returns a new Date object set to midnight (00:00:00.000) on the same day as the input.
 *
 * Used throughout the dashboard to normalize dates for same-day comparisons
 * without time component interference.
 *
 * @param {Date} input - The date to normalize.
 * @returns {Date} A new Date object at midnight on the same calendar day.
 */
function createDayStart(input) {
  const next = new Date(input);
  next.setHours(0, 0, 0, 0);
  return next;
}

/**
 * Returns true if two Date objects fall on the same calendar day.
 *
 * Compares year, month, and date independently, ignoring time components.
 *
 * @param {Date} first - The first date.
 * @param {Date} second - The second date.
 * @returns {boolean} True if both dates share the same year, month, and day.
 */
function isSameDayValue(first, second) {
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

/**
 * Returns the start and end bounds of the current 14-day availability window.
 *
 * The window begins on the stored availability start Monday (or the current Monday
 * if not set) and ends 13 days later.
 *
 * @returns {{ start: Date, end: Date }} The first and last valid dates for timeline navigation.
 */
function getTimelineBounds() {
  const availability = deriveAvailabilityBlocks();
  const start = createDayStart(availability.startMonday || Planner.getCurrentMonday());
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  end.setHours(0, 0, 0, 0);
  return { start, end };
}

/**
 * Clamps a date to within the current 14-day availability window.
 *
 * Returns the start bound if the date is before the window, the end bound
 * if it is after, or the date itself if it falls within.
 *
 * @param {Date} date - The date to clamp.
 * @returns {Date} The clamped date within the availability window.
 */
function clampTimelineDate(date) {
  const { start, end } = getTimelineBounds();
  if (date < start) {
    return start;
  }
  if (date > end) {
    return end;
  }
  return date;
}

/**
 * Updates the timeline day label to reflect the currently selected date.
 *
 * Shows 'Timeline: Today' if the selected date is today, or a formatted
 * short date string (e.g. 'Timeline: Mon, Jun 3') otherwise.
 */
function updateTimelineDayLabel() {
  const today = createDayStart(new Date());
  const isToday = isSameDayValue(selectedTimelineDate, today);
  const formatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(selectedTimelineDate);
  timelineDayLabel.textContent = `Timeline: ${isToday ? 'Today' : formatted}`;
}

/**
 * Reads and parses the last generated schedule from localStorage.
 *
 * Also normalizes the availability window if the stored schedule contains
 * availability data that has drifted. Returns null if nothing is stored
 * or if parsing fails.
 *
 * @returns {Object|null} The parsed schedule object, or null if unavailable.
 */
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

/**
 * Reads and parses the availability object from localStorage.
 *
 * Returns null if nothing is stored or if parsing fails.
 *
 * @returns {Object|null} The raw availability object, or null if unavailable.
 */
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

/**
 * Reads, parses, and cleans the task list from localStorage.
 *
 * Filters out completed tasks whose due date has passed, writes the cleaned
 * list back to storage if any were removed, and applies default values for
 * optional fields. Returns an empty array if nothing is stored or parsing fails.
 *
 * @returns {Array<Object>} The cleaned and normalized task list.
 */
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

/**
 * Persists a task list to localStorage under the tasks key.
 *
 * @param {Array<Object>} tasks - The task list to save.
 */
function writeTasks(tasks) {
  window.localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
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
 * Formats a due date string into a short localized display string (e.g. 'Jun 3').
 *
 * @param {string} dueDate - An ISO date string in YYYY-MM-DD format.
 * @returns {string} A short month-and-day string using the browser locale.
 */
function formatDueDate(dueDate) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parseDueDateStart(dueDate));
}

/**
 * Formats a task status value into a human-readable label.
 *
 * Converts 'in_progress' to 'In Progress' and capitalizes the first letter
 * of any other status value.
 *
 * @param {string} status - A task status string ('new', 'in_progress', or 'completed').
 * @returns {string} A display-ready status label.
 */
function formatStatus(status) {
  return status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1);
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
 * Escapes HTML special characters in a string to prevent XSS injection.
 *
 * Replaces &, <, >, ", and ' with their HTML entity equivalents. Used when
 * inserting user-provided content directly into innerHTML.
 *
 * @param {*} value - The value to escape (will be coerced to a string).
 * @returns {string} The escaped string safe for use in HTML contexts.
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderUnscheduledReason(task) {
  if (!task.unscheduledReason) {
    return '';
  }
  return `<p class="mt-2 text-sm text-red-900">${escapeHtml(task.unscheduledReason)}</p>`;
}

/**
 * Escapes HTML special characters in a string to prevent XSS injection.
 *
 * Replaces &, <, >, ", and ' with their HTML entity equivalents. Used when
 * inserting user-provided content directly into innerHTML.
 *
 * @param {*} value - The value to escape (will be coerced to a string).
 * @returns {string} The escaped string safe for use in HTML contexts.
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Returns an HTML string showing the unscheduled reason for a task, or an empty string.
 *
 * Only renders if the task has an unscheduledReason field. The reason text is
 * HTML-escaped before insertion.
 *
 * @param {Object} task - A task object that may contain an unscheduledReason field.
 * @returns {string} An HTML paragraph string, or '' if no reason is present.
 */
function renderUnscheduledReason(task) {
  if (!task.unscheduledReason) {
    return '';
  }
  return `<p class="mt-2 text-sm text-red-900">${escapeHtml(task.unscheduledReason)}</p>`;
}

/**
 * Updates the dashboard schedule health banner with the appropriate message and tone.
 *
 * If a task action error is active (e.g. a failed schedule refresh after editing),
 * that error takes priority over the normal health message. Supports 'warning',
 * 'success', and neutral tones via CSS class swapping.
 *
 * @param {Object|null} scheduleData - The current schedule payload, or null if unavailable.
 */
function renderScheduleHealth(scheduleData) {
  if (dashboardTaskActionError) {
    dashboardScheduleHealthEl.textContent = dashboardTaskActionError;
    dashboardScheduleHealthEl.classList.remove(
      'hidden',
      'border-red-200/40',
      'bg-red-50/10',
      'text-red-100',
      'border-olive/20',
      'bg-olive/10',
      'text-cream',
      'border-white/10',
      'bg-white/5',
      'text-cream/75'
    );
    dashboardScheduleHealthEl.classList.add('border-red-200/40', 'bg-red-50/10', 'text-red-100');
    return;
  }

  const health = Planner.getScheduleHealthMessage(scheduleData);
  dashboardScheduleHealthEl.textContent = health.message;
  dashboardScheduleHealthEl.classList.remove(
    'hidden',
    'border-red-200/40',
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
    dashboardScheduleHealthEl.classList.add('border-red-200/40', 'bg-red-50/10', 'text-red-100');
    return;
  }
  if (health.tone === 'success') {
    dashboardScheduleHealthEl.classList.add('border-olive/20', 'bg-olive/10', 'text-cream');
    return;
  }

  dashboardScheduleHealthEl.classList.add('border-white/10', 'bg-white/5', 'text-cream/75');
}

/**
 * Shows or hides the specific-windows reminder banner based on availability state.
 *
 * The banner reminds users to add week-specific overrides when their routine
 * template may not reflect upcoming days accurately. It is suppressed for the
 * session once dismissed, and the dismissal flag is cleared when there are
 * no more reminders to show.
 */
function updateSpecificWindowsReminder() {
  const availability = readAvailability();
  const reminders = Planner.getSpecificWindowsReminderMessages(availability);

  if (!reminders.length || window.sessionStorage.getItem(SPECIFIC_WINDOWS_REMINDER_DISMISSED_KEY) === 'true') {
    dashboardSpecificWindowsReminder.classList.add('hidden');
    if (!reminders.length) {
      window.sessionStorage.removeItem(SPECIFIC_WINDOWS_REMINDER_DISMISSED_KEY);
    }
    return;
  }

  dashboardSpecificWindowsReminderText.textContent = `${reminders.join(' ')} Add week-specific overrides if those days differ from the routine template.`;
  dashboardSpecificWindowsReminder.classList.remove('hidden');
}

// Build hour markers and tick lines for the timeline view (6 AM to 11 PM)
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

/**
 * Updates the current-time indicator line and passed-time overlay on the timeline.
 *
 * Only renders the indicator when viewing today's timeline and the current hour
 * falls within the visible range (6 AM to 11 PM). Also auto-scrolls the timeline
 * to the current time on first render. Hides the indicator when viewing other days.
 */
function updateTimelineNow() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const isViewingToday = isSameDayValue(selectedTimelineDate, createDayStart(now));

  if (!isViewingToday) {
    currentTimeLine.style.display = 'none';
    passedTimeOverlay.style.height = '0%';
    window.__timelineScrolled = false;
    return;
  }

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

/**
 * Alias for isSameDayValue — returns true if two dates fall on the same calendar day.
 *
 * @param {Date} first - The first date.
 * @param {Date} second - The second date.
 * @returns {boolean} True if both dates share the same year, month, and day.
 */
function sameDay(first, second) {
  return isSameDayValue(first, second);
}

/**
 * Formats a start and end ISO datetime string into a human-readable time range.
 *
 * Example output: '9:00 AM to 10:30 AM'
 *
 * @param {string} startIso - ISO 8601 datetime string for the range start.
 * @param {string} endIso - ISO 8601 datetime string for the range end.
 * @returns {string} A formatted time range string using the browser locale.
 */
function formatRange(startIso, endIso) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  return `${formatter.format(new Date(startIso))} to ${formatter.format(new Date(endIso))}`;
}

/**
 * Formats a scheduled segment's start and end into a full date-and-time range string.
 *
 * Includes weekday, month, day, and time for the start, and only time for the end.
 * Example output: 'Mon, Jun 3 at 9:00 AM to 10:30 AM'
 *
 * @param {{ start: string, end: string }} segment - A segment object with ISO datetime strings.
 * @returns {string} A formatted date-and-time range string.
 */
function formatQueueTime(segment) {
  const start = new Date(segment.start);
  return `${new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(start)} to ${new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(segment.end))}`;
}

/**
 * Formats a scheduled segment's start and end into a full date-and-time range string.
 *
 * Includes weekday, month, day, and time for the start, and only time for the end.
 * Example output: 'Mon, Jun 3 at 9:00 AM to 10:30 AM'
 *
 * @param {{ start: string, end: string }} segment - A segment object with ISO datetime strings.
 * @returns {string} A formatted date-and-time range string.
 */
function formatQueueTime(segment) {
  const start = new Date(segment.start);
  return `${new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(start)} to ${new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(segment.end))}`;
}

/**
 * Flattens a schedule array into a single list of segments with task metadata attached.
 *
 * Each segment is augmented with taskId, title, dueDate, and estimateMinutes from
 * its parent task, making it self-contained for rendering without repeated lookups.
 *
 * @param {Array<Object>} schedule - The schedule array where each item has an id, title,
 *   dueDate, estimateMinutes, and segments array.
 * @returns {Array<Object>} A flat array of segment objects with task metadata merged in.
 */
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

/**
 * Returns an array of time slot strings for the full day range.
 *
 * Delegates to the shared Planner utility with no hour arguments,
 * using the Planner's default start and end hours.
 *
 * @returns {Array<string>} An array of time slot strings (e.g. ['06:00', '06:30', ...]).
 */
function getTimeSlots() {
  return Planner.getTimeSlots();
}

/**
 * Returns the next half-hour boundary from the current time.
 *
 * Delegates to the shared Planner utility.
 *
 * @returns {Date} A Date snapped to the next :00 or :30 minute mark.
 */
function getNextHalfHour() {
  return Planner.getNextHalfHour();
}

/**
 * Derives open and blocked time block arrays from stored availability data.
 *
 * Combines the routine weekly template with 14-day specific overrides to
 * produce separate lists of open and blocked blocks. Open blocks are trimmed
 * to start from the current time. Returns empty arrays and a default start
 * Monday if no availability is stored.
 *
 * @returns {{ openBlocks: Array<Object>, blockedBlocks: Array<Object>, startMonday: Date }}
 *   Object containing the open blocks (future only), all blocked blocks, and the
 *   window start date.
 */
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

/**
 * Removes time blocks that fall entirely in the past.
 *
 * Delegates to the shared Planner utility.
 *
 * @param {Array<Object>} blocks - Array of time block objects to filter.
 * @returns {Array<Object>} Blocks with fully past entries removed.
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
 * Returns an ISO 8601 datetime string 30 minutes after a given date and time slot.
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
 * Opens the task editor modal pre-filled with the given task's data, or blank for a new task.
 *
 * Sets the modal title, populates all form fields, controls delete button visibility,
 * and clears any previous feedback text.
 *
 * @param {Object|null} task - The task to edit, or null to open the modal for a new task.
 */
function openTaskEditor(task = null) {
  activeTaskId = task?.id || null;
  ensureStatusOptions(quickTaskStatus, Boolean(task));
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

/**
 * Closes the task editor modal and resets the active task ID and feedback text.
 */
function closeTaskEditor() {
  activeTaskId = null;
  taskModal.classList.add('hidden');
  taskModal.classList.remove('flex');
  quickAddFeedback.textContent = '';
}

/**
 * Ensures the 'Completed' option is present or absent in a status select element.
 *
 * Used to prevent new tasks from being created with a completed status while
 * allowing existing tasks to be set to completed during editing.
 *
 * @param {HTMLSelectElement} selectEl - The status dropdown element to modify.
 * @param {boolean} includeCompleted - If true, adds the 'Completed' option if missing.
 *   If false, removes it and resets the value to 'new' if currently 'completed'.
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
 * Shows or hides the developer tools cluster by toggling CSS classes.
 *
 * @param {boolean} isVisible - If true, shows the developer tools; if false, hides them.
 */
function setDeveloperVisibility(isVisible) {
  dashboardDeveloperToolsEl.classList.toggle('hidden', !isVisible);
  dashboardDeveloperToolsEl.classList.toggle('flex', isVisible);
}

/**
 * Filters and formats the task list for submission to the backend scheduler.
 *
 * Delegates to the shared Planner utility.
 *
 * @param {Array<Object>} taskList - The full list of task objects.
 * @param {Object|null} previousSchedule - The last saved schedule.
 * @param {Date} cutoff - The scheduling cutoff time.
 * @returns {Array<Object>} Tasks formatted for the backend API request.
 */
function buildSchedulingTasks(taskList, previousSchedule, cutoff) {
  return Planner.buildSchedulingTasks(taskList, previousSchedule, cutoff);
}

/**
 * Merges a new backend schedule result with the preserved history from the previous schedule.
 *
 * Delegates to the shared Planner utility, passing current open availability blocks.
 *
 * @param {Object|null} previousSchedule - The last saved schedule object.
 * @param {Object} nextSchedule - The new schedule result from the backend.
 * @param {Array<Object>} taskList - The current full task list.
 * @param {Date} cutoff - The scheduling cutoff time.
 * @returns {Object} A merged schedule object ready to be saved and rendered.
 */
function mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff) {
  return Planner.mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff, deriveAvailabilityBlocks().openBlocks);
}

/**
 * Formats the solver name and elapsed time from a schedule into a short display string.
 *
 * Returns a fallback string if solver metadata is missing or incomplete.
 *
 * @param {Object|null} scheduleData - The schedule object containing meta.solver and meta.elapsedMs.
 * @returns {string} A formatted string like 'python-cp-sat 42.3 ms', or a fallback message.
 */
function formatSolverMeta(scheduleData) {
  const solver = scheduleData?.meta?.solver;
  const elapsedMs = scheduleData?.meta?.elapsedMs;
  if (!solver || typeof elapsedMs !== 'number') {
    return 'No solver timing yet';
  }
  return `${solver} ${elapsedMs.toFixed(elapsedMs < 10 ? 2 : 1)} ms`;
}

/**
 * Sends the current task list to the backend for scheduling and saves the result.
 *
 * Reads availability, derives free blocks, subtracts fixed segments, and posts
 * the schedulable tasks to the backend API. Merges the response with preserved
 * history and writes the result back to localStorage. Handles edge cases where
 * there are no available blocks or no schedulable tasks gracefully.
 *
 * @param {Array<Object>} taskList - The task list to use for this scheduling run.
 * @returns {Promise<void>}
 * @throws {Error} If the backend returns a non-OK response.
 */
async function syncSchedule(taskList) {
  const timeBlocks = deriveAvailabilityBlocks().openBlocks;
  const previousSchedule = readSchedule();
  const cutoff = getNextHalfHour();
  const fixedSegments = Planner.getFixedSegmentsBeforeCutoff(previousSchedule?.schedule || [], cutoff);
  const availableBlocks = subtractSegmentsFromBlocks(timeBlocks, fixedSegments);
  const schedulableTasks = buildSchedulingTasks(taskList, previousSchedule, cutoff);

  if (!availableBlocks.length) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Planner.mergeScheduleHistory(previousSchedule, { summary: null, schedule: [], unscheduled: [] }, taskList, cutoff, availableBlocks)));
    return;
  }

  if (!schedulableTasks.length) {
    const mergedSchedule = Planner.mergeScheduleHistory(previousSchedule, { summary: null, schedule: [], unscheduled: [] }, taskList, cutoff, availableBlocks);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedSchedule));
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

  const mergedSchedule = Planner.mergeScheduleHistory(previousSchedule, payload, taskList, cutoff, availableBlocks);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedSchedule));
}

/**
 * Saves a new task list, closes the task editor, re-renders the dashboard,
 * and triggers a background schedule sync.
 *
 * If the sync fails, stores the error message in dashboardTaskActionError so
 * the health banner can reflect the failure on the next render.
 *
 * @param {Array<Object>} nextTasks - The updated task list to save and sync.
 * @returns {Promise<void>}
 */
async function persistTasksAndRefresh(nextTasks) {
  writeTasks(nextTasks);
  closeTaskEditor();
  renderDashboard();

  try {
    await syncSchedule(nextTasks);
    dashboardTaskActionError = '';
    renderDashboard();
  } catch (error) {
    dashboardTaskActionError = `Task changes were saved, but schedule refresh failed: ${error.message}`;
    renderDashboard();
  }
}

/**
 * Saves a new task list, closes the task editor, re-renders the dashboard,
 * and triggers a background schedule sync.
 *
 * If the sync fails, stores the error message in dashboardTaskActionError so
 * the health banner can reflect the failure on the next render.
 *
 * @param {Array<Object>} nextTasks - The updated task list to save and sync.
 * @returns {Promise<void>}
 */
async function persistTasksAndRefresh(nextTasks) {
  writeTasks(nextTasks);
  closeTaskEditor();
  renderDashboard();

  try {
    await syncSchedule(nextTasks);
    dashboardTaskActionError = '';
    renderDashboard();
  } catch (error) {
    dashboardTaskActionError = `Task changes were saved, but schedule refresh failed: ${error.message}`;
    renderDashboard();
  }
}

/**
 * Renders the 'Now' and 'Next' pulse cards at the top of the dashboard.
 *
 * Shows the currently active and next upcoming scheduled segment for today.
 * Displays a placeholder message if no schedule exists or no segments are active.
 *
 * @param {Object|null} schedule - The current schedule object, or null if unavailable.
 * @param {Array<Object>} todaySegments - Flattened segments scheduled for today, sorted by start time.
 */
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

/**
 * Renders the day timeline view with task blocks and blocked-time overlays.
 *
 * Positions each task segment and blocked availability period as absolutely
 * positioned elements within the timeline container, using pixel offsets
 * calculated from the hour (6 AM = 0px, each hour = 60px).
 * Displays a placeholder if no segments are scheduled for the selected day.
 *
 * @param {Array<Object>} todaySegments - Flattened segments for the selected timeline day,
 *   sorted by start time. Each segment must have start and end ISO datetime strings.
 */
function renderTodayTimeline(todaySegments) {
  const availability = deriveAvailabilityBlocks();
  const selectedDate = createDayStart(selectedTimelineDate);
  const todayBlocked = availability.blockedBlocks
    .filter((block) => sameDay(new Date(block.start), selectedDate))
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
        No tasks scheduled for this day.
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

/**
 * Renders the upcoming task queue and incomplete/unscheduled task sections.
 *
 * The queue shows the next scheduled segment for each task that is not yet
 * completed or flagged as incomplete, limited to 5 items by default with a
 * 'Load All' button for overflow. Incomplete and unscheduled tasks are rendered
 * separately in a warning section with missing-minutes details.
 *
 * @param {Array<Object>|null} schedule - Scheduled task objects from the current schedule.
 * @param {Array<Object>|null} unscheduled - Unscheduled task objects from the current schedule.
 * @param {Array<Object>} tasks - The full current task list for status and metadata lookups.
 */
function renderQueue(schedule, unscheduled, tasks) {
  if (!schedule && !unscheduled && !tasks.length) {
    queueList.innerHTML = `
      <article class="rounded-[1.5rem] border border-dashed border-graphite/12 bg-cream/75 p-5">
        <p class="text-sm italic text-graphite/55">Generate a schedule to populate the queue.</p>
      </article>
    `;
    queueLoadAllBtn.classList.add('hidden');
    unscheduledSection.classList.add('hidden');
    unscheduledList.innerHTML = '';
    return;
  }

  const now = new Date();
  const queuedTasks = (schedule || [])
    .map((task) => {
      const taskMeta = tasks.find((candidate) => candidate.id === task.id);
      const nextSegment = task.segments
        .filter((segment) => new Date(segment.end) >= now)
        .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
      const isIncomplete = task.completionStatus === 'incomplete' || Number(task.missingMinutes || 0) > 0;

      if (!nextSegment || taskMeta?.status === 'completed' || isIncomplete) {
        return null;
      }

      return {
        task,
        taskMeta,
        nextSegment
      };
    })
    .filter(Boolean);

  const incompleteTasks = [
    ...(schedule || [])
      .filter((task) => task.completionStatus === 'incomplete' || Number(task.missingMinutes || 0) > 0)
      .map((task) => ({
        ...task,
        nextSegment: task.segments
          .filter((segment) => new Date(segment.end) >= now)
          .sort((a, b) => new Date(a.start) - new Date(b.start))[0] || null
      })),
    ...(unscheduled || []).map((task) => ({
      ...task,
      nextSegment: null
    }))
  ];

  const visibleQueuedTasks = showAllQueueItems ? queuedTasks : queuedTasks.slice(0, 5);
  const scheduledCards = visibleQueuedTasks.map(({ task, taskMeta, nextSegment }) => {
    return `
      <button class="block w-full rounded-[1.5rem] border border-graphite/10 bg-white p-5 text-left transition hover:border-terracotta/20" type="button" data-edit-task="${task.id}">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-lg font-semibold">${task.title}</h3>
          <span class="chip bg-olive/15 text-olive">${formatStatus(taskMeta?.status || 'new')}</span>
        </div>
        <p class="mt-3 text-sm text-graphite/60">${task.estimateMinutes} min | Due ${formatDueDate(task.dueDate)}</p>
        <p class="mt-1 text-sm text-graphite/50">${formatLevel(taskMeta?.priority || 'medium')} priority | ${formatLevel(taskMeta?.cognitiveLoad || 'medium')} load</p>
        <p class="mt-2 text-sm text-graphite/50">${formatQueueTime(nextSegment)}</p>
      </button>
    `;
  });

  const unscheduledCards = incompleteTasks.map((task) => `
    <button class="block w-full rounded-[1.5rem] border border-red-200 bg-red-50 p-5 text-left transition hover:border-red-300" type="button" data-edit-task="${task.id}">
      <div class="flex items-start justify-between gap-3">
        <h3 class="text-lg font-semibold text-red-900">${task.title}</h3>
        <span class="chip bg-white text-red-700">Incomplete</span>
      </div>
      <p class="mt-3 text-sm text-red-800">Due ${formatDueDate(task.dueDate)}</p>
      <p class="mt-1 text-sm text-red-700">${formatLevel(task.priority || 'medium')} priority | ${formatLevel(task.cognitiveLoad || 'medium')} load</p>
      ${task.nextSegment ? `<p class="mt-2 text-sm text-red-700">Next scheduled block: ${formatQueueTime(task.nextSegment)}</p>` : ''}
      <p class="mt-2 text-sm text-red-700">${task.missingMinutes} minutes still need space before the deadline.</p>
      ${renderUnscheduledReason(task)}
    </button>
  `);

  queueList.innerHTML = scheduledCards.length
    ? scheduledCards.join('')
    : `
      <article class="rounded-[1.5rem] border border-dashed border-graphite/12 bg-cream/75 p-5">
        <p class="text-sm italic text-graphite/55">No upcoming scheduled tasks in the queue.</p>
      </article>
    `;

  if (queuedTasks.length > 5) {
    queueLoadAllBtn.classList.remove('hidden');
    queueLoadAllBtn.textContent = showAllQueueItems ? 'Show Less' : `Load All (${queuedTasks.length})`;
  } else {
    queueLoadAllBtn.classList.add('hidden');
  }

  if (unscheduledCards.length) {
    unscheduledSection.classList.remove('hidden');
    unscheduledBadge.textContent = String(unscheduledCards.length);
    unscheduledList.innerHTML = unscheduledCards.join('');
  } else {
    unscheduledSection.classList.add('hidden');
    unscheduledBadge.textContent = '0';
    unscheduledList.innerHTML = '';
  }
}

/**
 * Renders the 14-day calendar grid with scheduled task segments and availability summaries.
 *
 * Each day cell shows open and blocked hours, then lists the task segments scheduled
 * for that day in chronological order. Days with no segments show a 'No tasks' placeholder.
 *
 * @param {Array<Object>|null} schedule - The scheduled task array, or null if unavailable.
 */
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

/**
 * Returns the Monday of the current week as the calendar's default start date.
 *
 * Delegates to the shared Planner utility.
 *
 * @returns {Date} A Date object set to 00:00 on the most recent Monday.
 */
function getCalendarStartMonday() {
  return Planner.getCurrentMonday();
}

/**
 * Re-renders all dashboard sections using the latest data from localStorage.
 *
 * Reads the current schedule, tasks, and availability, then updates all visible
 * UI regions: stat counters, pulse cards, health banner, timeline, queue,
 * calendar, review banner, and the current-time indicator.
 */
function renderDashboard() {
  const scheduleData = readSchedule();
  const tasks = readTasks();
  const availability = deriveAvailabilityBlocks();
  selectedTimelineDate = clampTimelineDate(createDayStart(selectedTimelineDate));
  const today = new Date();
  const timelineDate = createDayStart(selectedTimelineDate);
  const scheduled = scheduleData?.schedule || [];
  const unscheduled = scheduleData?.unscheduled || [];
  const flatSegments = flattenScheduled(scheduled);
  const timelineSegments = flatSegments
    .filter((segment) => sameDay(new Date(segment.start), timelineDate))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const remainingMinutes = availability.openBlocks.reduce(
    (sum, block) => sum + (new Date(block.end).getTime() - new Date(block.start).getTime()) / 60000,
    0
  );

  const actualTodaySegments = flatSegments
    .filter((segment) => sameDay(new Date(segment.start), today))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  remainingHoursEl.textContent = `${(remainingMinutes / 60).toFixed(remainingMinutes % 60 === 0 ? 0 : 1)}h`;
  scheduledCountEl.textContent = String(scheduleData?.summary?.scheduledCount || scheduled.length);
  unscheduledCountEl.textContent = String(scheduleData?.summary?.incompleteCount || unscheduled.length);
  newCountEl.textContent = String(tasks.filter((task) => task.status === 'new').length);
  progressCountEl.textContent = String(tasks.filter((task) => task.status === 'in_progress').length);
  dateLabel.textContent = today.toLocaleDateString('en-US', dateOptions);
  if (dashboardSolverMetaEl) {
    dashboardSolverMetaEl.textContent = formatSolverMeta(scheduleData);
  }
  updateTimelineDayLabel();

  renderPulse(scheduleData, actualTodaySegments);
  renderScheduleHealth(scheduleData);
  updateSpecificWindowsReminder();
  renderTodayTimeline(timelineSegments);
  renderQueue(scheduled, unscheduled, tasks);
  renderCalendar(scheduled);
  updateReviewBanner(actualTodaySegments.length);
  updateTimelineNow();
}

/**
 * Returns true if the given element is a text input target.
 *
 * Used to prevent keyboard shortcuts from firing when the user is typing
 * in an input, textarea, or select element.
 *
 * @param {EventTarget} target - The event target to check.
 * @returns {boolean} True if the target is a content-editable element or
 *   an INPUT, TEXTAREA, or SELECT element.
 */
function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (
      target.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    );
}

/**
 * Shifts the selected timeline date by the given number of days and re-renders.
 *
 * Clamps the result to the availability window. Does nothing if the clamped
 * result is the same as the current date (i.e. already at the boundary).
 * Resets the auto-scroll flag so the timeline re-scrolls to the current time
 * when navigating back to today.
 *
 * @param {number} delta - Number of days to shift (positive = forward, negative = backward).
 */
function shiftTimelineDay(delta) {
  const next = createDayStart(selectedTimelineDate);
  next.setDate(next.getDate() + delta);
  const clamped = clampTimelineDate(next);
  if (isSameDayValue(clamped, selectedTimelineDate)) {
    return;
  }
  selectedTimelineDate = clamped;
  window.__timelineScrolled = false;
  renderDashboard();
}

timelinePrevDayBtn.addEventListener('click', () => {
  shiftTimelineDay(-1);
});

timelineTodayBtn.addEventListener('click', () => {
  selectedTimelineDate = clampTimelineDate(createDayStart(new Date()));
  window.__timelineScrolled = false;
  renderDashboard();
});

timelineNextDayBtn.addEventListener('click', () => {
  shiftTimelineDay(1);
});

/**
 * Shows or hides the end-of-day review banner based on time, schedule state, and dismissal.
 *
 * The banner is shown after 8 PM if the user has work scheduled today and has not
 * yet dismissed the banner this session. It can also be forced visible via the
 * developer tools trigger button.
 *
 * @param {number} hasTodayWork - The number of segments scheduled for today.
 *   Treated as a boolean: non-zero means work exists.
 */
function updateReviewBanner(hasTodayWork) {
  const dismissed = window.sessionStorage.getItem('architectureReviewBannerDismissed') === 'true';
  const shouldShow = forceReviewBanner || ((new Date().getHours() >= 20) && hasTodayWork && !dismissed);
  reviewBanner.classList.toggle('hidden', !shouldShow);
}

/**
 * Renders the day review modal with today's scheduled tasks and editable fields.
 *
 * For each task with segments today, displays how many minutes were allocated,
 * auto-suggests a status update (in_progress if newly started, completed if
 * fully covered), and provides inputs for extra time, status, priority,
 * cognitive load, and notes.
 */
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
  const estimateValidationMessage = Planner.getTaskEstimateValidationMessage(estimate, cognitiveLoad, dueDate);
  if (estimateValidationMessage) {
    quickAddFeedback.textContent = estimateValidationMessage;
    return;
  }
  if (!activeTaskId && status === 'completed') {
    quickAddFeedback.textContent = 'New tasks cannot start as completed.';
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

  await persistTasksAndRefresh(nextTasks);
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
  await persistTasksAndRefresh(nextTasks);
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
unscheduledList.addEventListener('click', (event) => {
  const editTarget = event.target.closest('[data-edit-task]');
  if (!editTarget) {
    return;
  }

  const task = readTasks().find((item) => item.id === editTarget.dataset.editTask);
  if (task) {
    openTaskEditor(task);
  }
});
queueLoadAllBtn.addEventListener('click', () => {
  showAllQueueItems = !showAllQueueItems;
  renderDashboard();
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
dismissDashboardSpecificWindowsReminderBtn.addEventListener('click', () => {
  window.sessionStorage.setItem(SPECIFIC_WINDOWS_REMINDER_DISMISSED_KEY, 'true');
  dashboardSpecificWindowsReminder.classList.add('hidden');
});
triggerReviewBannerBtn.addEventListener('click', () => {
  forceReviewBanner = true;
  window.sessionStorage.removeItem('architectureReviewBannerDismissed');
  renderDashboard();
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

window.addEventListener('storage', (event) => {
  if (
    event.key === TASKS_KEY
    || event.key === STORAGE_KEY
    || event.key === AVAILABILITY_KEY
  ) {
    renderDashboard();
  }
});

document.addEventListener('keydown', (event) => {
  if (isTypingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    shiftTimelineDay(-1);
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    shiftTimelineDay(1);
  }
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
setDeveloperVisibility(false);
renderDashboard();