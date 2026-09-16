const state = {
  runs: [],
  selectedRun: null
};

const $ = id =>
  document.getElementById(id);

function escapeHtml(
  value
) {
  return String(
    value ?? ''
  )
    .replaceAll(
      '&',
      '&amp;'
    )
    .replaceAll(
      '<',
      '&lt;'
    )
    .replaceAll(
      '>',
      '&gt;'
    )
    .replaceAll(
      '"',
      '&quot;'
    )
    .replaceAll(
      "'",
      '&#039;'
    );
}

async function api(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      {
        cache:
          'no-store',

        ...options
      }
    );

  const payload =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    throw new Error(
      payload.message ??
      payload.error ??
      `${response.status} ${response.statusText}`
    );
  }

  return payload;
}

function classForStatus(
  status
) {
  if (
    [
      'COMPLETED',
      'PASS',
      'PASS_WITH_LIMITATIONS',
      'VERIFYING'
    ].includes(status)
  ) {
    return 'good';
  }

  if (
    [
      'FAILED',
      'FAIL',
      'BLOCKED',
      'CANCELLED'
    ].includes(status)
  ) {
    return 'bad';
  }

  return 'warn';
}

function shortSha(
  value
) {
  if (!value) {
    return '—';
  }

  return value.slice(
    0,
    12
  );
}

function shortId(
  value
) {
  if (!value) {
    return '—';
  }

  return value.slice(
    0,
    8
  );
}

function renderList(
  container,
  items,
  emptyText
) {
  if (!items?.length) {
    container.innerHTML =
      `<div class="empty">${escapeHtml(
        emptyText
      )}</div>`;

    return;
  }

  container.innerHTML =
    items
      .map(
        item =>
          `<div class="stack-item">${escapeHtml(
            item
          )}</div>`
      )
      .join('');
}

function stageName(
  agent
) {
  const names = {
    'SINK-01':
      'Scout',

    'SINK-05':
      'Analyst',

    'SINK-02':
      'Builder',

    'SINK-03':
      'Auditor',

    'RED-SINK':
      'Red Sink'
  };

  return names[agent] ??
    agent;
}

function renderPipeline(
  stages
) {
  const root =
    $('pipeline');

  root.innerHTML =
    (stages ?? [])
      .map(
        stage => `
          <div class="stage">
            <div class="stage-agent">
              ${escapeHtml(
                stage.agent_id
              )}
            </div>

            <div class="stage-name">
              ${escapeHtml(
                stageName(
                  stage.agent_id
                )
              )}
            </div>

            <div class="stage-objective">
              ${escapeHtml(
                stage.objective ??
                'No task created.'
              )}
            </div>

            <div class="stage-footer">
              <span class="stage-meta">
                ${stage.artifacts} artifacts
              </span>

              <span class="stage-status ${classForStatus(
                stage.status
              )}">
                ${escapeHtml(
                  stage.status
                )}
              </span>
            </div>
          </div>
        `
      )
      .join('');
}

function renderVerification(
  verification
) {
  const root =
    $('verification');

  if (
    !verification?.length
  ) {
    root.innerHTML =
      '<div class="empty">No independent verdicts yet.</div>';

    return;
  }

  root.innerHTML =
    verification
      .map(
        item => `
          <div class="verification-item">
            <div class="verification-head">
              <strong class="mono">
                ${escapeHtml(
                  item.agent_id
                )}
              </strong>

              <span class="verdict-pill ${classForStatus(
                item.verdict
              )}">
                ${escapeHtml(
                  item.verdict
                )}
              </span>
            </div>

            ${
              (
                item.reasons ??
                []
              )
                .map(
                  reason =>
                    `<div class="verification-reason">${escapeHtml(
                      reason
                    )}</div>`
                )
                .join('')
            }
          </div>
        `
      )
      .join('');
}

function renderArtifacts(
  artifacts
) {
  const root =
    $('artifacts');

  if (
    !artifacts?.length
  ) {
    root.innerHTML =
      '<div class="empty">No artifacts yet.</div>';

    return;
  }

  root.innerHTML =
    artifacts
      .slice()
      .reverse()
      .map(
        artifact => `
          <div class="artifact-item">
            <div class="artifact-head">
              <strong class="mono">
                ${escapeHtml(
                  artifact.agent_id
                )}
              </strong>

              <span class="artifact-id">
                ${escapeHtml(
                  shortId(
                    artifact.artifact_id
                  )
                )}
              </span>
            </div>

            <div class="artifact-meta">
              ${escapeHtml(
                artifact.media_type
              )}
              · task
              ${escapeHtml(
                shortId(
                  artifact.task_id
                )
              )}
              · sha256
              ${escapeHtml(
                shortSha(
                  artifact.sha256
                )
              )}
            </div>
          </div>
        `
      )
      .join('');
}

function renderEvents(
  events
) {
  const root =
    $('events');

  if (
    !events?.length
  ) {
    root.innerHTML =
      '<div class="empty">No run events yet.</div>';

    return;
  }

  root.innerHTML =
    events
      .slice(
        -120
      )
      .reverse()
      .map(
        event => `
          <div class="event">
            <div class="event-agent">
              ${escapeHtml(
                event.agent_id ??
                'SYSTEM'
              )}
            </div>

            <div class="event-type">
              ${escapeHtml(
                event.type
              )}
            </div>

            <div>
              <div class="event-summary">
                ${escapeHtml(
                  event.summary
                )}
              </div>

              <div class="event-time">
                ${escapeHtml(
                  event.timestamp ??
                  ''
                )}
              </div>
            </div>
          </div>
        `
      )
      .join('');
}

