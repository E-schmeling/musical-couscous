const STORAGE_KEY = 'architectureAvailability';
const TASKS_KEY = 'architectureTasks';
const SCHEDULE_KEY = 'architectureLastSchedule';
const API_BASE_URL = 'http://127.0.0.1:5050';
const Planner = window.ArchitecturePlanner;
const saveFeedback = document.getElementById('save-feedback');
const savedAvailability = loadAvailability();
const routine = savedAvailability?.routine || Array.from({ length: 7 }, () => ({}));
const schedule14 = savedAvailability?.schedule14 || Array.from({ length: 14 }, () => ({}));

let activeTab = '14-day';
const startHour = 6;
const endHour = 23;
const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const timeSlots = [];

for (let hour = startHour; hour <= endHour; hour += 1) {
  timeSlots.push({ hour, isHalfHour: false, key: `${hour}:00` });
  timeSlots.push({ hour, isHalfHour: true, key: `${hour}:30` });
}

const today = new Date();
const startMonday = savedAvailability?.startMonday ? new Date(savedAvailability.startMonday) : Planner.getCurrentMonday();
if (!savedAvailability?.startMonday) {
  startMonday.setTime(Planner.getCurrentMonday().getTime());
}
startMonday.setHours(0, 0, 0, 0);

const all14Dates = [];
for (let index = 0; index < 14; index += 1) {
  const date = new Date(startMonday);
  date.setDate(startMonday.getDate() + index);
  all14Dates.push(date);
}

const calendarContainer = document.getElementById('calendar-container');
const btn14Day = document.getElementById('tab-14day');
const btnRoutine = document.getElementById('tab-routine');
const legend = document.getElementById('legend');
const specificWindowsReminder = document.getElementById('specific-windows-reminder');
const specificWindowsReminderText = document.getElementById('specific-windows-reminder-text');
const dismissSpecificWindowsReminderBtn = document.getElementById('dismiss-specific-windows-reminder');
const SPECIFIC_WINDOWS_REMINDER_DISMISSED_KEY = 'architectureSpecificWindowsReminderDismissedSession';

let isPainting = false;
let isBoxSelecting = false;
let activeGridStart = null;
let boxStart = null;
let boxCurrent = null;
let dragMode = true;
let cellDOMNodes = [];

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function createCell(text, className) {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  return div;
}

function updateLegend() {
  if (activeTab === 'routine') {
    legend.innerHTML = `
      <div class="chip bg-white/80 text-graphite/70"><span class="h-2.5 w-2.5 rounded-full bg-white ring-1 ring-graphite/20"></span> Available</div>
      <div class="chip bg-graphite text-cream"><span class="h-2.5 w-2.5 rounded-full bg-clay"></span> Routine Blocked</div>
    `;
    return;
  }

  legend.innerHTML = `
    <div class="chip bg-white/80 text-graphite/70"><span class="h-2.5 w-2.5 rounded-full bg-white ring-1 ring-graphite/20"></span> Available</div>
    <div class="chip bg-olive/15 text-olive"><span class="h-2.5 w-2.5 rounded-full bg-olive"></span> Routine Blocked</div>
    <div class="chip bg-terracotta/15 text-[#8f3f29]"><span class="h-2.5 w-2.5 rounded-full bg-terracotta"></span> Specific Blocked</div>
  `;
}

function updateSpecificWindowsReminder() {
  if (activeTab !== '14-day') {
    specificWindowsReminder.classList.add('hidden');
    return;
  }

  const reminders = Planner.getSpecificWindowsReminderMessages({ schedule14 });

  if (!reminders.length) {
    specificWindowsReminder.classList.add('hidden');
    window.sessionStorage.removeItem(SPECIFIC_WINDOWS_REMINDER_DISMISSED_KEY);
    return;
  }

  if (window.sessionStorage.getItem(SPECIFIC_WINDOWS_REMINDER_DISMISSED_KEY) === 'true') {
    specificWindowsReminder.classList.add('hidden');
    return;
  }

  specificWindowsReminderText.textContent = `${reminders.join(' ')} Add week-specific overrides if those days differ from the routine template.`;
  specificWindowsReminder.classList.remove('hidden');
}

function updateCellVisual(cell, isSpecificBlocked, isRoutineBlocked, isRoutineTab) {
  cell.style.backgroundColor = '';

  if (isRoutineTab) {
    cell.style.backgroundColor = isRoutineBlocked ? '#26231f' : '#ffffff';
    return;
  }

  if (isSpecificBlocked) {
    cell.style.backgroundColor = '#bf5b3d';
  } else if (isRoutineBlocked) {
    cell.style.backgroundColor = 'rgba(106, 122, 84, 0.45)';
  } else {
    cell.style.backgroundColor = '#ffffff';
  }
}

