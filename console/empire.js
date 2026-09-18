const AGENTS = [
  {
    id: 'SINK-PRIME',
    name: 'The Throne',
    role: 'Operator Authority',
    icon: '♛',
    district: 'throne'
  },
  {
    id: 'SINK-00',
    name: 'Command Tower',
    role: 'Commander',
    icon: '◈',
    district: 'command'
  },
  {
    id: 'SINK-01',
    name: 'Scout Archive',
    role: 'Scout',
    icon: '⌖',
    district: 'scout'
  },
  {
    id: 'SINK-04',
    name: 'Growth Quarter',
    role: 'Revenue Scout',
    icon: '◇',
    district: 'growth'
  },
  {
    id: 'SINK-05',
    name: 'Analysis Observatory',
    role: 'Analyst',
    icon: '⌬',
    district: 'analysis'
  },
  {
    id: 'SINK-02',
    name: 'The Forge',
    role: 'Builder',
    icon: '⚒',
    district: 'forge'
  },
  {
    id: 'SINK-03',
    name: 'Audit Court',
    role: 'Auditor',
    icon: '⚖',
    district: 'court'
  },
  {
    id: 'RED-SINK',
    name: 'The Red Keep',
    role: 'Adversarial Verifier',
    icon: '◆',
    district: 'red'
  },
  {
    id: 'SINK-06',
    name: 'Mining District',
    role: 'Miner',
    icon: '⛏',
    district: 'mining'
  }
];

const ACTIVE_TASKS = new Set([
  'RUNNING',
  'VERIFYING',
  'WAITING_ON_DEPENDENCY'
]);

const EVENT_STATES = {
  TOOL_REQUESTED: 'WORKING',
  TOOL_COMPLETED: 'RETURNING',
  EVIDENCE_ATTACHED: 'CARRYING EVIDENCE',
  ARTIFACT_CREATED: 'BUILDING',
  BLACKBOARD_ENTRY_CREATED: 'ANALYSING',
  AUDIT_STARTED: 'AUDITING',
  AUDIT_PASSED: 'AUDIT PASSED',
  AUDIT_FAILED: 'AUDIT FAILED',
  RED_SINK_COMPLETED: 'CHALLENGE COMPLETE',
  RUN_COMPLETED: 'COMPLETE',
  RUN_FAILED: 'FAILED',
  APPROVAL_REQUESTED: 'WAITING FOR THRONE'
};

let selectedAgent = 'SINK-04';
let lastSignature = '';

const motion = {
  replaying: false,
  replayRunId: null,
  lastSeenEvents: new Map(),
  previousAgent: null
};

const MOTION_EVENT_TYPES = new Set([
  'AGENT_ASSIGNED',
  'TOOL_REQUESTED',
  'TOOL_COMPLETED',
  'EVIDENCE_ATTACHED',
  'ARTIFACT_CREATED',
  'BLACKBOARD_ENTRY_CREATED',
  'AUDIT_STARTED',
  'AUDIT_PASSED',
  'AUDIT_FAILED',
  'RED_SINK_COMPLETED',
  'APPROVAL_REQUESTED',
  'RUN_COMPLETED',
  'RUN_FAILED'
]);

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value) {
  return new Intl.NumberFormat(
    'en-AU',
    {
      style: 'currency',
      currency: 'AUD',
      maximumFractionDigits: 0
    }
  ).format(Number(value ?? 0));
}

function short(value) {
  if (!value) return '—';
  return String(value).slice(0, 8);
}

function appState() {
  return window.__SINK_STATE__ ?? {
    runs: [],
    currentRun: null
  };
}

function taskFor(run, id) {
  return run?.tasks?.find(
    task =>
      task.assigned_agent === id
  ) ?? null;
}

function eventsFor(run, id) {
  return (run?.events ?? [])
    .filter(
      event =>
        event.agent_id === id
    );
}

function latestEvent(run, id) {
  return eventsFor(run, id).at(-1) ?? null;
}

function evidenceFor(run, id) {
  return (run?.evidence ?? [])
    .filter(
      evidence =>
        evidence.agent_id === id
    );
}

function artifactsFor(run, id) {
  return (run?.artifacts ?? [])
    .filter(
      artifact =>
        artifact.agent_id === id
    );
}

function toolFor(run, id) {
  const events =
    eventsFor(run, id)
      .filter(
        event =>
          event.type === 'TOOL_REQUESTED'
      );

  const latest = events.at(-1);

  if (!latest) return '—';

  return String(
    latest.summary ?? '—'
  ).split(':')[0];
}

