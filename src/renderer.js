const API_BASE_URL = 'http://127.0.0.1:5050';
const timeBlocksRoot = document.getElementById('time-blocks');
const taskListRoot = document.getElementById('task-list');
const resultsRoot = document.getElementById('results');
const feedbackEl = document.getElementById('feedback');
const healthIndicator = document.getElementById('health-indicator');
const planMeta = document.getElementById('plan-meta');

let timeBlocks = [
  {
    id: crypto.randomUUID(),
    start: '2026-04-13T09:00',
    end: '2026-04-13T11:00'
  },
  {
    id: crypto.randomUUID(),
    start: '2026-04-14T13:00',
    end: '2026-04-14T16:00'
  }
];

let tasks = [
  {
    id: crypto.randomUUID(),
    title: 'Site analysis package',
    priority: 'high',
    cognitiveLoad: 'deep',
    estimateMinutes: 180
  },
  {
    id: crypto.randomUUID(),
    title: 'Zoning research summary',
    priority: 'medium',
    cognitiveLoad: 'focused',
    estimateMinutes: 120
  },
  {
    id: crypto.randomUUID(),
    title: 'Concept sketch revisions',
    priority: 'high',
    cognitiveLoad: 'light',
    estimateMinutes: 90
  }
];

function renderTimeBlocks() {
  timeBlocksRoot.innerHTML = '';

  timeBlocks.forEach((block) => {
    const card = document.createElement('div');
    card.className = 'panel-appear rounded-3xl border border-graphite/10 bg-white/80 p-4';
    card.innerHTML = `
      <div class="grid gap-3">
        <label class="text-sm font-semibold text-graphite/80">
          Start
          <input
            class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta"
            type="datetime-local"
            value="${block.start}"
            data-block-id="${block.id}"
            data-field="start"
          />
        </label>
        <label class="text-sm font-semibold text-graphite/80">
          End
          <input
            class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta"
            type="datetime-local"
            value="${block.end}"
            data-block-id="${block.id}"
            data-field="end"
          />
        </label>
        <button
          class="justify-self-start rounded-full border border-graphite/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-graphite/60"
          data-remove-block="${block.id}"
        >
          Remove
        </button>
      </div>
    `;
    timeBlocksRoot.appendChild(card);
  });

  document.getElementById('summary-window-count').textContent = String(timeBlocks.length);
}

function renderTasks() {
  taskListRoot.innerHTML = '';

  tasks.forEach((task) => {
    const card = document.createElement('div');
    card.className = 'panel-appear rounded-3xl border border-graphite/10 bg-white/80 p-4';
    card.innerHTML = `
      <div class="grid gap-3">
        <label class="text-sm font-semibold text-graphite/80">
          Task
          <input
            class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta"
            type="text"
            value="${task.title}"
            data-task-id="${task.id}"
            data-field="title"
          />
        </label>
        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-sm font-semibold text-graphite/80">
            Priority
            <select
              class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta"
              data-task-id="${task.id}"
              data-field="priority"
            >
              ${renderOptions(['high', 'medium', 'low'], task.priority)}
            </select>
          </label>
          <label class="text-sm font-semibold text-graphite/80">
            Cognitive Load
            <select
              class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta"
              data-task-id="${task.id}"
              data-field="cognitiveLoad"
            >
              ${renderOptions(['deep', 'focused', 'light'], task.cognitiveLoad)}
            </select>
          </label>
        </div>
        <label class="text-sm font-semibold text-graphite/80">
          Estimate Minutes
          <input
            class="mt-2 w-full rounded-2xl border border-graphite/10 bg-cream px-4 py-3 outline-none focus:border-terracotta"
            type="number"
            min="15"
            step="15"
            value="${task.estimateMinutes}"
            data-task-id="${task.id}"
            data-field="estimateMinutes"
          />
        </label>
        <button
          class="justify-self-start rounded-full border border-graphite/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-graphite/60"
          data-remove-task="${task.id}"
        >
          Remove
        </button>
      </div>
    `;
    taskListRoot.appendChild(card);
  });

  document.getElementById('summary-task-count').textContent = String(tasks.length);
}