function createGrid(startIndex, numCols, titleText, isRoutineTab) {
  const wrapper = document.createElement('section');
  wrapper.className = 'module-card overflow-hidden rounded-[1.75rem]';

  const header = document.createElement('div');
  header.className = 'border-b border-graphite/10 bg-cream/80 px-5 py-4';
  header.innerHTML = `
    <p class="text-xs uppercase tracking-[0.24em] text-olive">${isRoutineTab ? 'Template' : 'Specific windows'}</p>
    <h3 class="mt-2 font-display text-2xl text-graphite">${titleText}</h3>
  `;
  wrapper.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'grid bg-white';
  grid.style.gridTemplateColumns = `86px repeat(${numCols}, minmax(96px, 1fr))`;

  grid.appendChild(createCell('', 'border-b border-r border-graphite/10 bg-cream/70'));

  for (let index = 0; index < numCols; index += 1) {
    const dayIndex = startIndex + index;
    const headerText = isRoutineTab ? weekDays[index] : formatDate(all14Dates[dayIndex]);
    grid.appendChild(createCell(headerText, 'border-b border-r border-graphite/10 bg-cream/70 px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.16em] text-graphite/70'));
  }

  timeSlots.forEach((slot, rowIndex) => {
    const timeLabel = slot.isHalfHour ? '' : `${slot.hour > 12 ? slot.hour - 12 : slot.hour}:00 ${slot.hour >= 12 ? 'PM' : 'AM'}`;
    const timeCellClass = `border-r border-graphite/10 px-3 ${slot.isHalfHour ? 'border-b border-graphite/5' : 'border-b border-dashed border-graphite/10'} text-right text-[11px] font-semibold text-graphite/45`;
    grid.appendChild(createCell(timeLabel, timeCellClass));

    for (let index = 0; index < numCols; index += 1) {
      const dayIndex = startIndex + index;
      const cell = document.createElement('div');
      const borderClass = slot.isHalfHour ? 'border-b border-graphite/5' : 'border-b border-dashed border-graphite/10';
      cell.className = `grid-slot ${borderClass} border-r border-graphite/10 cursor-pointer`;
      cellDOMNodes[dayIndex][rowIndex] = cell;

      const routineDayIndex = isRoutineTab ? dayIndex : dayIndex % 7;
      const routineBlocked = routine[routineDayIndex][slot.key] || false;
      const specificBlocked = !isRoutineTab && (schedule14[dayIndex][slot.key] || false);
      updateCellVisual(cell, specificBlocked, routineBlocked, isRoutineTab);

      cell.addEventListener('mousedown', (event) => {
        event.preventDefault();
        activeGridStart = startIndex;
        dragMode = isRoutineTab ? !routine[dayIndex][slot.key] : !schedule14[dayIndex][slot.key];

        if (event.shiftKey) {
          isBoxSelecting = true;
          boxStart = { col: dayIndex, row: rowIndex };
          boxCurrent = { col: dayIndex, row: rowIndex };
          updateBoxVisuals(isRoutineTab);
          return;
        }

        isPainting = true;
        if (isRoutineTab) {
          routine[dayIndex][slot.key] = dragMode;
        } else {
          schedule14[dayIndex][slot.key] = dragMode;
        }
        updateCellVisual(cell, !isRoutineTab && schedule14[dayIndex][slot.key], routine[routineDayIndex][slot.key], isRoutineTab);
      });

      cell.addEventListener('mouseenter', () => {
        if (activeGridStart !== null && activeGridStart !== startIndex) {
          return;
        }
        if (isBoxSelecting) {
          boxCurrent = { col: dayIndex, row: rowIndex };
          updateBoxVisuals(isRoutineTab);
          return;
        }
        if (!isPainting) {
          return;
        }

        if (isRoutineTab) {
          routine[dayIndex][slot.key] = dragMode;
        } else {
          schedule14[dayIndex][slot.key] = dragMode;
        }
        updateCellVisual(cell, !isRoutineTab && schedule14[dayIndex][slot.key], routine[routineDayIndex][slot.key], isRoutineTab);
      });

      grid.appendChild(cell);
    }
  });

  wrapper.appendChild(grid);
  return wrapper;
}