function agentState(run, id) {
  if (id === 'SINK-PRIME') {
    const pending =
      (run?.approvals ?? [])
        .filter(
          approval =>
            approval.status === 'PENDING'
        );

    return pending.length
      ? 'AUTHORITY REQUIRED'
      : 'WATCHING';
  }

  const task = taskFor(run, id);

  if (!task) return 'IDLE';

  if (task.status === 'FAILED') {
    return 'FAILED';
  }

  if (task.status === 'BLOCKED') {
    return 'BLOCKED';
  }

  if (task.status === 'COMPLETED') {
    return 'COMPLETE';
  }

  const event =
    latestEvent(run, id);

  if (event?.type) {
    return EVENT_STATES[
      event.type
    ] ?? task.status;
  }

  return task.status;
}

function isWorking(run, id) {
  const task = taskFor(run, id);

  return !!task &&
    ACTIVE_TASKS.has(
      task.status
    );
}

function currentWorkingAgent(run) {
  const live =
    (run?.tasks ?? [])
      .find(
        task =>
          ACTIVE_TASKS.has(
            task.status
          )
      );

  return live?.assigned_agent ?? null;
}

function pipelineValue(run) {
  const opportunities =
    run?.revenue_ledger
      ?.opportunities ?? [];

  return opportunities.reduce(
    (sum, item) =>
      sum +
      Number(
        item.proposed_price_aud ?? 0
      ),
    0
  );
}

function insertEmpire() {
  if (
    document.getElementById(
      'sink-empire'
    )
  ) {
    return;
  }

  const runStrip =
    document.querySelector(
      '.run-strip'
    );

  if (!runStrip) {
    return;
  }

  const section =
    document.createElement(
      'section'
    );

  section.id =
    'sink-empire';

  section.className =
    'empire-shell';

  section.innerHTML = `
    <div class="empire-header">
      <div>
        <div class="empire-kicker">
          SINK EMPIRE / LIVE REALM
        </div>

        <h2 class="empire-title">
          The Kingdom
        </h2>

        <div
          id="empire-mission"
          class="empire-subtitle"
        >
          Waiting for runtime state.
        </div>
      </div>

      <div class="empire-runtime-controls">
        <button
          id="empire-replay"
          class="empire-replay-button"
          type="button"
        >
          REPLAY MISSION
        </button>

        <div class="empire-live">
          <span class="empire-live-dot"></span>
          <span id="empire-live-label">RUNTIME BOUND</span>
        </div>
      </div>
    </div>

    <div class="empire-layout">

      <div class="empire-world-wrap">

        <div class="empire-world">

          <div class="empire-sky">
            <div class="empire-eye">◉</div>
            <div class="empire-eye-label">
              SINK EMPIRE
            </div>
          </div>

          <svg
            class="empire-roads"
            viewBox="0 0 1000 700"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M500 80 L500 170" />
            <path d="M500 220 L270 320" />
            <path d="M500 220 L500 320" />
            <path d="M500 220 L730 320" />
            <path d="M270 390 L500 470" />
            <path d="M500 390 L500 470" />
            <path d="M730 390 L500 470" />
            <path d="M500 530 L300 620" />
            <path d="M500 530 L700 620" />
          </svg>

          <div
            id="empire-districts"
            class="empire-districts"
          ></div>

          <div
            id="empire-motion-layer"
            class="empire-motion-layer"
            aria-hidden="true"
          ></div>

          <div
            id="empire-event-caption"
            class="empire-event-caption"
          >
            REALM IDLE
          </div>

          <div
            id="empire-route"
            class="empire-route"
          ></div>

        </div>

      </div>

      <aside class="empire-sidebar">

        <section class="empire-panel">
          <div class="empire-panel-label">
            SELECTED CLONE
          </div>

          <div
            id="empire-agent-detail"
            class="empire-agent-detail"
          ></div>
        </section>

        <section class="empire-panel empire-treasury">
          <div class="empire-panel-label">
            TREASURY
          </div>

          <div
            id="empire-treasury"
          ></div>
        </section>

        <section class="empire-panel">
          <div class="empire-panel-label">
            EMPIRE LEDGER
          </div>

          <div
            id="empire-ledger"
            class="empire-ledger"
          ></div>
        </section>

        <section class="empire-panel">
          <div class="empire-panel-label">
            THRONE REQUESTS
          </div>

          <div
            id="empire-approvals"
          ></div>
        </section>

      </aside>

    </div>
  `;

  runStrip.insertAdjacentElement(
    'afterend',
    section
  );
}

