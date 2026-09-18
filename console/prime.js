(() => {
  'use strict';

  let proposedMission = null;
  let busy = false;

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function ensurePrime() {
    if (
      document.getElementById(
        'sink-prime'
      )
    ) {
      return;
    }

    const shell =
      document.querySelector(
        '.shell'
      );

    const header =
      document.querySelector(
        '.topbar'
      );

    if (!shell || !header) {
      return;
    }

    const section =
      document.createElement(
        'section'
      );

    section.id =
      'sink-prime';

    section.className =
      'prime-console';

    section.innerHTML = `
      <div class="prime-head">
        <div>
          <div class="eyebrow">
            SINK // COMMAND
          </div>

          <h2>
            SINK PRIME
          </h2>
        </div>

        <div class="prime-online">
          <span></span>
          ONLINE
        </div>
      </div>

      <div
        id="prime-thread"
        class="prime-thread"
      >
        <div class="prime-message prime">
          <div class="prime-speaker">
            PRIME
          </div>

          <div>
            Command network ready.
            Tell me what you want the
            Sink Clones to accomplish.
          </div>
        </div>
      </div>

      <form
        id="prime-form"
        class="prime-form"
      >
        <span class="prime-prompt">
          &gt;
        </span>

        <textarea
          id="prime-input"
          rows="2"
          maxlength="4000"
          placeholder="Talk to Sink Prime..."
          autocomplete="off"
        ></textarea>

        <button
          id="prime-send"
          type="submit"
        >
          SEND
        </button>
      </form>

      <div
        id="prime-proposal"
        class="prime-proposal"
        hidden
      ></div>
    `;

    header.insertAdjacentElement(
      'afterend',
      section
    );

    document
      .getElementById('prime-form')
      .addEventListener(
        'submit',
        event => {
          event.preventDefault();
          sendToPrime();
        }
      );

    document
      .getElementById('prime-input')
      .addEventListener(
        'keydown',
        event => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey
          ) {
            event.preventDefault();

            document
              .getElementById(
                'prime-form'
              )
              .requestSubmit();
          }
        }
      );
  }

  function addMessage(
    speaker,
    message,
    kind
  ) {
    const thread =
      document.getElementById(
        'prime-thread'
      );

    if (!thread) {
      return;
    }

    const item =
      document.createElement('div');

    item.className =
      `prime-message ${kind}`;

    item.innerHTML = `
      <div class="prime-speaker">
        ${escapeHtml(speaker)}
      </div>

      <div>
        ${escapeHtml(message)}
      </div>
    `;

    thread.appendChild(item);

    thread.scrollTop =
      thread.scrollHeight;
  }

  function missionSummary(
    mission
  ) {
    if (!mission) {
      return '';
    }

    if (
      mission.workflow ===
        'gold-rush'
    ) {
      return `
        <div>
          WORKFLOW
          <strong>GOLD RUSH</strong>
        </div>

        <div>
          MODE
          <strong>DISCOVER</strong>
        </div>

        <div>
          HORIZON
          <strong>
            ${escapeHtml(
              mission.mission
                .horizon_days
            )} DAYS
          </strong>
        </div>

        <div>
          MAX SPEND
          <strong>A$0</strong>
        </div>
      `;
    }

    if (
      mission.workflow ===
        'revenue'
    ) {
      return `
        <div>
          WORKFLOW
          <strong>REVENUE</strong>
        </div>

        <div>
          MODE
          <strong>
            ${escapeHtml(
              mission.mission.mode
            )}
          </strong>
        </div>

        <div>
          TARGET
          <strong>
            A$${escapeHtml(
              mission.mission
                .cash_target_aud
            )}
          </strong>
        </div>

        <div>
          HORIZON
          <strong>
            ${escapeHtml(
              mission.mission
                .horizon_days
            )} DAYS
          </strong>
        </div>
      `;
    }

    return `
      <div>
        WORKFLOW
        <strong>
          SYSTEM SCAN
        </strong>
      </div>
    `;
  }

  function renderProposal(
    result
  ) {
    const proposal =
      document.getElementById(
        'prime-proposal'
      );

    if (!proposal) {
      return;
    }

    if (
      result.status !== 'READY' ||
      !result.mission
    ) {
      proposedMission = null;
      proposal.hidden = true;
      proposal.innerHTML = '';
      return;
    }

    proposedMission =
      result.mission;

    const assumptions =
      Array.isArray(
        result.assumptions
      )
        ? result.assumptions
        : [];

    proposal.hidden = false;

    proposal.innerHTML = `
      <div class="prime-proposal-head">
        <div>
          <div class="eyebrow">
            INTERPRETED MISSION
          </div>

          <div class="prime-confidence">
            ${escapeHtml(
              result.confidence
            )} CONFIDENCE
          </div>
        </div>

        <div class="prime-proof">
          NO PROOF / NO CLAIM
        </div>
      </div>

      <div class="prime-mission-grid">
        ${missionSummary(
          result.mission
        )}
      </div>

      <div class="prime-objective">
        ${escapeHtml(
          result.mission.objective
        )}
      </div>

      ${
        assumptions.length
          ? `
            <div class="prime-assumptions">
              ${assumptions
                .map(
                  item =>
                    `<span>${escapeHtml(
                      item
                    )}</span>`
                )
                .join('')}
            </div>
          `
          : ''
      }

      <div class="prime-actions">
        <button
          id="prime-cancel"
          type="button"
          class="prime-secondary"
        >
          CANCEL
        </button>

        <button
          id="prime-deploy"
          type="button"
          class="prime-deploy"
        >
          DEPLOY SINK CLONES
        </button>
      </div>
    `;

    document
      .getElementById(
        'prime-cancel'
      )
      ?.addEventListener(
        'click',
        () => {
          proposedMission = null;
          proposal.hidden = true;
        }
      );

    document
      .getElementById(
        'prime-deploy'
      )
      ?.addEventListener(
        'click',
        deployMission
      );
  }

  async function sendToPrime() {
    if (busy) {
      return;
    }

    const input =
      document.getElementById(
        'prime-input'
      );

    const message =
      input?.value.trim();

    if (!message) {
      return;
    }

    busy = true;

    input.value = '';

    addMessage(
      'YOU',
      message,
      'user'
    );

    try {
      const response =
        await fetch(
          '/api/prime/message',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify({
                message
              })
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ??
          'Prime request failed.'
        );
      }

      addMessage(
        'PRIME',
        result.reply,
        'prime'
      );

      renderProposal(result);
    } catch (error) {
      addMessage(
        'PRIME',
        error instanceof Error
          ? error.message
          : 'Prime request failed.',
        'error'
      );
    } finally {
      busy = false;
      input?.focus();
    }
  }

  async function deployMission() {
    if (
      !proposedMission ||
      busy
    ) {
      return;
    }

    busy = true;

    const button =
      document.getElementById(
        'prime-deploy'
      );

    if (button) {
      button.disabled = true;
      button.textContent =
        'DEPLOYING…';
    }

    try {
      const body =
        proposedMission;

      const response =
        await fetch(
          '/api/prime/deploy',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify(body)
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.message ??
          result.error ??
          'Mission deployment failed.'
        );
      }

      addMessage(
        'PRIME',
        `Mission deployed. ${proposedMission.workflow} execution has started.`,
        'prime'
      );

      proposedMission = null;

      const proposal =
        document.getElementById(
          'prime-proposal'
        );

      if (proposal) {
        proposal.hidden = true;
      }
    } catch (error) {
      addMessage(
        'PRIME',
        error instanceof Error
          ? error.message
          : 'Mission deployment failed.',
        'error'
      );

      if (button) {
        button.disabled = false;
        button.textContent =
          'DEPLOY SINK CLONES';
      }
    } finally {
      busy = false;
    }
  }

  function boot() {
    ensurePrime();
  }

  if (
    document.readyState ===
      'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      boot
    );
  } else {
    boot();
  }

  window.SinkPrime = {
    sendToPrime
  };
})();