function updateBoxVisuals(isRoutineTab) {
  if (!boxStart || !boxCurrent) {
    return;
  }

  const minCol = Math.min(boxStart.col, boxCurrent.col);
  const maxCol = Math.max(boxStart.col, boxCurrent.col);
  const minRow = Math.min(boxStart.row, boxCurrent.row);
  const maxRow = Math.max(boxStart.row, boxCurrent.row);

  for (let col = 0; col < 14; col += 1) {
    if (activeGridStart !== null && (col < activeGridStart || col >= activeGridStart + 7)) {
      continue;
    }
    for (let row = 0; row < timeSlots.length; row += 1) {
      const cell = cellDOMNodes[col][row];
      if (!cell) {
        continue;
      }

      const timeKey = timeSlots[row].key;
      const routineDayIndex = isRoutineTab ? col : col % 7;
      const routineBlocked = routine[routineDayIndex][timeKey] || false;
      const specificBlocked = !isRoutineTab && (schedule14[col][timeKey] || false);
      const inBox = col >= minCol && col <= maxCol && row >= minRow && row <= maxRow;

      if (inBox) {
        updateCellVisual(cell, !isRoutineTab && dragMode, isRoutineTab ? dragMode : routineBlocked, isRoutineTab);
      } else {
        updateCellVisual(cell, specificBlocked, routineBlocked, isRoutineTab);
      }
    }
  }
}

function renderCalendar() {
  updateLegend();
  updateSpecificWindowsReminder();
  calendarContainer.innerHTML = '';
  cellDOMNodes = Array.from({ length: 14 }, () => []);

  if (activeTab === 'routine') {
    calendarContainer.appendChild(createGrid(0, 7, 'Weekly Routine Template', true));
    return;
  }

  calendarContainer.appendChild(createGrid(0, 7, 'Week 1', false));
  const divider = document.createElement('div');
  divider.className = 'mx-1 h-5 rounded-full bg-[linear-gradient(90deg,rgba(191,91,61,0.18),rgba(106,122,84,0.18))]';
  calendarContainer.appendChild(divider);
  calendarContainer.appendChild(createGrid(7, 7, 'Week 2', false));
}

function loadAvailability() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return Planner.normalizeAvailabilityWindow(JSON.parse(raw), (normalized) => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    });
  } catch (error) {
    return null;
  }
}

function saveAvailability() {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      startMonday: startMonday.toISOString(),
      routine,
      schedule14
    })
  );
}