function renderDistricts(run) {
  const root =
    document.getElementById(
      'empire-districts'
    );

  if (!root) return;

  const active =
    currentWorkingAgent(run);

  root.innerHTML =
    AGENTS.map(
      agent => {
        const task =
          taskFor(
            run,
            agent.id
          );

        const state =
          agentState(
            run,
            agent.id
          );

        const working =
          isWorking(
            run,
            agent.id
          );

        const selected =
          selectedAgent ===
          agent.id;

        const evidence =
          evidenceFor(
            run,
            agent.id
          ).length;

        return `
          <button
            class="
              empire-district
              district-${esc(agent.district)}
              ${working ? 'is-working' : ''}
              ${active === agent.id ? 'is-active' : ''}
              ${selected ? 'is-selected' : ''}
              ${state === 'FAILED' ? 'is-failed' : ''}
            "
            data-agent="${esc(agent.id)}"
            type="button"
          >
            <div class="empire-building">
              <div class="empire-building-top"></div>
              <div class="empire-building-face">
                <span class="empire-building-icon">
                  ${esc(agent.icon)}
                </span>
              </div>
            </div>

            <div
              class="
                empire-robot
                ${working ? 'robot-working' : ''}
                ${evidence ? 'has-evidence' : ''}
              "
            >
              <div class="robot-head">
                <span></span>
                <span></span>
              </div>

              <div class="robot-body">
                ${evidence
                  ? `<div class="evidence-cube">${evidence}</div>`
                  : ''
                }
              </div>
            </div>

            <div class="district-copy">
              <strong>
                ${esc(agent.name)}
              </strong>

              <span>
                ${esc(agent.id)}
              </span>

              <small>
                ${esc(state)}
              </small>
            </div>

            ${
              task
                ? `<div class="district-task">
                    ${esc(task.status)}
                  </div>`
                : ''
            }
          </button>
        `;
      }
    ).join('');

  root.querySelectorAll(
    '[data-agent]'
  ).forEach(
    button => {
      button.addEventListener(
        'click',
        () => {
          selectedAgent =
            button.dataset.agent;

          renderEmpire();
        }
      );
    }
  );
}

function renderAgentDetail(run) {
  const root =
    document.getElementById(
      'empire-agent-detail'
    );

  if (!root) return;

  const agent =
    AGENTS.find(
      item =>
        item.id ===
        selectedAgent
    ) ?? AGENTS[0];

  const task =
    taskFor(
      run,
      agent.id
    );

  const evidence =
    evidenceFor(
      run,
      agent.id
    );

  const artifacts =
    artifactsFor(
      run,
      agent.id
    );

  root.innerHTML = `
    <div class="selected-agent-head">
      <div class="selected-agent-symbol">
        ${esc(agent.icon)}
      </div>

      <div>
        <strong>
          ${esc(agent.id)}
        </strong>

        <div>
          ${esc(agent.role)}
        </div>
      </div>
    </div>

    <div class="agent-state-large">
      ${esc(
        agentState(
          run,
          agent.id
        )
      )}
    </div>

    <div class="empire-detail-grid">
      <span>MISSION</span>
      <strong>
        ${esc(
          task?.objective ??
          'No active assignment.'
        )}
      </strong>

      <span>TOOL</span>
      <strong class="mono">
        ${esc(
          toolFor(
            run,
            agent.id
          )
        )}
      </strong>

      <span>EVIDENCE</span>
      <strong>
        ${evidence.length}
      </strong>

      <span>ARTIFACTS</span>
      <strong>
        ${artifacts.length}
      </strong>

      <span>OUTBOUND</span>
      <strong>
        ${
          agent.id === 'SINK-04'
            ? 'LOCKED'
            : '—'
        }
      </strong>
    </div>
  `;
}