function renderRun(
  run
) {
  if (!run) {
    return;
  }

  $('run-status')
    .textContent =
      run.status ?? '—';

  $('run-status')
    .className =
      `status-pill ${classForStatus(
        run.status
      )}`;

  $('run-adapter')
    .textContent =
      run.adapter ?? '—';

  $('run-commit')
    .textContent =
      shortSha(
        run.commit_sha
      );

  $('objective')
    .textContent =
      run.objective ??
      'No objective.';

  $('receipt-state')
    .textContent =
      run.receipt?.sealed
        ? 'SEALED'
        : 'UNSEALED';

  $('receipt-state')
    .className =
      `receipt-state ${
        run.receipt?.sealed
          ? 'good'
          : 'warn'
      }`;

  $('receipt-confidence')
    .textContent =
      run.receipt
        ?.confidence ??
      '—';

  $('receipt-hash')
    .textContent =
      run.receipt?.hash ??
      'No sealed receipt hash.';

  $('metric-known')
    .textContent =
      run.counts?.known ??
      0;

  $('metric-inferred')
    .textContent =
      run.counts?.inferred ??
      0;

  $('metric-evidence')
    .textContent =
      run.counts?.evidence ??
      0;

  $('metric-artifacts')
    .textContent =
      run.counts?.artifacts ??
      0;

  $('metric-uncertainty')
    .textContent =
      run.counts
        ?.uncertainties ??
      0;

  renderPipeline(
    run.stages
  );

  const analyst =
    run.analyst ?? {
      facts: [],
      hypotheses: [],
      uncertainties: [],
      next_actions: []
    };

  $('analyst-facts-count')
    .textContent =
      analyst.facts.length;

  $('analyst-hypotheses-count')
    .textContent =
      analyst.hypotheses
        .length;

  $('analyst-uncertainties-count')
    .textContent =
      analyst.uncertainties
        .length;

  const analystContent = [
    ...analyst.facts.map(
      value =>
        `FACT — ${value}`
    ),

    ...analyst.hypotheses.map(
      value =>
        `HYPOTHESIS — ${value}`
    ),

    ...analyst.uncertainties.map(
      value =>
        `UNCERTAINTY — ${value}`
    )
  ];

  renderList(
    $('analyst-content'),
    analystContent,
    'No Analyst artifact available for this run.'
  );

  renderVerification(
    run.verification
  );

  renderList(
    $('uncertainty'),
    run.uncertainty,
    'No preserved uncertainty.'
  );

  renderList(
    $('red-findings'),
    run.red_sink_findings,
    'No Red Sink findings.'
  );

  renderArtifacts(
    run.artifacts
  );

  renderEvents(
    run.events
  );
}

async function loadSelected() {
  if (
    !state.selectedRun
  ) {
    return;
  }

  const run =
    await api(
      `/api/runs/${encodeURIComponent(
        state.selectedRun
      )}`
    );

  renderRun(run);
}

function renderRunSelector() {
  const select =
    $('run-selector');

  const prior =
    state.selectedRun;

  select.innerHTML =
    state.runs
      .map(
        run => `
          <option
            value="${escapeHtml(
              run.run_id
            )}"
          >
            ${escapeHtml(
              shortId(
                run.run_id
              )
            )}
            ·
            ${escapeHtml(
              run.status
            )}
          </option>
        `
      )
      .join('');

  if (
    prior &&
    state.runs.some(
      run =>
        run.run_id === prior
    )
  ) {
    select.value =
      prior;
  }
}

async function refresh() {
  try {
    const runs =
      await api(
        '/api/runs'
      );

    state.runs =
      runs;

    if (
      !state.selectedRun &&
      runs.length
    ) {
      state.selectedRun =
        runs[0].run_id;
    }

    renderRunSelector();

    if (
      state.selectedRun
    ) {
      await loadSelected();
    }

    $('connection-dot')
      .className =
        'dot connected';

    $('connection-text')
      .textContent =
        'Runtime connected';
  } catch (
    error
  ) {
    $('connection-dot')
      .className =
        'dot error';

    $('connection-text')
      .textContent =
        error.message;
  }
}

async function updateRunControl() {
  const button =
    $('launch-run');

  try {
    const status =
      await api(
        '/api/run/status'
      );

    button.disabled =
      status.running;

    button.textContent =
      status.running
        ? 'RUNNING…'
        : 'RUN SINK CLONES';
  } catch {
    button.disabled =
      true;

    button.textContent =
      'RUN UNAVAILABLE';
  }
}

async function launchRun() {
  const button =
    $('launch-run');

  button.disabled =
    true;

  button.textContent =
    'LAUNCHING…';

  try {
    state.selectedRun =
      null;

    await api(
      '/api/run',
      {
        method:
          'POST'
      }
    );

    $('connection-text')
      .textContent =
        'Sink Clones executing';

    setTimeout(
      refresh,
      350
    );
  } catch (
    error
  ) {
    $('connection-text')
      .textContent =
        error.message;
  }

  setTimeout(
    updateRunControl,
    500
  );
}

$('run-selector')
  .addEventListener(
    'change',
    async event => {
      state.selectedRun =
        event.target.value;

      await loadSelected();
    }
  );

$('launch-run')
  .addEventListener(
    'click',
    launchRun
  );

await refresh();
await updateRunControl();

setInterval(
  async () => {
    if (
      state.selectedRun
    ) {
      try {
        const newest =
          await api(
            '/api/runs'
          );

        state.runs =
          newest;

        if (
          newest.length &&
          !state.runs.some(
            run =>
              run.run_id ===
              state.selectedRun
          )
        ) {
          state.selectedRun =
            newest[0].run_id;
        }

        renderRunSelector();
        await loadSelected();
      } catch {
        // Main refresh handles visible errors.
      }
    } else {
      await refresh();
    }

    await updateRunControl();
  },
  1000
);
