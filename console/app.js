const state = {
  runs: [],
  selectedRun: null,
  currentRun: null,
  selectedProofEntry: null
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

function proofKindClass(
  kind
) {
  if (kind === 'FACT') {
    return 'proof-fact';
  }

  if (kind === 'HYPOTHESIS') {
    return 'proof-hypothesis';
  }

  return 'proof-uncertainty';
}

function renderProofDetail(
  entry
) {
  const root =
    $('proof-detail');

  if (!entry) {
    root.innerHTML =
      '<div class="empty">Select a Blackboard entry.</div>';

    return;
  }

  const evidenceNodes =
    entry.evidence_nodes ?? [];

  const evidenceHtml =
    evidenceNodes.length
      ? evidenceNodes
          .map(
            node => {
              if (!node.found) {
                return `
                  <div class="proof-node broken-node">
                    <div class="proof-node-label">
                      BROKEN EVIDENCE EDGE
                    </div>

                    <div class="mono">
                      ${escapeHtml(
                        node.evidence_id
                      )}
                    </div>
                  </div>
                `;
              }

              return `
                <div class="proof-edge">
                  ↓
                </div>

                <div class="proof-node">
                  <div class="proof-node-label">
                    EVIDENCE
                  </div>

                  <div class="proof-node-title mono">
                    ${escapeHtml(
                      shortId(
                        node.evidence?.evidence_id
                      )
                    )}
                  </div>

                  <div class="proof-row">
                    <span>source</span>
                    <strong class="mono">
                      ${escapeHtml(
                        node.evidence?.source
                      )}
                    </strong>
                  </div>

                  <div class="proof-row">
                    <span>tool</span>
                    <strong class="mono">
                      ${escapeHtml(
                        node.evidence?.tool
                      )}
                    </strong>
                  </div>

                  <div class="proof-row">
                    <span>trust</span>
                    <strong>
                      ${escapeHtml(
                        node.evidence?.trust
                      )}
                    </strong>
                  </div>
                </div>

                <div class="proof-edge">
                  ↓
                </div>

                <div class="proof-node">
                  <div class="proof-node-label">
                    SOURCE ARTIFACT
                  </div>

                  ${
                    node.artifact
                      ? `
                        <div class="proof-node-title mono">
                          ${escapeHtml(
                            shortId(
                              node.artifact.artifact_id
                            )
                          )}
                        </div>

                        <div class="proof-row">
                          <span>agent</span>
                          <strong>
                            ${escapeHtml(
                              node.artifact.agent_id
                            )}
                          </strong>
                        </div>

                        <div class="proof-row">
                          <span>type</span>
                          <strong>
                            ${escapeHtml(
                              node.artifact.media_type
                            )}
                          </strong>
                        </div>

                        <div class="proof-row">
                          <span>sha256</span>
                          <strong class="mono">
                            ${escapeHtml(
                              shortSha(
                                node.artifact.sha256
                              )
                            )}
                          </strong>
                        </div>
                      `
                      : '<div class="bad">Missing artifact</div>'
                  }
                </div>

                <div class="proof-edge">
                  ↓
                </div>

                <div class="proof-node">
                  <div class="proof-node-label">
                    ORIGIN TASK
                  </div>

                  ${
                    node.task
                      ? `
                        <div class="proof-node-title">
                          ${escapeHtml(
                            node.task.assigned_agent
                          )}
                        </div>

                        <div class="proof-row">
                          <span>task</span>
                          <strong class="mono">
                            ${escapeHtml(
                              shortId(
                                node.task.task_id
                              )
                            )}
                          </strong>
                        </div>

                        <div class="proof-row">
                          <span>version</span>
                          <strong>
                            ${escapeHtml(
                              node.task.agent_version
                            )}
                          </strong>
                        </div>
                      `
                      : '<div class="bad">Missing task</div>'
                  }
                </div>
              `;
            }
          )
          .join('')
      : `
          <div class="proof-edge">
            ↓
          </div>

          <div class="proof-node">
            <div class="proof-node-label">
              NO EVIDENCE EDGE
            </div>

            <div class="subtle">
              This entry carries no evidence reference.
            </div>
          </div>
        `;

  root.innerHTML = `
    <div class="proof-node ${proofKindClass(
      entry.kind
    )}">
      <div class="proof-node-label">
        BLACKBOARD ENTRY
      </div>

      <div class="proof-node-title">
        ${escapeHtml(
          entry.kind
        )}
      </div>

      <div class="proof-statement">
        ${escapeHtml(
          entry.content
        )}
      </div>

      <div class="proof-row">
        <span>entry</span>
        <strong class="mono">
          ${escapeHtml(
            shortId(
              entry.entry_id
            )
          )}
        </strong>
      </div>
    </div>

    ${evidenceHtml}

    <div class="proof-edge">
      ↓
    </div>

    <div class="proof-node">
      <div class="proof-node-label">
        PINNED COMMIT
      </div>

      <div class="proof-node-title mono">
        ${escapeHtml(
          entry.pinned_commit ??
          '—'
        )}
      </div>
    </div>

    <div class="proof-edge">
      ↓
    </div>

    <div class="proof-node ${
      entry.receipt?.sealed
        ? 'sealed-node'
        : 'broken-node'
    }">
      <div class="proof-node-label">
        SEALED RECEIPT
      </div>

      <div class="proof-node-title">
        ${
          entry.receipt?.sealed
            ? 'SEALED'
            : 'UNSEALED'
        }
      </div>

      <div class="proof-row">
        <span>status</span>
        <strong>
          ${escapeHtml(
            entry.receipt?.final_status ??
            '—'
          )}
        </strong>
      </div>

      <div class="proof-row">
        <span>hash</span>
        <strong class="mono">
          ${escapeHtml(
            entry.receipt?.hash ??
            '—'
          )}
        </strong>
      </div>
    </div>

    ${
      entry.integrity
        ? `
          <div class="proof-integrity-result good">
            PROVENANCE CHAIN INTACT
          </div>
        `
        : `
          <div class="proof-integrity-result bad">
            BROKEN PROVENANCE
          </div>

          ${(entry.broken_references ?? [])
            .map(
              issue =>
                `<div class="verification-reason">${escapeHtml(
                  issue
                )}</div>`
            )
            .join('')}
        `
    }
  `;
}

function selectProofEntry(
  entryId
) {
  const entries =
    state.currentRun?.proof_graph ??
    [];

  state.selectedProofEntry =
    entryId;

  document
    .querySelectorAll(
      '.proof-entry'
    )
    .forEach(
      element => {
        element.classList.toggle(
          'selected',
          element.dataset.entryId ===
            entryId
        );
      }
    );

  renderProofDetail(
    entries.find(
      entry =>
        entry.entry_id ===
        entryId
    )
  );
}

function renderProofExplorer(
  run
) {
  const list =
    $('proof-entry-list');

  const entries =
    run?.proof_graph ??
    [];

  const integrity =
    run?.proof_integrity ?? {
      total: 0,
      intact: 0,
      broken: 0
    };

  $('proof-integrity')
    .innerHTML = `
      <span class="${
        integrity.broken === 0
          ? 'good'
          : 'bad'
      }">
        ${integrity.intact}/${integrity.total} INTACT
      </span>
    `;

  if (!entries.length) {
    list.innerHTML =
      '<div class="empty">No sealed Blackboard proof graph available.</div>';

    renderProofDetail(
      null
    );

    return;
  }

  list.innerHTML =
    entries
      .map(
        entry => `
          <button
            type="button"
            class="proof-entry ${proofKindClass(
              entry.kind
            )}"
            data-entry-id="${escapeHtml(
              entry.entry_id
            )}"
          >
            <div class="proof-entry-top">
              <span>
                ${escapeHtml(
                  entry.kind
                )}
              </span>

              <span class="${
                entry.integrity
                  ? 'good'
                  : 'bad'
              }">
                ${
                  entry.integrity
                    ? 'INTACT'
                    : 'BROKEN'
                }
              </span>
            </div>

            <div class="proof-entry-content">
              ${escapeHtml(
                entry.content
              )}
            </div>

            <div class="proof-entry-meta">
              ${
                entry.evidence_ids
                  ?.length ?? 0
              } evidence edge(s)
            </div>
          </button>
        `
      )
      .join('');

  list
    .querySelectorAll(
      '.proof-entry'
    )
    .forEach(
      button => {
        button.addEventListener(
          'click',
          () => {
            selectProofEntry(
              button.dataset.entryId
            );
          }
        );
      }
    );

  const desired =
    entries.find(
      entry =>
        entry.entry_id ===
        state.selectedProofEntry
    )
      ? state.selectedProofEntry
      : entries[0].entry_id;

  selectProofEntry(
    desired
  );
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

  state.currentRun =
    run;

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

  renderProofExplorer(
    run
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