function renderTreasury(run) {
  const root =
    document.getElementById(
      'empire-treasury'
    );

  if (!root) return;

  const ledger =
    run?.revenue_ledger;

  const gross =
    ledger?.gross_revenue_aud ?? 0;

  const net =
    ledger?.net_cash_aud ?? 0;

  const customers =
    ledger?.customers_won ?? 0;

  const actions =
    ledger?.actions_taken ?? 0;

  const pipeline =
    pipelineValue(run);

  root.innerHTML = `
    <div class="treasury-vault">
      <div class="vault-door">
        <span>◈</span>
      </div>

      <div>
        <div class="vault-label">
          VERIFIED NET CASH
        </div>

        <div class="vault-value">
          ${money(net)}
        </div>
      </div>
    </div>

    <div class="treasury-grid">
      <div>
        <span>GROSS VERIFIED</span>
        <strong>${money(gross)}</strong>
      </div>

      <div>
        <span>PIPELINE HYPOTHESIS</span>
        <strong>${money(pipeline)}</strong>
      </div>

      <div>
        <span>CUSTOMERS WON</span>
        <strong>${customers}</strong>
      </div>

      <div>
        <span>ACTIONS EXECUTED</span>
        <strong>${actions}</strong>
      </div>
    </div>

    <div class="treasury-warning">
      Pipeline value is not revenue.
    </div>
  `;
}

function renderLedger() {
  const root =
    document.getElementById(
      'empire-ledger'
    );

  if (!root) return;

  const runs =
    appState()
      .runs
      ?.filter(
        run =>
          run.status ===
          'COMPLETED'
      )
      .slice(0, 6) ?? [];

  if (!runs.length) {
    root.innerHTML =
      '<div class="empire-empty">No sealed realm blocks yet.</div>';

    return;
  }

  root.innerHTML =
    runs.map(
      (run, index) => `
        <div class="ledger-block">
          <div class="ledger-index">
            BLOCK ${String(index + 1).padStart(3, '0')}
          </div>

          <strong>
            ${esc(
              run.workflow ??
              'mission'
            )}
          </strong>

          <span class="mono">
            ${short(
              run.run_id
            )}
          </span>

          <span>
            ${esc(
              run.status
            )}
          </span>
        </div>
      `
    ).join('');
}

function renderApprovals(run) {
  const root =
    document.getElementById(
      'empire-approvals'
    );

  if (!root) return;

  const pending =
    (run?.approvals ?? [])
      .filter(
        approval =>
          approval.status ===
          'PENDING'
      );

  if (!pending.length) {
    root.innerHTML = `
      <div class="empire-empty">
        The Throne is not required.
      </div>
    `;

    return;
  }

  root.innerHTML =
    pending.map(
      approval => `
        <div class="throne-request">
          <strong>
            ${esc(
              approval.agent_id
            )}
          </strong>

          <div>
            Requests authority for
            <span class="mono">
              ${esc(
                approval.tool
              )}
            </span>
          </div>

          <small>
            ${esc(
              approval.status
            )}
          </small>
        </div>
      `
    ).join('');
}

function renderRoute(run) {
  const root =
    document.getElementById(
      'empire-route'
    );

  if (!root) return;

  const tasks =
    run?.tasks ?? [];

  if (!tasks.length) {
    root.innerHTML =
      '<span>REALM IDLE</span>';

    return;
  }

  root.innerHTML =
    tasks.map(
      (task, index) => `
        ${index ? '<i>→</i>' : ''}
        <span class="${ACTIVE_TASKS.has(task.status) ? 'route-active' : ''}">
          ${esc(
            task.assigned_agent
          )}
        </span>
      `
    ).join('');
}


function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}

function eventAgent(event) {
  if (
    event?.type === 'RUN_COMPLETED' ||
    event?.type === 'RUN_FAILED'
  ) {
    return 'SINK-00';
  }

  return event?.agent_id ?? null;
}

function eventLabel(event) {
  const labels = {
    AGENT_ASSIGNED:
      'Agent assigned',
    TOOL_REQUESTED:
      'Tool requested',
    TOOL_COMPLETED:
      'Tool completed',
    EVIDENCE_ATTACHED:
      'Evidence acquired',
    ARTIFACT_CREATED:
      'Artifact created',
    BLACKBOARD_ENTRY_CREATED:
      'Analysis recorded',
    AUDIT_STARTED:
      'Audit started',
    AUDIT_PASSED:
      'Audit passed',
    AUDIT_FAILED:
      'Audit failed',
    RED_SINK_COMPLETED:
      'Adversarial review complete',
    APPROVAL_REQUESTED:
      'Authority requested',
    RUN_COMPLETED:
      'Mission complete',
    RUN_FAILED:
      'Mission failed'
  };

  return labels[event?.type] ??
    event?.type ??
    'Runtime event';
}

