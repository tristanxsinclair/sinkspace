'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const list = (value) => Array.isArray(value) ? value : [];
  const printable = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'Unavailable';
  const terminalStates = new Set(['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED']);
  const acceptedVerdicts = new Set(['PASS', 'PASS_WITH_LIMITATIONS']);
  let selectedId = null;
  let selectedRun = null;
  let currentState = null;
  let refreshBusy = false;
  let mutationBusy = false;
  let lastDetail = '';
  let lastSidebar = '';

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = printable(text);
    if (className) node.className = className;
    return node;
  }

  function badge(status) {
    const node = element('span', status ?? 'UNAVAILABLE', 'badge');
    if (['COMPLETED', 'PASS', 'KNOWN'].includes(status)) node.classList.add('good');
    if (['FAILED', 'FAIL', 'BLOCKED', 'CANCELLED'].includes(status)) node.classList.add('bad');
    if (['WAITING_FOR_APPROVAL', 'PASS_WITH_LIMITATIONS', 'UNVERIFIED', 'UNKNOWN', 'NEEDS_VERIFICATION', 'INFERRED'].includes(status)) node.classList.add('warn');
    return node;
  }

  function date(value) {
    if (!value) return 'Not recorded';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Invalid timestamp' : parsed.toLocaleString([], {dateStyle:'medium', timeStyle:'medium'});
  }

  function duration(run) {
    if (!run.started_at) return 'Not started';
    const start = Date.parse(run.started_at);
    const end = run.completed_at ? Date.parse(run.completed_at) : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Unavailable';
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  function bullets(target, values, emptyText) {
    target.replaceChildren();
    if (!values.length) { target.append(element('p', emptyText, 'muted')); return; }
    const ul = element('ul');
    for (const value of values) ul.append(element('li', value));
    target.append(ul);
  }

  async function api(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {'Accept':'application/json'} : {'Accept':'application/json', 'Content-Type':'application/json', 'X-Sink-Request':'operator-console'},
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}). Check the local runtime for details.`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  function errorMessage(error) {
    return error instanceof Error && error.name === 'AbortError' ? 'The local runtime did not respond within 10 seconds.' : error instanceof Error ? error.message : 'The local runtime could not be reached.';
  }

  function setConnection(online, message) {
    byId('system-status').textContent = online ? 'System online' : 'System unavailable';
    byId('system-indicator').className = `dot ${online ? 'online' : 'offline'}`;
    byId('connection-error').hidden = online;
    byId('connection-error').textContent = online ? '' : `${message} Displayed records may be stale. Retrying while this window is visible.`;
    byId('start-run').disabled = !online || mutationBusy;
  }

  function renderSidebar(state) {
    const signature = JSON.stringify([selectedId, state.agents, list(state.runs).map((run) => [run.run_id,run.status,run.objective,run.created_at,run.tasks,run.verification])]);
    if (signature === lastSidebar) return;
    lastSidebar = signature;
    const runs = [...list(state.runs)].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
    byId('run-count').textContent = String(runs.length);
    const runList = byId('run-list');
    runList.replaceChildren();
    if (!runs.length) runList.append(element('p', 'No runs recorded.', 'muted small'));
    for (const run of runs) {
      const button = element('button', null, 'run-option');
      button.type = 'button';
      button.setAttribute('aria-current', String(run.run_id === selectedId));
      button.append(element('strong', run.objective), badge(run.status), element('small', date(run.created_at)));
      button.addEventListener('click', async () => {
        selectedId = run.run_id;
        lastDetail = '';
        renderSidebar(currentState);
        try { await fetchSelected(); } catch(error) { setConnection(false, errorMessage(error)); }
      });
      runList.append(button);
    }
    const agents = byId('agent-list');
    agents.replaceChildren();
    for (const agent of list(state.agents)) {
      const item = element('div', null, 'agent');
      const heading = element('div', null, 'agent-name');
      heading.append(element('span', agent.name), element('span', agent.enabled ? 'Enabled' : 'Disabled', 'muted small'));
      const activeTask = runs.flatMap((run) => list(run.tasks)).find((task) => task.assigned_agent === agent.id && ['RUNNING', 'VERIFYING'].includes(task.status));
      const lastVerdict = runs.flatMap((run) => list(run.verification ?? run.receipt?.verification)).find((audit) => audit.agent_id === agent.id);
      const detail = element('details', null, 'agent-details');
      detail.append(element('summary', `${agent.id} · v${agent.version}`), element('p', agent.purpose));
      detail.append(element('p', `Capabilities: ${list(agent.capabilities).join(', ') || 'None'}`));
      detail.append(element('p', `Tools: ${list(agent.allowed_tools).join(', ') || 'None'}`));
      detail.append(element('p', 'Performance rates are not yet aggregated. See individual run verdicts.'));
      item.append(heading, element('p', activeTask ? `Active: ${activeTask.objective}` : 'No active task recorded.'), element('p', `Last verdict: ${lastVerdict?.verdict ?? 'Not recorded'}`), detail);
      agents.append(item);
    }
  }

  function renderApprovals(approvals) {
    const pending = list(approvals).filter((approval) => ['PENDING', 'REQUESTED', 'WAITING_FOR_APPROVAL'].includes(approval.status));
    const target = byId('approval-list');
    target.replaceChildren();
    if (!pending.length) { target.append(element('p', 'No approvals requested. This workflow has no executable high-risk external actions.')); return; }
    for (const approval of pending) target.append(element('p', `${approval.action ?? approval.tool ?? 'Action'} · ${approval.reason ?? approval.approval_id ?? 'Approval required'}`));
    target.append(element('p', 'Resolve approvals through the configured operator channel. This console cannot grant authority.'));
  }

  function renderMetrics(run) {
    const usage = run.usage ?? {};
    const budget = run.budget ?? {};
    const values = [
      ['Elapsed', duration(run), run.completed_at ? 'Recorded execution duration' : 'Since execution started'],
      ['Tool calls', `${usage.tool_calls ?? '—'} / ${budget.max_tool_calls ?? '—'}`, 'Used / run ceiling'],
      ['Model tokens', `${usage.tokens ?? '—'} / ${budget.max_tokens ?? '—'}`, 'Used / run ceiling'],
      ['Estimated API cost', typeof usage.estimated_cost_usd === 'number' ? `$${usage.estimated_cost_usd.toFixed(4)}` : 'Unavailable', 'USD · local compute not priced'],
    ];
    byId('run-metrics').replaceChildren(...values.map(([label,value,detail]) => {
      const node = element('div', null, 'metric');
      node.append(element('span', label), element('strong', value), element('small', detail));
      return node;
    }));
  }

  function renderTasks(run) {
    const target = byId('task-list');
    target.replaceChildren();
    for (const task of list(run.tasks)) {
      const item = element('div', null, 'task');
      const body = element('div');
      body.append(element('h4', task.objective), element('p', `${task.assigned_agent} · ${task.task_id}`));
      if (task.next_action) body.append(element('p', `Next: ${task.next_action}`));
      const meta = element('div', null, 'task-meta');
      meta.append(badge(task.status), element('span', `Verification: ${task.verification_status ?? 'UNVERIFIED'}`, 'muted small'));
      item.append(body,meta);
      target.append(item);
    }
    if (!list(run.tasks).length) target.append(element('p', 'No task records yet.', 'muted'));
  }

  function section(title) {
    const node = element('section', null, 'receipt-section');
    node.append(element('h4', title));
    return node;
  }

  function renderReceipt(receipt) {
    const target = byId('receipt-content');
    target.replaceChildren();
    byId('download-receipt').hidden = !receipt;
    if (!receipt) { target.append(element('p', 'No final receipt has been emitted. Work in progress is not a verified outcome.', 'muted')); return; }
    const summary = element('div', null, 'receipt-summary');
    summary.append(badge(receipt.final_status), element('code', receipt.receipt_id), element('span', `Confidence: ${receipt.confidence ?? 'Unspecified'}`, 'muted small'));
    target.append(summary, element('p', `Receipt hash: ${receipt.hash ?? 'Not recorded'}`, 'mono muted'));
    target.append(element('p', 'A hash supports integrity checks; it is not an external signature or proof that every repository check passed.', 'muted small'));

    const audits = section('Independent verification');
    for (const audit of list(receipt.verification)) {
      const card = element('div', null, 'audit-card');
      const header = element('header');
      header.append(element('strong', audit.agent_id), badge(audit.verdict));
      const reasons = element('div');
      bullets(reasons, list(audit.reasons), 'No reasons recorded.');
      card.append(header,reasons,element('p', `Checked claims: ${list(audit.checked_claim_ids).join(', ') || 'None recorded'}`, 'mono muted'));
      audits.append(card);
    }
    if (!list(receipt.verification).length) audits.append(element('p', 'No independent verdict recorded.', 'muted'));
    target.append(audits);

    const claims = section('Claims → evidence');
    const evidenceNodes = new Map();
    list(receipt.evidence).forEach((evidence, index) => evidenceNodes.set(evidence.evidence_id, `evidence-${index}`));
    for (const claim of list(receipt.claims)) {
      const card = element('article', null, 'claim');
      const header = element('header');
      header.append(badge(claim.classification), element('code', claim.claim_id));
      card.append(header,element('p', claim.statement));
      const links = element('div', null, 'evidence-links');
      for (const id of list(claim.evidence_ids)) {
        const anchor = evidenceNodes.get(id);
        if (!anchor) { links.append(element('span', `Missing evidence: ${id}`, 'error')); continue; }
        const link = element('a', id);
        link.href = `#${anchor}`;
        link.addEventListener('click', () => { const detail = byId(anchor); if (detail) detail.open = true; });
        links.append(link);
      }
      if (!list(claim.evidence_ids).length) links.append(element('span', 'No attached evidence.', 'muted'));
      card.append(links);
      claims.append(card);
    }
    if (!list(receipt.claims).length) claims.append(element('p', 'No claims recorded.', 'muted'));
    target.append(claims);

    const evidenceSection = section('Evidence & artifacts');
    const artifacts = new Map(list(receipt.artifacts_created).filter((artifact) => artifact && typeof artifact === 'object').map((artifact) => [artifact.artifact_id, artifact]));
    for (const evidence of list(receipt.evidence)) {
      const detail = element('details', null, 'evidence-detail');
      detail.id = evidenceNodes.get(evidence.evidence_id);
      detail.append(element('summary', `${evidence.tool} · ${evidence.evidence_id}`));
      const metadata = element('dl', null, 'evidence-meta');
      const artifact = artifacts.get(evidence.artifact_id);
      for (const [key,value] of [['Agent',evidence.agent_id],['Timestamp',date(evidence.timestamp)],['Commit',evidence.commit_sha],['Artifact',evidence.artifact_id],['SHA-256',artifact?.sha256],['Media type',artifact?.media_type]]) {
        metadata.append(element('dt',key),element('dd',value ?? 'Not recorded'));
      }
      detail.append(metadata);
      if (artifact) {
        let content = artifact.content;
        if (typeof content === 'string' && artifact.media_type?.includes('json')) {
          try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { /* Preserve the original artifact when JSON is malformed. */ }
        }
        detail.append(element('pre', content ?? 'Artifact content unavailable.'));
      } else detail.append(element('p','Artifact content is not present in this receipt.','muted'));
      evidenceSection.append(detail);
    }
    const referenced = new Set(list(receipt.evidence).map((item) => item.artifact_id));
    for (const artifact of artifacts.values()) {
      if (referenced.has(artifact.artifact_id)) continue;
      const detail = element('details', null, 'evidence-detail');
      detail.id = `artifact-${artifacts.size}-${evidenceSection.children.length}`;
      detail.append(element('summary', `Artifact · ${artifact.artifact_id}`), element('p', `SHA-256: ${artifact.sha256}`, 'mono muted'), element('pre', artifact.content));
      evidenceSection.append(detail);
    }
    if (!list(receipt.evidence).length && !artifacts.size) evidenceSection.append(element('p','No evidence or artifact bodies recorded.','muted'));
    target.append(evidenceSection);

    const unresolved = section('Unresolved items & uncertainty');
    const unresolvedBody = element('div');
    bullets(unresolvedBody, list(receipt.unresolved_items), 'No unresolved items recorded by the runtime.');
    unresolved.append(unresolvedBody);
    target.append(unresolved);
    const red = section('Red Sink findings');
    const redBody = element('div');
    bullets(redBody, list(receipt.red_sink_findings), 'No findings recorded. This does not establish the absence of weaknesses.');
    red.append(redBody);
    target.append(red);
  }

  function renderRun(run) {
    if (!run || typeof run.run_id !== 'string') throw new Error('The local runtime returned an invalid run record.');
    selectedRun = run;
    byId('empty-run').hidden = true;
    byId('run-detail').hidden = false;
    renderMetrics(run);
    const signature = JSON.stringify(run);
    if (signature === lastDetail) return;
    lastDetail = signature;
    const expanded = [...byId('receipt-content').querySelectorAll('details[open]')].map((node) => node.id);
    byId('run-objective').textContent = run.objective;
    byId('run-identity').textContent = `${run.run_id} · commit ${run.commit_sha ?? 'not recorded'} · ${run.adapter ?? 'adapter not recorded'}`;
    const stateBadge = badge(run.status);
    stateBadge.id = 'run-status';
    byId('run-status').replaceWith(stateBadge);
    const currentTask = list(run.tasks).find((task) => ['RUNNING','VERIFYING','WAITING_FOR_APPROVAL'].includes(task.status));
    const nextTask = list(run.tasks).find((task) => !terminalStates.has(task.status));
    byId('current-activity').textContent = currentTask ? `${currentTask.assigned_agent}: ${currentTask.objective}` : terminalStates.has(run.status) ? `Run ${run.status.toLowerCase()}` : 'Waiting for the next execution event';
    byId('next-action').textContent = `Next action: ${currentTask?.next_action ?? nextTask?.next_action ?? (run.receipt ? 'Review the receipt and unresolved items.' : terminalStates.has(run.status) ? 'Inspect failure details before starting another run.' : 'Wait for task execution and independent verification.')}`;
    byId('cancel-run').hidden = terminalStates.has(run.status);
    byId('cancel-run').disabled = mutationBusy;
    const receipt = run.receipt;
    const verification = list(receipt?.verification);
    const proven = list(receipt?.claims).filter((claim) => claim.classification === 'KNOWN' && list(claim.evidence_ids).length && verification.some((audit) => acceptedVerdicts.has(audit.verdict) && list(audit.checked_claim_ids).includes(claim.claim_id)) && !verification.some((audit) => !acceptedVerdicts.has(audit.verdict) && list(audit.checked_claim_ids).includes(claim.claim_id)));
    bullets(byId('proven-summary'), proven.map((claim) => claim.statement), receipt ? 'No independently accepted KNOWN claims recorded.' : 'No final verified claims yet.');
    const failures = [...list(run.errors).map(printable), ...verification.filter((audit) => ['FAIL','BLOCKED'].includes(audit.verdict)).flatMap((audit) => list(audit.reasons).map((reason) => `${audit.agent_id}: ${printable(reason)}`))];
    bullets(byId('failure-summary'), failures, receipt ? 'No execution or audit failures recorded. Review claims for failing repository checks and Red Sink findings.' : 'No failures recorded so far.');
    renderTasks(run);
    renderReceipt(receipt);
    for (const id of expanded) { const node = byId(id); if (node) node.open = true; }
    const timeline = byId('timeline');
    timeline.replaceChildren();
    for (const event of list(run.events)) {
      const item = element('li');
      const header = element('header');
      header.append(element('strong', event.type), element('time',date(event.timestamp)), element('span',event.agent_id ?? 'Control plane'));
      item.append(header,element('p',event.summary));
      timeline.append(item);
    }
    if (!list(run.events).length) timeline.append(element('li','No events recorded.','muted'));
  }

  async function fetchSelected() {
    if (!selectedId) return;
    const requestedId = selectedId;
    const run = await api(`/api/runs/${encodeURIComponent(requestedId)}`);
    if (selectedId === requestedId) renderRun(run);
  }

  async function refresh() {
    if (refreshBusy || document.hidden) return;
    refreshBusy = true;
    try {
      const state = await api('/api/state');
      if (!state || !Array.isArray(state.runs) || !Array.isArray(state.agents)) throw new Error('The local runtime returned an invalid state record.');
      currentState = state;
      if (!selectedId && state.runs.length) selectedId = [...state.runs].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))[0].run_id;
      byId('repository').textContent = state.repository ?? 'Repository not configured';
      byId('adapter-name').textContent = state.adapter ?? 'Adapter not reported';
      renderSidebar(state);
      renderApprovals(state.approvals);
      if (selectedId) await fetchSelected();
      else { byId('empty-run').hidden = false; byId('run-detail').hidden = true; }
      setConnection(state.system === 'online', `Runtime reports ${state.system ?? 'unknown'} system state.`);
    } catch(error) { setConnection(false,errorMessage(error)); }
    finally { refreshBusy = false; }
  }

  byId('run-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (mutationBusy) return;
    mutationBusy = true;
    byId('start-run').disabled = true;
    byId('action-message').textContent = 'Submitting the repository audit…';
    try {
      const run = await api('/api/runs', {workflow:'capability-inventory',objective:byId('objective').value});
      selectedId = run.run_id;
      lastDetail = '';
      renderRun(run);
      byId('action-message').textContent = 'Run accepted. Observable execution and verification records appear below.';
    } catch(error) { byId('action-message').textContent = errorMessage(error); }
    finally { mutationBusy = false; await refresh(); }
  });

  byId('cancel-run').addEventListener('click', async () => {
    if (!selectedRun || terminalStates.has(selectedRun.status) || mutationBusy) return;
    mutationBusy = true;
    byId('cancel-run').disabled = true;
    const cancelledId = selectedRun.run_id;
    try {
      const run = await api(`/api/runs/${encodeURIComponent(cancelledId)}/cancel`, {});
      if (selectedId === cancelledId) renderRun(run);
      byId('action-message').textContent = `Cancellation response: ${run.status}.`;
    } catch(error) { byId('action-message').textContent = errorMessage(error); }
    finally { mutationBusy = false; byId('cancel-run').disabled = false; await refresh(); }
  });

  byId('download-receipt').addEventListener('click', () => {
    if (!selectedRun?.receipt) return;
    const blob = new Blob([JSON.stringify(selectedRun.receipt, null, 2) + '\n'], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.href = url;
    link.download = `sink-receipt-${selectedRun.run_id.replace(/[^a-zA-Z0-9-]/g, '')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  setInterval(() => { void refresh(); }, 2000);
  void refresh();
})();
