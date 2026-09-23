(() => {
  'use strict';

  const AGENTS = {
    'SINK-04': {
      role: 'Prospector',
      x: 18,
      y: 28
    },
    'SINK-05': {
      role: 'Economist',
      x: 50,
      y: 28
    },
    'SINK-03': {
      role: 'Auditor',
      x: 50,
      y: 70
    },
    'RED-SINK': {
      role: 'Adversary',
      x: 82,
      y: 70
    }
  };

  const motion = {
    lastRunId: null,
    seenEvents: 0,
    signal: null,
    signalTimer: null
  };

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getRun() {
    const state = window.__SINK_STATE__;

    if (!state) {
      return null;
    }

    return (
      state.currentRun ??
      state.selectedRun ??
      null
    );
  }

  function isGoldRush(run) {
    return run?.workflow === 'gold-rush';
  }

  function parseJsonArtifact(artifact) {
    if (
      artifact?.media_type !== 'application/json' ||
      typeof artifact?.content !== 'string'
    ) {
      return null;
    }

    try {
      return JSON.parse(artifact.content);
    } catch {
      return null;
    }
  }

  function isLedger(value) {
    return (
      value &&
      value.schema_version === '1.0.0' &&
      value.currency === 'AUD' &&
      Array.isArray(value.opportunities) &&
      Number.isInteger(value.discovered) &&
      Number.isInteger(value.source_verified) &&
      Number.isInteger(value.actionable) &&
      typeof value.realized_value_aud === 'number'
    );
  }

  function findLedger(run) {
    const artifacts = run?.artifacts ?? [];

    // Truth priority:
    // final RED-SINK ledger > SINK-05 provisional > SINK-04 discovery.
    const order = [
      'RED-SINK',
      'SINK-05',
      'SINK-04'
    ];

    for (const agentId of order) {
      const candidates = artifacts
        .filter(
          artifact =>
            artifact.agent_id === agentId &&
            artifact.media_type === 'application/json'
        )
        .map(artifact => ({
          artifact,
          value: parseJsonArtifact(artifact)
        }))
        .filter(entry => isLedger(entry.value));

      if (candidates.length) {
        return candidates.at(-1).value;
      }
    }

    return null;
  }

  function taskFor(run, agentId) {
    return (
      (run?.tasks ?? []).find(
        task =>
          task.assigned_agent === agentId
      ) ?? null
    );
  }

  function agentStatus(run, agentId) {
    const task = taskFor(run, agentId);

    if (!task) {
      return 'WAITING';
    }

    return task.status ?? 'UNKNOWN';
  }

  function isWorkingStatus(status) {
    return [
      'RUNNING',
      'VERIFYING',
      'ASSIGNED'
    ].includes(status);
  }

  function isCompleteStatus(status) {
    return status === 'COMPLETED';
  }

  function activeAgentFromRun(run) {
    const events = run?.events ?? [];

    for (
      let index = events.length - 1;
      index >= 0;
      index -= 1
    ) {
      const agent = events[index]?.agent_id;

      if (AGENTS[agent]) {
        return agent;
      }
    }

    for (const agentId of Object.keys(AGENTS)) {
      if (isWorkingStatus(agentStatus(run, agentId))) {
        return agentId;
      }
    }

    return null;
  }

  function eventTime(event) {
    const raw =
      event?.created_at ??
      event?.timestamp ??
      event?.at ??
      '';

    const date = new Date(raw);

    if (Number.isNaN(date.getTime())) {
      return '--:--:--';
    }

    return date.toLocaleTimeString(
      [],
      {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }
    );
  }

  function eventMessage(event) {
    return (
      event?.message ??
      event?.detail ??
      event?.event ??
      event?.type ??
      'runtime event'
    );
  }

  function normalizeOpportunity(entry) {
    if (!entry) {
      return null;
    }

    // Final ledgers currently rank as { opportunity, economics }.
    if (entry.opportunity) {
      return {
        ...entry.opportunity,
        economics:
          entry.economics ??
          entry.opportunity.economics ??
          null
      };
    }

    return entry;
  }

  function opportunities(ledger) {
    return (ledger?.opportunities ?? [])
      .map(normalizeOpportunity)
      .filter(Boolean);
  }

  function moneyRange(ledger) {
    const range =
      ledger?.estimated_attainable_value_aud;

    if (!range) {
      return 'UNKNOWN';
    }

    const low = Number(range.low ?? 0);
    const high = Number(range.high ?? 0);

    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      return 'UNKNOWN';
    }

    if (low === high) {
      return `A$${Math.round(low).toLocaleString()}`;
    }

    return `A$${Math.round(low).toLocaleString()}–${Math.round(high).toLocaleString()}`;
  }

  function currentOpportunity(ledger) {
    const items = opportunities(ledger);

    return (
      items.find(item => item.actionable) ??
      items.find(item => item.source_verified) ??
      items[0] ??
      null
    );
  }

  function opportunityName(item) {
    return (
      item?.title ??
      item?.name ??
      item?.provider ??
      item?.canonical_key ??
      'Opportunity'
    );
  }

  function gate(value, unknown = 'UNKNOWN') {
    if (value === true) {
      return {
        text: 'PASS',
        cls: 'good'
      };
    }

    if (value === false) {
      return {
        text: 'NO',
        cls: 'bad'
      };
    }

    return {
      text: unknown,
      cls: 'warn'
    };
  }

  function ensureShell() {
    let root =
      document.getElementById(
        'gold-rush-shell'
      );

    if (root) {
      return root;
    }

    root = document.createElement('section');
    root.id = 'gold-rush-shell';
    root.className = 'gold-rush-shell';

    const main =
      document.querySelector('main');

    if (main) {
      main.prepend(root);
    } else {
      document.body.appendChild(root);
    }

    return root;
  }

  function networkHtml(run) {
    return Object.entries(AGENTS)
      .map(([id, meta]) => {
        const status =
          agentStatus(run, id);

        const classes = [
          'gr-agent',
          isWorkingStatus(status)
            ? 'is-working'
            : '',
          isCompleteStatus(status)
            ? 'is-complete'
            : ''
        ]
          .filter(Boolean)
          .join(' ');

        return `
          <div
            class="${classes}"
            data-agent="${esc(id)}"
          >
            <div class="gr-agent-core"></div>

            <div class="gr-agent-id">
              ${esc(id)}
            </div>

            <div class="gr-agent-role">
              ${esc(meta.role)}
            </div>

            <div class="gr-agent-state">
              ${esc(status)}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function oreHtml(ledger) {
    const items =
      opportunities(ledger)
        .slice(0, 14);

    if (!items.length) {
      return `
        <div class="gr-empty">
          No persisted opportunities yet.
        </div>
      `;
    }

    return items
      .map(item => {
        let cls = '';

        if (item.actionable) {
          cls = 'actionable';
        } else if (item.source_verified) {
          cls = 'verified';
        } else if (
          item.state === 'REJECTED' ||
          item.state === 'EXPIRED'
        ) {
          cls = 'rejected';
        }

        const symbol =
          cls === 'actionable'
            ? '★'
            : cls === 'verified'
              ? '◆'
              : cls === 'rejected'
                ? '×'
                : '◇';

        return `
          <div
            class="gr-ore ${cls}"
            title="${esc(opportunityName(item))}"
          >
            ${symbol}
            ${esc(opportunityName(item))}
          </div>
        `;
      })
      .join('');
  }

  function feedHtml(run) {
    const events =
      [...(run?.events ?? [])]
        .slice(-18)
        .reverse();

    if (!events.length) {
      return `
        <div class="gr-empty">
          Waiting for persisted runtime events.
        </div>
      `;
    }

    return events
      .map(event => `
        <div class="gr-feed-row">
          <span class="gr-feed-time">
            ${esc(eventTime(event))}
          </span>

          <span class="gr-feed-agent">
            ${esc(event.agent_id ?? 'SYSTEM')}
          </span>

          <span class="gr-feed-message">
            ${esc(eventMessage(event))}
          </span>
        </div>
      `)
      .join('');
  }

  function currentHtml(ledger) {
    const item =
      currentOpportunity(ledger);

    if (!item) {
      return `
        <div class="gr-empty">
          No candidate has entered the ledger yet.
        </div>
      `;
    }

    const authority =
      gate(
        item.authorization_explicit ??
        item.authority_verified
      );

    const source =
      gate(item.source_verified);

    const audit =
      gate(item.audit_passed);

    const red =
      gate(item.red_team_passed);

    const actionable =
      gate(item.actionable);

    return `
      <div class="gr-current">
        <div class="gr-current-name">
          ${esc(opportunityName(item))}
        </div>

        <div class="gr-current-category">
          ${esc(item.category ?? 'UNKNOWN CATEGORY')}
        </div>

        <div class="gr-gates">
          ${gateRow('SOURCE', source)}
          ${gateRow('AUTHORITY', authority)}
          ${gateRow('AUDIT', audit)}
          ${gateRow('RED TEAM', red)}
          ${gateRow('ACTIONABLE', actionable)}
        </div>
      </div>
    `;
  }

  function gateRow(label, value) {
    return `
      <div class="gr-gate">
        <span>${esc(label)}</span>
        <strong class="${esc(value.cls)}">
          ${esc(value.text)}
        </strong>
      </div>
    `;
  }

  function render() {
    const root = ensureShell();
    const run = getRun();

    if (!isGoldRush(run)) {
      root.classList.remove('is-visible');
      return;
    }

    root.classList.add('is-visible');

    const ledger = findLedger(run);

    const active =
      [
        'PLANNING',
        'RUNNING',
        'VERIFYING'
      ].includes(run.status);

    const activeAgent =
      activeAgentFromRun(run);

    const discovered =
      ledger?.discovered ?? 0;

    const verified =
      ledger?.source_verified ?? 0;

    const actionable =
      ledger?.actionable ?? 0;

    const realized =
      Number(
        ledger?.realized_value_aud ?? 0
      );

    root.innerHTML = `
      <div class="gr-frame">

        <header class="gr-header">
          <div>
            <div class="gr-kicker">
              SINK SPACE / ECONOMIC INTELLIGENCE
            </div>

            <h2 class="gr-title">
              SINK // GOLD RUSH
            </h2>

            <div class="gr-subtitle">
              Mining legitimate economic opportunities from persisted evidence.
            </div>
          </div>

          <div class="gr-status ${active ? 'is-active' : ''}">
            <span class="gr-status-dot"></span>
            ${active ? 'MINING LIVE' : esc(run.status ?? 'IDLE')}
          </div>
        </header>

        <div class="gr-proof-bar">
          <span>
            RUN ${esc(String(run.run_id ?? run.id ?? '—').slice(0, 12))}
          </span>

          <span>
            AUTHORITY: OBSERVE ONLY
          </span>

          <span>
            MODEL COST: A$0
          </span>

          <span class="gr-proof-badge">
            NO PROOF / NO CLAIM
          </span>
        </div>

        <div class="gr-kpis">
          <div class="gr-kpi">
            <div class="gr-label">DISCOVERED</div>
            <div class="gr-kpi-value">${discovered}</div>
          </div>

          <div class="gr-kpi verified">
            <div class="gr-label">SOURCE VERIFIED</div>
            <div class="gr-kpi-value">${verified}</div>
          </div>

          <div class="gr-kpi actionable">
            <div class="gr-label">ACTIONABLE</div>
            <div class="gr-kpi-value">${actionable}</div>
          </div>

          <div class="gr-kpi value">
            <div class="gr-label">ATTAINABLE RANGE</div>
            <div class="gr-kpi-value">${esc(moneyRange(ledger))}</div>
          </div>

          <div class="gr-kpi">
            <div class="gr-label">REALIZED</div>
            <div class="gr-kpi-value">
              A$${realized.toLocaleString()}
            </div>
          </div>
        </div>

        <div class="gr-main">

          <div class="gr-mine ${active ? 'is-active' : ''}">

            <svg
              class="gr-lines"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                class="gr-line ${activeAgent === 'SINK-04' || activeAgent === 'SINK-05' ? 'is-active' : ''}"
                d="M18 28 L50 28"
              />

              <path
                class="gr-line ${activeAgent === 'SINK-05' || activeAgent === 'SINK-03' ? 'is-active' : ''}"
                d="M50 28 L50 70"
              />

              <path
                class="gr-line ${activeAgent === 'SINK-03' || activeAgent === 'RED-SINK' ? 'is-active' : ''}"
                d="M50 70 L82 70"
              />
            </svg>

            <div class="gr-network">
              ${networkHtml(run)}
            </div>

            <div
              id="gr-signal"
              class="gr-signal"
              style="opacity:0"
            ></div>

            <div class="gr-opportunity-field">
              ${oreHtml(ledger)}
            </div>

          </div>

          <aside class="gr-side">

            <section class="gr-side-section">
              <div class="gr-label">
                LIVE MINING FEED
              </div>

              <div class="gr-feed">
                ${feedHtml(run)}
              </div>
            </section>

            <section class="gr-side-section">
              <div class="gr-label">
                STRONGEST CURRENT FIND
              </div>

              ${currentHtml(ledger)}
            </section>

          </aside>

        </div>
      </div>
    `;

    observePersistedEvents(run);
  }

  function moveSignal(agentId) {
    const signal =
      document.getElementById('gr-signal');

    const target =
      AGENTS[agentId];

    if (!signal || !target) {
      return;
    }

    signal.style.opacity = '1';
    signal.style.left = `${target.x}%`;
    signal.style.top = `${target.y}%`;

    clearTimeout(motion.signalTimer);

    motion.signalTimer =
      setTimeout(
        () => {
          signal.style.opacity = '.18';
        },
        850
      );
  }

  function observePersistedEvents(run) {
    const runId =
      run?.run_id ??
      run?.id ??
      null;

    const events =
      run?.events ?? [];

    if (motion.lastRunId !== runId) {
      motion.lastRunId = runId;
      motion.seenEvents = events.length;

      const current =
        activeAgentFromRun(run);

      if (current) {
        moveSignal(current);
      }

      return;
    }

    if (events.length <= motion.seenEvents) {
      return;
    }

    const newEvents =
      events.slice(motion.seenEvents);

    motion.seenEvents =
      events.length;

    // Animate only because a new persisted event exists.
    for (const event of newEvents) {
      if (!AGENTS[event.agent_id]) {
        continue;
      }

      moveSignal(event.agent_id);
    }
  }

  function tick() {
    try {
      render();
    } catch (error) {
      console.error(
        '[Gold Rush UI]',
        error
      );
    }
  }

  window.SinkGoldRush = {
    render: tick
  };

  tick();

  // Mirrors existing console polling cadence.
  // This does not create work or synthetic events.
  setInterval(tick, 1000);
})();