function packetClass(event) {
  switch (event?.type) {
    case 'EVIDENCE_ATTACHED':
      return 'packet-evidence';

    case 'ARTIFACT_CREATED':
      return 'packet-artifact';

    case 'AUDIT_FAILED':
    case 'RUN_FAILED':
      return 'packet-failure';

    case 'AUDIT_PASSED':
    case 'RUN_COMPLETED':
      return 'packet-success';

    case 'APPROVAL_REQUESTED':
      return 'packet-authority';

    default:
      return 'packet-runtime';
  }
}

function districtElement(agentId) {
  return document.querySelector(
    `[data-agent="${CSS.escape(agentId)}"]`
  );
}

function worldPoint(element) {
  const world =
    document.querySelector(
      '.empire-world'
    );

  if (!world || !element) {
    return null;
  }

  const w =
    world.getBoundingClientRect();

  const r =
    element.getBoundingClientRect();

  return {
    x:
      r.left -
      w.left +
      r.width / 2,

    y:
      r.top -
      w.top +
      r.height / 2
  };
}

function setEventCaption(
  event,
  agentId
) {
  const root =
    document.getElementById(
      'empire-event-caption'
    );

  if (!root) return;

  root.innerHTML = `
    <strong>${esc(agentId ?? 'SYSTEM')}</strong>
    <span>${esc(eventLabel(event))}</span>
    <small>${esc(event?.summary ?? '')}</small>
  `;
}

function pulseDistrict(
  agentId,
  event
) {
  const node =
    districtElement(agentId);

  if (!node) return;

  node.classList.add(
    'runtime-event-active'
  );

  if (
    event?.type === 'AUDIT_PASSED' ||
    event?.type === 'RUN_COMPLETED'
  ) {
    node.classList.add(
      'runtime-event-success'
    );
  }

  if (
    event?.type === 'AUDIT_FAILED' ||
    event?.type === 'RUN_FAILED'
  ) {
    node.classList.add(
      'runtime-event-failure'
    );
  }

  setTimeout(
    () => {
      node.classList.remove(
        'runtime-event-active',
        'runtime-event-success',
        'runtime-event-failure'
      );
    },
    950
  );
}

async function animateEvent(
  event,
  previousAgent = null
) {
  if (
    !MOTION_EVENT_TYPES.has(
      event?.type
    )
  ) {
    return;
  }

  const agentId =
    eventAgent(event);

  if (!agentId) return;

  setEventCaption(
    event,
    agentId
  );

  pulseDistrict(
    agentId,
    event
  );

  const layer =
    document.getElementById(
      'empire-motion-layer'
    );

  const destination =
    districtElement(agentId);

  if (
    !layer ||
    !destination
  ) {
    return;
  }

  const to =
    worldPoint(destination);

  if (!to) return;

  let from = to;

  if (
    previousAgent &&
    previousAgent !== agentId
  ) {
    const source =
      districtElement(
        previousAgent
      );

    const point =
      worldPoint(source);

    if (point) {
      from = point;
    }
  }

  const packet =
    document.createElement(
      'div'
    );

  packet.className =
    `empire-packet ${packetClass(event)}`;

  packet.innerHTML =
    event.type ===
      'EVIDENCE_ATTACHED'
      ? '▣'
      : event.type ===
          'ARTIFACT_CREATED'
        ? '◆'
        : event.type ===
            'APPROVAL_REQUESTED'
          ? '♛'
          : '●';

  packet.style.left =
    `${from.x}px`;

  packet.style.top =
    `${from.y}px`;

  layer.appendChild(packet);

  const dx =
    to.x - from.x;

  const dy =
    to.y - from.y;

  const animation =
    packet.animate(
      [
        {
          transform:
            'translate(-50%, -50%) scale(.7)',
          opacity: .25
        },
        {
          transform:
            `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - 18}px)) scale(1.18)`,
          opacity: 1,
          offset: .5
        },
        {
          transform:
            `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.82)`,
          opacity: .8
        }
      ],
      {
        duration:
          previousAgent &&
          previousAgent !== agentId
            ? 700
            : 430,

        easing:
          'cubic-bezier(.22,.75,.2,1)',

        fill:
          'forwards'
      }
    );

  try {
    await animation.finished;
  } catch {
    // Visual interruption does not affect runtime state.
  }

  packet.remove();
}