function readTasks() {
  const raw = window.localStorage.getItem(TASKS_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function readSchedule() {
  const raw = window.localStorage.getItem(SCHEDULE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function writeSchedule(schedule) {
  window.localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
}

function setSaveFeedback(message, tone = 'neutral') {
  saveFeedback.textContent = message;
  saveFeedback.className = 'mt-4 text-sm';
  if (tone === 'error') {
    saveFeedback.classList.add('text-red-200');
    return;
  }
  if (tone === 'success') {
    saveFeedback.classList.add('text-cream/85');
    return;
  }
  saveFeedback.classList.add('text-cream/70');
}

function getNextHalfHour() {
  return Planner.getNextHalfHour();
}

function deriveOpenBlocks() {
  const blocks = [];

  for (let dayIndex = 0; dayIndex < 14; dayIndex += 1) {
    const currentDate = new Date(startMonday);
    currentDate.setDate(startMonday.getDate() + dayIndex);
    currentDate.setHours(0, 0, 0, 0);

    let activeStart = null;

    timeSlots.forEach((slot, slotIndex) => {
      const routineBlocked = Boolean((routine[dayIndex % 7] || {})[slot.key]);
      const specificBlocked = Boolean((schedule14[dayIndex] || {})[slot.key]);
      const isBlocked = routineBlocked || specificBlocked;
      const isLastSlot = slotIndex === timeSlots.length - 1;

      if (!isBlocked && activeStart === null) {
        activeStart = slot.key;
      }

      if ((isBlocked || isLastSlot) && activeStart !== null) {
        blocks.push({
          start: toIsoDateTime(currentDate, activeStart),
          end: isBlocked ? toIsoDateTime(currentDate, slot.key) : addThirtyMinutes(currentDate, slot.key)
        });
        activeStart = null;
      }
    });
  }

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
  return Planner.subtractSegmentsFromBlocks(blocks, segments);
}

function buildSchedulingTasks(taskList, previousSchedule, cutoff) {
  return Planner.buildSchedulingTasks(taskList, previousSchedule, cutoff);
}

function mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff) {
  return Planner.mergeScheduleHistory(previousSchedule, nextSchedule, taskList, cutoff, deriveOpenBlocks());
}

async function syncScheduleFromAvailability() {
  const tasks = readTasks();
  if (!tasks.length) {
    return { state: 'saved', message: 'Availability saved. No tasks to optimize yet.' };
  }

  const timeBlocks = deriveOpenBlocks();
  if (!timeBlocks.length) {
    return { state: 'saved', message: 'Availability saved. There are no future open blocks yet.' };
  }

  const previousSchedule = readSchedule();
  const cutoff = getNextHalfHour();
  const fixedSegments = (previousSchedule?.schedule || [])
    .flatMap((task) => task.segments)
    .filter((segment) => new Date(segment.start) < cutoff);
  const availableBlocks = subtractSegmentsFromBlocks(timeBlocks, fixedSegments);
  const schedulableTasks = buildSchedulingTasks(tasks, previousSchedule, cutoff);

  if (!availableBlocks.length) {
    return { state: 'saved', message: 'Availability saved. All future open time is already fixed by active schedule blocks.' };
  }

  if (!schedulableTasks.length) {
    const mergedSchedule = Planner.mergeScheduleHistory(previousSchedule, { summary: null, schedule: [], unscheduled: [] }, tasks, cutoff, availableBlocks);
    writeSchedule(mergedSchedule);
    return { state: 'saved', message: Planner.getScheduleHealthMessage(mergedSchedule).message };
  }

  const response = await fetch(`${API_BASE_URL}/api/schedule`, {
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
    throw new Error(payload.error || 'Unable to update schedule.');
  }

  const mergedSchedule = Planner.mergeScheduleHistory(previousSchedule, payload, tasks, cutoff, availableBlocks);
  writeSchedule(mergedSchedule);
  return {
    state: 'saved-and-optimized',
    message: `Availability saved and schedule refreshed. ${Planner.getScheduleHealthMessage(mergedSchedule).message}`
  };
}

btn14Day.addEventListener('click', () => {
  activeTab = '14-day';
  btn14Day.className = 'rounded-full bg-white px-5 py-3 text-sm font-bold text-graphite shadow';
  btnRoutine.className = 'rounded-full px-5 py-3 text-sm font-bold text-graphite/60 transition hover:bg-white/50';
  renderCalendar();
});

btnRoutine.addEventListener('click', () => {
  activeTab = 'routine';
  btnRoutine.className = 'rounded-full bg-white px-5 py-3 text-sm font-bold text-graphite shadow';
  btn14Day.className = 'rounded-full px-5 py-3 text-sm font-bold text-graphite/60 transition hover:bg-white/50';
  renderCalendar();
});

dismissSpecificWindowsReminderBtn.addEventListener('click', () => {
  window.sessionStorage.setItem(SPECIFIC_WINDOWS_REMINDER_DISMISSED_KEY, 'true');
  specificWindowsReminder.classList.add('hidden');
});

document.addEventListener('mouseup', () => {
  const hadPaintInteraction = isPainting || isBoxSelecting;
  if (isBoxSelecting && boxStart && boxCurrent) {
    const minCol = Math.min(boxStart.col, boxCurrent.col);
    const maxCol = Math.max(boxStart.col, boxCurrent.col);
    const minRow = Math.min(boxStart.row, boxCurrent.row);
    const maxRow = Math.max(boxStart.row, boxCurrent.row);

    for (let col = minCol; col <= maxCol; col += 1) {
      if (activeGridStart !== null && (col < activeGridStart || col >= activeGridStart + 7)) {
        continue;
      }
      for (let row = minRow; row <= maxRow; row += 1) {
        const timeKey = timeSlots[row].key;
        if (activeTab === 'routine') {
          routine[col][timeKey] = dragMode;
        } else {
          schedule14[col][timeKey] = dragMode;
        }
      }
    }
    renderCalendar();
  }

  if (hadPaintInteraction) {
    saveAvailability();
    window.sessionStorage.removeItem(SPECIFIC_WINDOWS_REMINDER_DISMISSED_KEY);
    updateSpecificWindowsReminder();
  }

  isPainting = false;
  isBoxSelecting = false;
  activeGridStart = null;
  boxStart = null;
  boxCurrent = null;
});

document.getElementById('save-schedule').addEventListener('click', async () => {
  saveAvailability();
  const button = document.getElementById('save-schedule');
  const originalText = button.textContent;
  setSaveFeedback('Saving availability...', 'neutral');
  button.textContent = 'Saving...';
  button.disabled = true;
  button.classList.remove('bg-terracotta', 'hover:bg-[#a84b31]');
  button.classList.add('bg-olive', 'hover:bg-[#596645]');

  try {
    const result = await syncScheduleFromAvailability();
    button.textContent = result.state === 'saved-and-optimized' ? 'Saved + optimized' : 'Saved to planner';
    setSaveFeedback(result.message, 'success');
  } catch (error) {
    console.error('Schedule refiner optimization failed:', error);
    button.textContent = 'Saved, optimize failed';
    button.classList.remove('bg-olive', 'hover:bg-[#596645]');
    button.classList.add('bg-clay');
    setSaveFeedback(error.message, 'error');
  }

  window.setTimeout(() => {
    button.textContent = originalText;
    button.disabled = false;
    button.classList.add('bg-terracotta', 'hover:bg-[#a84b31]');
    button.classList.remove('bg-olive', 'hover:bg-[#596645]', 'bg-clay');
  }, 1800);
});

function toIsoDateTime(date, time) {
  return Planner.toIsoDateTime(date, time);
}

function addThirtyMinutes(date, time) {
  return Planner.addThirtyMinutes(date, time);
}

renderCalendar();