function renderOptions(options, selectedValue) {
  return options
    .map((value) => `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${capitalize(value)}</option>`)
    .join('');
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function bindEvents() {
  document.getElementById('add-block').addEventListener('click', () => {
    timeBlocks.push({
      id: crypto.randomUUID(),
      start: '2026-04-15T09:00',
      end: '2026-04-15T11:00'
    });
    renderTimeBlocks();
  });

  document.getElementById('add-task').addEventListener('click', () => {
    tasks.push({
      id: crypto.randomUUID(),
      title: 'New task',
      priority: 'medium',
      cognitiveLoad: 'focused',
      estimateMinutes: 60
    });
    renderTasks();
  });

  document.getElementById('generate-plan').addEventListener('click', generatePlan);

  document.addEventListener('input', (event) => {
    const { blockId, taskId, field } = event.target.dataset;
    if (blockId) {
      timeBlocks = timeBlocks.map((block) =>
        block.id === blockId ? { ...block, [field]: event.target.value } : block
      );
    }
    if (taskId) {
      tasks = tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              [field]: field === 'estimateMinutes' ? Number(event.target.value) : event.target.value
            }
          : task
      );
    }
  });

  document.addEventListener('click', (event) => {
    const removeBlockId = event.target.dataset.removeBlock;
    if (removeBlockId) {
      timeBlocks = timeBlocks.filter((block) => block.id !== removeBlockId);
      renderTimeBlocks();
      return;
    }

    const removeTaskId = event.target.dataset.removeTask;
    if (removeTaskId) {
      tasks = tasks.filter((task) => task.id !== removeTaskId);
      renderTasks();
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
  }
}

async function generatePlan() {
  hideFeedback();
  planMeta.textContent = 'Generating...';

  try {
    const response = await fetch(`${API_BASE_URL}/api/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        timeBlocks: timeBlocks.map((block) => ({
          start: new Date(block.start).toISOString(),
          end: new Date(block.end).toISOString()
        })),
        tasks
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to generate a schedule.');
    }

    renderResults(payload);
    showFeedback('Schedule created successfully.', 'success');
  } catch (error) {
    resultsRoot.innerHTML = '';
    planMeta.textContent = 'Awaiting schedule';
    showFeedback(error.message, 'error');
  }
}

function renderResults(payload) {
  const { summary, schedule, unscheduled } = payload;
  document.getElementById('summary-scheduled-count').textContent = String(summary.scheduledCount);
  planMeta.textContent = `${summary.totalAvailableMinutes} available minutes across ${summary.timeBlockCount} blocks`;

  const scheduledMarkup = schedule.length
    ? schedule
        .map(
          (task) => `
            <article class="rounded-3xl border border-graphite/10 bg-cream p-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h3 class="text-lg font-semibold">${task.title}</h3>
                  <p class="mt-1 text-sm text-graphite/65">${capitalize(task.priority)} priority • ${capitalize(task.cognitiveLoad)} load • ${task.estimateMinutes} min</p>
                </div>
                <span class="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-olive">Scheduled</span>
              </div>
              <div class="mt-4 space-y-3">
                ${task.segments
                  .map(
                    (segment) => `
                      <div class="rounded-2xl bg-white px-4 py-3 text-sm text-graphite/80">
                        ${formatDate(segment.start)} to ${formatDate(segment.end)} • ${segment.allocatedMinutes} min
                      </div>
                    `
                  )
                  .join('')}
              </div>
            </article>
          `
        )
        .join('')
    : '<p class="rounded-3xl bg-cream p-4 text-sm text-graphite/70">No tasks could be scheduled with the current time blocks.</p>';

  const unscheduledMarkup = unscheduled.length
    ? `
      <section class="rounded-3xl border border-red-200 bg-red-50 p-4">
        <p class="text-sm uppercase tracking-[0.18em] text-red-700">Needs more room</p>
        <div class="mt-3 space-y-3">
          ${unscheduled
            .map(
              (task) => `
                <div class="rounded-2xl bg-white px-4 py-3 text-sm text-red-900">
                  ${task.title} is short by ${task.missingMinutes} minutes.
                </div>
              `
            )
            .join('')}
        </div>
      </section>
    `
    : '';

  resultsRoot.innerHTML = scheduledMarkup + unscheduledMarkup;
}

function formatDate(isoString) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(isoString));
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

renderTimeBlocks();
renderTasks();
bindEvents();
checkHealth();