async function replayMission() {
  if (motion.replaying) {
    return;
  }

  const state =
    appState();

  const run =
    state.currentRun ??
    state.runs?.[0];

  if (!run?.events?.length) {
    return;
  }

  motion.replaying = true;
  motion.replayRunId =
    run.run_id;

  const button =
    document.getElementById(
      'empire-replay'
    );

  const label =
    document.getElementById(
      'empire-live-label'
    );

  if (button) {
    button.disabled = true;
    button.textContent =
      'REPLAYING...';
  }

  if (label) {
    label.textContent =
      'EVENT REPLAY';
  }

  const events =
    [...run.events]
      .filter(
        event =>
          MOTION_EVENT_TYPES.has(
            event.type
          )
      )
      .sort(
        (a, b) =>
          Date.parse(a.timestamp ?? 0) -
          Date.parse(b.timestamp ?? 0)
      );

  let previous = null;
  let previousTime = null;

  for (const event of events) {
    if (!motion.replaying) {
      break;
    }

    const currentTime =
      Date.parse(
        event.timestamp ?? 0
      );

    let pause = 260;

    if (
      previousTime !== null &&
      Number.isFinite(currentTime)
    ) {
      const actualDelta =
        Math.max(
          0,
          currentTime -
          previousTime
        );

      pause =
        Math.min(
          900,
          Math.max(
            180,
            actualDelta / 20
          )
        );
    }

    await sleep(pause);

    await animateEvent(
      event,
      previous
    );

    previous =
      eventAgent(event) ??
      previous;

    previousTime =
      currentTime;
  }

  motion.replaying = false;
  motion.replayRunId = null;

  if (button) {
    button.disabled = false;
    button.textContent =
      'REPLAY MISSION';
  }

  if (label) {
    label.textContent =
      'RUNTIME BOUND';
  }

  const caption =
    document.getElementById(
      'empire-event-caption'
    );

  if (caption) {
    caption.textContent =
      'REPLAY COMPLETE';
  }
}

function observeLiveEvents(run) {
  if (
    !run ||
    motion.replaying
  ) {
    return;
  }

  const events =
    run.events ?? [];

  const id =
    run.run_id;

  if (
    !motion.lastSeenEvents.has(id)
  ) {
    motion.lastSeenEvents.set(
      id,
      events.length
    );

    return;
  }

  const previousCount =
    motion.lastSeenEvents.get(id) ?? 0;

  if (
    events.length <=
    previousCount
  ) {
    return;
  }

  const fresh =
    events.slice(
      previousCount
    );

  motion.lastSeenEvents.set(
    id,
    events.length
  );

  void (async () => {
    let previous =
      motion.previousAgent;

    for (const event of fresh) {
      if (
        !MOTION_EVENT_TYPES.has(
          event.type
        )
      ) {
        continue;
      }

      await animateEvent(
        event,
        previous
      );

      previous =
        eventAgent(event) ??
        previous;
    }

    motion.previousAgent =
      previous;
  })();
}

function renderEmpire() {
  insertEmpire();

  const state =
    appState();

  const run =
    state.currentRun ??
    state.runs?.[0] ??
    null;

  const mission =
    document.getElementById(
      'empire-mission'
    );

  if (mission) {
    mission.textContent =
      run
        ? `${run.workflow ?? 'MISSION'} // ${run.objective ?? 'No objective'}`
        : 'No active realm loaded.';
  }

  renderDistricts(run);
  renderAgentDetail(run);
  renderTreasury(run);
  renderLedger();
  renderApprovals(run);
  renderRoute(run);
}

function signature() {
  const state =
    appState();

  const run =
    state.currentRun ??
    state.runs?.[0];

  return JSON.stringify({
    selected:
      state.selectedRun,
    id:
      run?.run_id,
    status:
      run?.status,
    events:
      run?.events?.length,
    evidence:
      run?.evidence?.length,
    artifacts:
      run?.artifacts?.length,
    verification:
      run?.verification?.length,
    ledger:
      run?.revenue_ledger?.updated_at
  });
}

function tickEmpire() {
  const state =
    appState();

  const run =
    state.currentRun ??
    state.runs?.[0] ??
    null;

  observeLiveEvents(run);

  const next =
    signature();

  if (
    next !== lastSignature
  ) {
    lastSignature = next;
    renderEmpire();
  }
}

insertEmpire();
renderEmpire();

document
  .getElementById('empire-replay')
  ?.addEventListener(
    'click',
    () => {
      void replayMission();
    }
  );

/*
 * Animation is visual only.
 * State changes occur solely when Mission Control data changes.
 */
setInterval(
  tickEmpire,
  450
);
