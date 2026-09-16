const state = {
  selectedRun: null,
  current: null
};

const $ = id =>
  document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function short(value, length = 10) {
  if (!value) return '—';

  return value.length > length
    ? `${value.slice(0, length)}…`
    : value;
}

function date(value) {
  if (!value) return '—';

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString();
}

function statusClass(status) {
  if (
    ['COMPLETED', 'PASS', 'PASS_WITH_LIMITATIONS']
      .includes(status)
  ) {
    return 'good';
  }

  if (
    ['FAILED', 'BLOCKED', 'FAIL']
      .includes(status)
  ) {
    return 'bad';
  }

  return 'warn';
}

async function api(url) {
  const response = await fetch(url, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

function renderAgents(run) {
  $('agent-count').textContent =
    String(run.agents.length);

  $('agents').innerHTML =
    run.agents.map(agent => `
      <article class="agent">
        <div class="agent-head">
          <span class="agent-id">
            ${escapeHtml(agent.id)}
          </span>

          <span class="agent-state state-${escapeHtml(agent.state)}">
            ${escapeHtml(agent.state)}
          </span>
        </div>

        <h3>${escapeHtml(agent.name)}</h3>

        <p>
          ${escapeHtml(agent.purpose)}
        </p>
      </article>
    `).join('');
}

function renderKnowledge(run) {
  const claims = run.claims ?? [];

  const known = claims.filter(
    claim =>
      claim.classification === 'KNOWN'
  );

  const inferred = claims.filter(
    claim =>
      claim.classification === 'INFERRED'
  );

  const unknown = claims.filter(
    claim =>
      claim.classification === 'UNKNOWN'
  );

  $('claim-count').textContent =
    String(claims.length);

  const rows = [
    ['FACT / KNOWN', known.length],
    ['HYPOTHESIS / INFERRED', inferred.length],
    ['UNKNOWN', unknown.length],
    ['UNCERTAINTY', run.uncertainty.length]
  ];

  $('knowledge').innerHTML =
    rows.map(([label, count]) => `
      <div class="knowledge-row">
        <strong>${escapeHtml(label)}</strong>
        <span>${count} entries</span>
      </div>
    `).join('');
}

function renderVerdicts(run) {
  if (!run.verdicts.length) {
    $('verdicts').innerHTML =
      '<p class="empty">No verification verdicts found.</p>';

    return;
  }

  $('verdicts').innerHTML =
    run.verdicts.map(item => `
      <div class="verdict">
        <strong>
          ${escapeHtml(item.agent)}
        </strong>

        <span class="${statusClass(item.verdict)}">
          ${escapeHtml(item.verdict)}
        </span>

        ${
          item.criticism
            ? `<p>${escapeHtml(item.criticism)}</p>`
            : ''
        }
      </div>
    `).join('');
}

function renderList(id, values, emptyText) {
  const node = $(id);

  if (!values?.length) {
    node.innerHTML =
      `<li>${escapeHtml(emptyText)}</li>`;

    return;
  }

  node.innerHTML =
    values.map(value => `
      <li>${escapeHtml(value)}</li>
    `).join('');
}

function renderEvents(run) {
  const events = [...run.events]
    .reverse()
    .slice(0, 120);

  $('event-count').textContent =
    `${run.events.length} events`;

  if (!events.length) {
    $('events').innerHTML =
      '<p class="empty">No events recorded.</p>';

    return;
  }

  $('events').innerHTML =
    events.map(event => `
      <article class="event">
        <time>
          ${escapeHtml(date(event.timestamp))}
        </time>

        <span class="event-agent">
          ${escapeHtml(event.agent_id ?? 'SYSTEM')}
        </span>

        <span class="event-type">
          ${escapeHtml(event.type)}
        </span>

        <span>
          ${escapeHtml(event.summary ?? '')}
        </span>
      </article>
    `).join('');
}

function renderArtifacts(run) {
  $('artifact-count').textContent =
    String(run.artifacts.length);

  if (!run.artifacts.length) {
    $('artifacts').innerHTML =
      '<p class="empty">No artifacts recorded.</p>';

    return;
  }

  $('artifacts').innerHTML =
    run.artifacts.map(artifact => `
      <article class="artifact">
        <strong>
          ${escapeHtml(artifact.agent_id)}
        </strong>

        <span>
          ${escapeHtml(artifact.media_type)}
        </span>

        <span>
          ${escapeHtml(date(artifact.created_at))}
        </span>

        <code>
          sha256 ${escapeHtml(short(artifact.sha256, 16))}
        </code>
      </article>
    `).join('');
}

function render(run) {
  state.current = run;

  $('run-status').textContent =
    run.status ?? 'UNKNOWN';

  $('run-status').className =
    statusClass(run.status);

  $('adapter').textContent =
    run.adapter ?? '—';

  $('run-id').textContent =
    run.run_id ?? '—';

  $('commit').textContent =
    `commit ${run.commit_sha ?? '—'}`;

  $('completed-at').textContent =
    run.completed_at
      ? `Completed ${date(run.completed_at)}`
      : `Started ${date(run.created_at)}`;

  $('evidence-count').textContent =
    String(run.evidence.length);

  if (run.receipt.available) {
    $('receipt-state').textContent =
      'SEALED / AVAILABLE';

    $('receipt-state').className =
      'receipt-state good';
  } else {
    $('receipt-state').textContent =
      'NOT AVAILABLE';

    $('receipt-state').className =
      'receipt-state warn';
  }

  renderAgents(run);
  renderKnowledge(run);
  renderVerdicts(run);

  renderList(
    'uncertainty',
    run.uncertainty,
    'No recorded uncertainty.'
  );

  renderList(
    'errors',
    run.errors,
    'No recorded errors.'
  );

  renderEvents(run);
  renderArtifacts(run);
}

async function loadRuns() {
  const runs = await api('/api/runs');
  const selector = $('run-selector');

  const existing =
    state.selectedRun ??
    selector.value;

  selector.innerHTML =
    runs.map(run => `
      <option value="${escapeHtml(run.run_id)}">
        ${escapeHtml(run.status)} ·
        ${escapeHtml(short(run.run_id, 8))} ·
        ${escapeHtml(short(run.commit_sha, 8))}
      </option>
    `).join('');

  if (
    existing &&
    runs.some(run => run.run_id === existing)
  ) {
    selector.value = existing;
  }

  return runs;
}

async function loadSelected() {
  const id =
    state.selectedRun ??
    $('run-selector').value;

  if (!id) {
    const latest = await api('/api/latest');
    render(latest);
    return;
  }

  const run = await api(
    `/api/runs/${encodeURIComponent(id)}`
  );

  render(run);
}

async function refresh() {
  try {
    const runs = await loadRuns();

    if (
      !state.selectedRun &&
      runs.length
    ) {
      $('run-selector').value =
        runs[0].run_id;
    }

    await loadSelected();

    $('connection-dot')
      .className = 'dot online';

    $('connection-text').textContent =
      'Live · localhost';
  } catch (error) {
    $('connection-dot')
      .className = 'dot offline';

    $('connection-text').textContent =
      `Disconnected · ${error.message}`;
  }
}

$('run-selector').addEventListener(
  'change',
  async event => {
    state.selectedRun =
      event.target.value;

    await loadSelected();
  }
);

refresh();

setInterval(
  async () => {
    if (state.selectedRun) {
      try {
        await loadSelected();
      } catch {
        // Main refresh handles visible connection errors.
      }
    } else {
      await refresh();
    }
  },
  2000
);
