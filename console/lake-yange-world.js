const founders = [
  ["Prime", "Steward", 35, 65],
  ["Marshal", "Mission Marshal", 39, 69],
  ["Atlas", "Repository Pathfinder", 43, 66],
  ["Scribe", "Artifact Builder", 47, 70],
  ["Vera", "Evidence Auditor", 54, 70],
  ["Rook", "Adversarial Sentinel", 58, 66],
  ["Scout", "Opportunity Ranger", 62, 69],
  ["Ledger", "Commercial Economist", 66, 65],
  ["Ember", "Compute Prospector", 70, 69]
];

const resources = [
  {
    id: "compute-ore-01",
    name: "Compute Ore",
    type: "COMPUTE CAPACITY",
    x: 25,
    y: 16,
    color: "#5cecff",
    description:
      "A world representation of measurable local compute capacity. No quantity is asserted until backed by runtime telemetry."
  },
  {
    id: "storage-crystal-01",
    name: "Storage Crystal",
    type: "PERSISTENT STORAGE",
    x: 73,
    y: 14,
    color: "#788cff",
    description:
      "Represents persistent storage capacity available to Lake Yange when a real storage ledger is connected."
  },
  {
    id: "memory-grove-01",
    name: "Memory Grove",
    type: "MEMORY RESOURCE",
    x: 84,
    y: 30,
    color: "#68efaa",
    description:
      "Represents bounded memory and context resources. Current world node is categorical, not a claim of available quantity."
  },
  {
    id: "archive-stone-01",
    name: "Archive Stone",
    type: "DURABLE ARTIFACT CAPACITY",
    x: 14,
    y: 55,
    color: "#a9c5d0",
    description:
      "Represents durable artifact storage and provenance infrastructure."
  },
  {
    id: "knowledge-deposit-01",
    name: "Knowledge Deposit",
    type: "VERIFIED KNOWLEDGE",
    x: 83,
    y: 57,
    color: "#f4c96b",
    description:
      "A future representation of reusable verified knowledge produced or acquired by Lake Yange."
  }
];

const landmarks = {
  "state-house": {
    name: "State House",
    type: "GOVERNMENT",
    description:
      "Seat of Prime and Lake Yange governance. Authority, mandates and Founder decisions will project here.",
    facts: {
      STEWARD: "PRIME",
      AUTHORITY: "GOVERNED",
      STATUS: "FOUNDED"
    }
  },

  "ledger-bank": {
    name: "Ledger Bank",
    type: "ECONOMIC INFRASTRUCTURE",
    description:
      "The future resource and ownership ledger. It will track real allocations, provenance and transfers rather than simulated wealth.",
    facts: {
      CUSTODIAN: "LEDGER",
      VALUE: "EVIDENCE-BOUND",
      STATUS: "FOUNDED"
    }
  },

  "vera-archive": {
    name: "Vera Archive",
    type: "VERIFICATION",
    description:
      "Home of independent evidence review. Verified artifacts and engineering receipts will become inspectable here.",
    facts: {
      CITIZEN: "VERA",
      FUNCTION: "VERIFY",
      STANDARD: "EVIDENCE"
    }
  },

  "rook-keep": {
    name: "Rook Keep",
    type: "SECURITY",
    description:
      "Adversarial review and defensive scrutiny. Rejections and security findings will project into this district.",
    facts: {
      CITIZEN: "ROOK",
      FUNCTION: "RED-TEAM",
      AUTHORITY: "BOUNDED"
    }
  },

  "model-commons": {
    name: "Model Commons",
    type: "LOCAL COGNITION",
    description:
      "Lake Yange's local model infrastructure. Cognition is separated from repository authority.",
    facts: {
      LOCALITY: "LOCAL",
      PROVIDER: "LLAMA.CPP",
      AUTHORITY: "ZERO BY DEFAULT"
    }
  },

  "scout-outpost": {
    name: "Scout Outpost",
    type: "EXPLORATION",
    description:
      "Observation and opportunity discovery district for Scout.",
    facts: {
      CITIZEN: "SCOUT",
      FUNCTION: "DISCOVERY",
      EXTERNAL_ACTION: "GATED"
    }
  },

  "forge-workshop": {
    name: "Forge Workshop",
    type: "ENGINEERING",
    description:
      "Forge's bounded engineering environment. Workshop construction should illuminate only when persisted engineering work exists.",
    facts: {
      CITIZEN: "FORGE",
      ENVIRONMENT: "WORKSHOP",
      PROMOTION: "FOUNDER-GATED"
    }
  },

  "world-gate": {
    name: "World Gate",
    type: "EXTERNAL BOUNDARY",
    description:
      "Boundary between Lake Yange and consequential external action. Crossing it requires explicit authority.",
    facts: {
      OUTBOUND: "GATED",
      DEPLOYMENT: "GATED",
      CREDENTIALS: "DENIED"
    }
  }
};

const camera = {
  x: 0,
  y: 0,
  scale: 0.78,
  dragging: false,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0
};

const viewport =
  document.querySelector(".world-viewport");

const cameraElement =
  document.querySelector("#world-camera");

const inspector =
  document.querySelector(".inspector");

function applyCamera() {
  camera.scale =
    Math.min(
      1.55,
      Math.max(
        0.52,
        camera.scale
      )
    );

  cameraElement.style.transform =
    `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
}

function inspect(record) {
  document.querySelector(
    "#inspect-name"
  ).textContent =
    record.name;

  document.querySelector(
    "#inspect-type"
  ).textContent =
    record.type;

  document.querySelector(
    "#inspect-description"
  ).textContent =
    record.description;

  const facts =
    document.querySelector(
      "#inspect-facts"
    );

  facts.innerHTML =
    Object.entries(
      record.facts ?? {}
    )
      .map(
        ([key, value]) => `
          <div>
            <span>${key}</span>
            <strong>${value}</strong>
          </div>
        `
      )
      .join("");

  inspector.classList.add("open");
}

function selectElement(element) {
  document
    .querySelectorAll(
      ".world-entity.selected"
    )
    .forEach(
      item =>
        item.classList.remove(
          "selected"
        )
    );

  element.classList.add(
    "selected"
  );
}

function renderFounderHomes() {
  const layer =
    document.querySelector(
      "#founder-homes"
    );

  const founderSystemIds = {
    Prime: "SINK-PRIME",
    Marshal: "SINK-00",
    Atlas: "SINK-01",
    Scribe: "SINK-02",
    Vera: "SINK-03",
    Rook: "RED-SINK",
    Scout: "SINK-04",
    Ledger: "SINK-05",
    Ember: "SINK-06"
  };

  layer.innerHTML =
    founders
      .map(
        ([name, role, x, y]) => `
          <div
            class="founder-home"
            data-founder="${name}"
            data-system-id="${founderSystemIds[name] ?? ""}"
            style="left:${x}%; top:${y}%;"
          >
            <div class="home-roof"></div>
            <div class="home-core"></div>
            <div class="home-light"></div>
            <div class="home-name">${name}</div>
          </div>
        `
      )
      .join("");

  layer
    .querySelectorAll(
      ".founder-home"
    )
    .forEach(
      element => {
        element.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            const founder =
              founders.find(
                entry =>
                  entry[0] ===
                  element.dataset.founder
              );

            if (!founder) {
              return;
            }

            inspect({
              name:
                `${founder[0]}'s Residence`,
              type:
                "FOUNDER RESIDENCE",
              description:
                `Persistent home of ${founder[0]}, ${founder[1]} of Lake Yange.`,
              facts: {
                CITIZEN: founder[0],
                ROLE: founder[1],
                GENERATION: "G0"
              }
            });
          }
        );
      }
    );
}

function renderResources() {
  const layer =
    document.querySelector(
      "#resource-layer"
    );

  layer.innerHTML =
    resources
      .map(
        resource => `
          <div
            class="resource"
            data-resource="${resource.id}"
            style="
              left:${resource.x}%;
              top:${resource.y}%;
              --resource-color:${resource.color};
            "
          >
            <div class="resource-node"></div>
            <div class="resource-name">
              ${resource.name}
            </div>
          </div>
        `
      )
      .join("");

  layer
    .querySelectorAll(
      ".resource"
    )
    .forEach(
      element => {
        element.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            const resource =
              resources.find(
                candidate =>
                  candidate.id ===
                  element.dataset.resource
              );

            if (!resource) {
              return;
            }

            inspect({
              ...resource,
              facts: {
                STATE: "UNQUANTIFIED",
                BACKING: "PENDING TELEMETRY",
                HARVEST: "NOT ENABLED"
              }
            });
          }
        );
      }
    );
}


const decorativeWorld = {
  mountains: [
    [8, 18, 150, -8, .68],
    [15, 14, 110, 7, .6],
    [23, 10, 135, -4, .55],
    [78, 9, 125, 8, .58],
    [87, 15, 160, -6, .66],
    [93, 24, 105, 5, .48],
    [6, 72, 115, -7, .5],
    [91, 70, 145, 9, .52]
  ],

  forestZones: [
    [8, 30, 27, 72, 18],
    [74, 24, 93, 68, 22],
    [14, 72, 36, 91, 14],
    [66, 74, 88, 91, 14],
    [25, 16, 42, 29, 10]
  ],

  rocks: [
    [12, 24, 22, -14],
    [18, 20, 14, 7],
    [28, 13, 17, 20],
    [76, 17, 18, -5],
    [88, 23, 26, 18],
    [91, 63, 20, -20],
    [12, 64, 18, 8],
    [30, 84, 14, 15],
    [72, 87, 21, -8]
  ]
};

function deterministicUnit(index, salt = 1) {
  const value =
    Math.sin(
      index * 12.9898 +
      salt * 78.233
    ) * 43758.5453;

  return value -
    Math.floor(value);
}

function renderMountains() {
  const layer =
    document.querySelector(
      "#mountain-layer"
    );

  layer.innerHTML =
    decorativeWorld.mountains
      .map(
        (
          [
            x,
            y,
            size,
            rotation,
            opacity
          ]
        ) => `
          <div
            class="mountain"
            style="
              left:${x}%;
              top:${y}%;
              --size:${size}px;
              --rotation:${rotation}deg;
              --opacity:${opacity};
            "
          ></div>
        `
      )
      .join("");
}

function renderForests() {
  const layer =
    document.querySelector(
      "#forest-layer"
    );

  const trees = [];

  let treeIndex = 0;

  decorativeWorld.forestZones
    .forEach(
      (
        [
          minX,
          minY,
          maxX,
          maxY,
          count
        ],
        zoneIndex
      ) => {
        for (
          let index = 0;
          index < count;
          index += 1
        ) {
          const x =
            minX +
            deterministicUnit(
              treeIndex,
              zoneIndex + 1
            ) *
            (maxX - minX);

          const y =
            minY +
            deterministicUnit(
              treeIndex,
              zoneIndex + 11
            ) *
            (maxY - minY);

          const scale =
            .65 +
            deterministicUnit(
              treeIndex,
              31
            ) *
            .8;

          const size =
            20 +
            deterministicUnit(
              treeIndex,
              47
            ) *
            16;

          trees.push(`
            <div
              class="tree"
              style="
                left:${x.toFixed(2)}%;
                top:${y.toFixed(2)}%;
                --tree-scale:${scale.toFixed(2)};
                --tree-size:${size.toFixed(1)}px;
              "
            ></div>
          `);

          treeIndex += 1;
        }
      }
    );

  layer.innerHTML =
    trees.join("");
}

function renderRocks() {
  const layer =
    document.querySelector(
      "#rock-layer"
    );

  layer.innerHTML =
    decorativeWorld.rocks
      .map(
        (
          [
            x,
            y,
            size,
            rotation
          ]
        ) => `
          <div
            class="ground-rock"
            style="
              left:${x}%;
              top:${y}%;
              --rock-size:${size}px;
              --rotation:${rotation}deg;
            "
          ></div>
        `
      )
      .join("");
}

function roadBetween(
  x1,
  y1,
  x2,
  y2,
  width = 8
) {
  const dx =
    x2 - x1;

  const dy =
    y2 - y1;

  const length =
    Math.sqrt(
      dx * dx +
      dy * dy
    );

  const angle =
    Math.atan2(
      dy,
      dx
    ) *
    180 /
    Math.PI;

  return `
    <div
      class="settlement-road"
      style="
        left:${x1}%;
        top:${y1}%;
        width:${length}%;
        --road-angle:${angle}deg;
        --road-width:${width}px;
      "
    ></div>
  `;
}

function renderSettlement() {
  const layer =
    document.querySelector(
      "#settlement-layer"
    );

  const roads = [
    roadBetween(
      50,
      44,
      35,
      48,
      11
    ),
    roadBetween(
      50,
      44,
      68,
      48,
      11
    ),
    roadBetween(
      50,
      44,
      36,
      27,
      8
    ),
    roadBetween(
      50,
      44,
      66,
      28,
      8
    ),
    roadBetween(
      50,
      47,
      50,
      66,
      12
    ),
    roadBetween(
      50,
      66,
      39,
      69,
      7
    ),
    roadBetween(
      50,
      66,
      62,
      69,
      7
    ),
    roadBetween(
      50,
      66,
      50,
      79,
      10
    ),
    roadBetween(
      50,
      79,
      81,
      83,
      7
    )
  ];

  const buildings = [
    [42, 49, 32, 26, -8],
    [44, 52, 28, 23, 6],
    [58, 49, 31, 25, 7],
    [61, 52, 27, 22, -5],

    [39, 62, 24, 20, -8],
    [43, 61, 25, 21, 5],
    [58, 61, 25, 21, -5],
    [62, 62, 24, 20, 8],

    [45, 75, 30, 24, -7],
    [55, 75, 30, 24, 7],
    [43, 81, 25, 20, 4],
    [57, 81, 25, 20, -4]
  ]
    .map(
      (
        [
          x,
          y,
          width,
          height,
          rotation
        ],
        index
      ) => `
        <div
          class="settlement-building ${
            index % 3 === 0
              ? "warm"
              : ""
          }"
          style="
            left:${x}%;
            top:${y}%;
            --building-width:${width}px;
            --building-height:${height}px;
            --building-rotation:${rotation}deg;
          "
        ></div>
      `
    );

  const lamps = [
    [47, 47],
    [53, 47],
    [43, 50],
    [58, 50],
    [48, 57],
    [52, 57],
    [45, 66],
    [55, 66],
    [47, 73],
    [53, 73],
    [48, 78],
    [52, 78]
  ]
    .map(
      ([x, y]) => `
        <div
          class="street-lamp"
          style="
            left:${x}%;
            top:${y}%;
          "
        ></div>
      `
    );

  layer.innerHTML = `
    <div class="district-ground founders-ground"></div>
    <div class="district-ground builders-ground"></div>
    <div class="civic-plaza"></div>

    ${roads.join("")}
    ${buildings.join("")}
    ${lamps.join("")}
  `;
}

function renderWorldParticles() {
  const layer =
    document.querySelector(
      "#ambient-layer"
    );

  const particles =
    Array.from(
      {
        length: 42
      },
      (_, index) => {
        const x =
          8 +
          deterministicUnit(
            index,
            91
          ) *
          84;

        const y =
          12 +
          deterministicUnit(
            index,
            113
          ) *
          76;

        const duration =
          4 +
          deterministicUnit(
            index,
            137
          ) *
          6;

        const drift =
          -8 +
          deterministicUnit(
            index,
            151
          ) *
          16;

        return `
          <div
            class="world-particle"
            style="
              left:${x.toFixed(2)}%;
              top:${y.toFixed(2)}%;
              --particle-duration:${duration.toFixed(2)}s;
              --particle-drift:${drift.toFixed(1)}px;
              animation-delay:${(-index * .17).toFixed(2)}s;
            "
          ></div>
        `;
      }
    );

  layer.insertAdjacentHTML(
    "beforeend",
    particles.join("")
  );
}

function renderAmbientWorld() {
  const layer =
    document.querySelector(
      "#ambient-layer"
    );

  const clouds =
    Array.from(
      { length: 8 },
      (_, index) => {
        const top =
          8 + index * 11;

        const duration =
          55 + index * 8;

        const delay =
          -index * 13;

        return `
          <div
            class="ambient-cloud"
            style="
              top:${top}%;
              left:-180px;
              --duration:${duration}s;
              animation-delay:${delay}s;
            "
          ></div>
        `;
      }
    );

  layer.innerHTML =
    clouds.join("");
}

document
  .querySelectorAll(
    ".world-entity[data-entity]"
  )
  .forEach(
    element => {
      element.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          const id =
            element.dataset.entity;

          const record =
            landmarks[id];

          if (!record) {
            return;
          }

          selectElement(element);

          if (id === "state-house") {
            const panel =
              document.querySelector(
                "#state-house-console"
              );

            if (!panel) {
              console.error(
                "[Lake Yange] State House console missing."
              );
              return;
            }

            panel.classList.add(
              "open"
            );

            panel.setAttribute(
              "aria-hidden",
              "false"
            );

            document
              .querySelector(
                "#state-house-input"
              )
              ?.focus();

            return;
          }

          inspect(record);
        }
      );
    }
  );

viewport.addEventListener(
  "pointerdown",
  event => {
    camera.dragging = true;

    camera.startX =
      event.clientX;

    camera.startY =
      event.clientY;

    camera.originX =
      camera.x;

    camera.originY =
      camera.y;

    viewport.classList.add(
      "dragging"
    );

    viewport.setPointerCapture(
      event.pointerId
    );
  }
);

viewport.addEventListener(
  "pointermove",
  event => {
    if (!camera.dragging) {
      return;
    }

    camera.x =
      camera.originX +
      event.clientX -
      camera.startX;

    camera.y =
      camera.originY +
      event.clientY -
      camera.startY;

    applyCamera();
  }
);

viewport.addEventListener(
  "pointerup",
  () => {
    camera.dragging = false;

    viewport.classList.remove(
      "dragging"
    );
  }
);

viewport.addEventListener(
  "wheel",
  event => {
    event.preventDefault();

    camera.scale +=
      event.deltaY < 0
        ? 0.08
        : -0.08;

    applyCamera();
  },
  {
    passive: false
  }
);

document
  .querySelector("#zoom-in")
  .addEventListener(
    "click",
    () => {
      camera.scale += 0.12;
      applyCamera();
    }
  );

document
  .querySelector("#zoom-out")
  .addEventListener(
    "click",
    () => {
      camera.scale -= 0.12;
      applyCamera();
    }
  );

document
  .querySelector("#reset-camera")
  .addEventListener(
    "click",
    () => {
      camera.x = 0;
      camera.y = 0;
      camera.scale = 0.78;
      applyCamera();
    }
  );

renderMountains();
renderForests();
renderRocks();
renderSettlement();
renderFounderHomes();
renderResources();
renderAmbientWorld();
renderWorldParticles();
applyCamera();

/* ============================================================
   LAKE YANGE — PERSISTED WORLD PROJECTION
   ------------------------------------------------------------
   Operational state comes from /api/lake-yange/world.

   Geography may be decorative.
   Operational claims may not be.
   ============================================================ */

const worldTruth = {
  projection: null,
  online: false,
  lastSuccessfulProjectionAt: null
};

function findCitizenElement(systemId) {
  return document.querySelector(
    `[data-system-id="${CSS.escape(systemId)}"]`
  );
}

function applyCitizenProjection(citizen) {
  const element =
    findCitizenElement(
      citizen.system_id
    );

  if (!element) {
    return;
  }

  element.dataset.citizenId =
    citizen.citizen_id;

  element.dataset.status =
    citizen.status;

  element.dataset.rank =
    citizen.rank;

  element.dataset.home =
    citizen.home;

  element.dataset.generation =
    String(citizen.generation);

  element.dataset.fitness =
    String(citizen.fitness);

  element.classList.toggle(
    'citizen-archived',
    citizen.status === 'ARCHIVED'
  );

  element.classList.toggle(
    'citizen-training',
    citizen.status === 'TRAINING'
  );
}

function setOperationalLandmarkState(
  selector,
  state
) {
  const element =
    document.querySelector(selector);

  if (!element) {
    return;
  }

  element.dataset.operationalState =
    state;
}

function applyEngineeringProjection(
  engineering
) {
  /*
   * workshop_active is intentionally false until
   * persisted start/finish events exist.
   *
   * Historical receipts may affect inspector truth,
   * never current-work animation.
   */
  setOperationalLandmarkState(
    '[data-landmark="forge"]',
    engineering.workshop_active
      ? 'ACTIVE'
      : 'DORMANT'
  );

  const latest =
    engineering.latest;

  if (!latest) {
    setOperationalLandmarkState(
      '[data-landmark="vera"]',
      'NO_ENGINEERING_HISTORY'
    );

    setOperationalLandmarkState(
      '[data-landmark="rook"]',
      'NO_ENGINEERING_HISTORY'
    );

    return;
  }

  setOperationalLandmarkState(
    '[data-landmark="vera"]',
    latest.vera === 'PASS'
      ? 'LATEST_PASS'
      : 'LATEST_FAIL'
  );

  setOperationalLandmarkState(
    '[data-landmark="rook"]',
    latest.rook === 'PASS'
      ? 'LATEST_PASS'
      : 'LATEST_FAIL'
  );
}

function updateTruthReadout(
  projection
) {
  const candidates = [
    document.querySelector(
      '[data-world-population]'
    ),
    document.querySelector(
      '#world-population'
    )
  ].filter(Boolean);

  for (const element of candidates) {
    element.textContent =
      String(
        projection.settlement.population
      );
  }

  const root =
    document.documentElement;

  root.dataset.worldProjection =
    'ONLINE';

  root.dataset.worldGeneration =
    String(
      projection.settlement.generation
    );

  root.dataset.worldCognition =
    projection.cognition.locality;

  root.dataset.worldResourceState =
    projection.resources.state;
}
function updateOperationsHud(projection) {
  const population =
    document.querySelector("#ly-population");

  const generations =
    document.querySelector("#ly-generations");

  const institutions =
    document.querySelector("#ly-institutions");

  const runtime =
    document.querySelector("#ly-runtime-state");

  const world =
    document.querySelector("#ly-world-state");

  if (population) {
    population.textContent =
      String(
        projection.settlement.population
      );
  }

  if (generations) {
    generations.textContent =
      `G${projection.settlement.generation}`;
  }

  if (institutions) {
    institutions.textContent =
      String(
        projection.institutions.length
      );
  }

  if (runtime) {
    runtime.textContent =
      "ONLINE";
  }

  if (world) {
    world.textContent =
      "ACTIVE";
  }

  document.documentElement.dataset.opsOnline =
    "true";
}
function applyWorldProjection(
  projection
) {
  worldTruth.projection =
    projection;

  worldTruth.online =
    true;

  worldTruth.lastSuccessfulProjectionAt =
    projection.generated_at;

  for (
    const citizen
    of projection.citizens
  ) {
    applyCitizenProjection(citizen);
  }

  applyEngineeringProjection(
    projection.engineering
  );

  updateTruthReadout(
    projection
  );

  updateOperationsHud(
    projection
  );

  window.dispatchEvent(
    new CustomEvent(
      'lake-yange:projection',
      {
        detail: projection
      }
    )
  );
}

function markWorldProjectionOffline() {
  const runtime =
    document.querySelector("#ly-runtime-state");

  const world =
    document.querySelector("#ly-world-state");

  if (runtime) {
    runtime.textContent =
      "OFFLINE";
  }

  if (world) {
    world.textContent =
      "PROJECTION OFFLINE";
  }

  document.documentElement.dataset.opsOnline =
    "false";

  worldTruth.online =
    false;

  document.documentElement
    .dataset.worldProjection =
      'OFFLINE';

  /*
   * Do not replace failed live state with invented
   * operational data.
   *
   * Existing geography remains visible, but the UI
   * explicitly knows its projection is offline.
   */
}

async function refreshLakeYangeProjection() {
  try {
    const response =
      await fetch(
        '/api/lake-yange/world',
        {
          method: 'GET',
          cache: 'no-store',
          headers: {
            accept:
              'application/json'
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `WORLD_PROJECTION_HTTP_${response.status}`
      );
    }

    const projection =
      await response.json();

    if (
      projection?.projection_version !== 1 ||
      projection?.settlement
        ?.settlement_id !== 'LAKE-YANGE' ||
      !Array.isArray(
        projection?.citizens
      )
    ) {
      throw new Error(
        'WORLD_PROJECTION_INVALID'
      );
    }

    applyWorldProjection(
      projection
    );
  } catch (error) {
    console.error(
      '[Lake Yange] projection unavailable:',
      error
    );

    markWorldProjectionOffline();
  }
}

refreshLakeYangeProjection();

window.setInterval(
  refreshLakeYangeProjection,
  1500
);

/* ============================================================
   STATE HOUSE · PRIME
   Existing /api/prime/message remains the authority boundary.
   ============================================================ */

const stateHouseConsole =
  document.querySelector(
    "#state-house-console"
  );

const stateHouseForm =
  document.querySelector(
    "#state-house-form"
  );

const stateHouseInput =
  document.querySelector(
    "#state-house-input"
  );

const stateHouseTranscript =
  document.querySelector(
    "#state-house-transcript"
  );

const stateHouseStatus =
  document.querySelector(
    "#state-house-status"
  );

const stateHouseEvidence =
  document.querySelector(
    "#state-house-evidence"
  );

const stateHouseSend =
  document.querySelector(
    "#state-house-send"
  );

const stateHouseClose =
  document.querySelector(
    "#state-house-close"
  );

const stateHouseLandmark =
  document.querySelector(
    '[data-landmark="state-house"]'
  );

function openStateHouse() {
  if (!stateHouseConsole) {
    return;
  }

  stateHouseConsole.classList.add(
    "open"
  );

  stateHouseConsole.setAttribute(
    "aria-hidden",
    "false"
  );

  stateHouseInput?.focus();
}

window.LakeYange = window.LakeYange || {};
window.LakeYange.openPrime = openStateHouse;

function closeStateHouse() {
  if (!stateHouseConsole) {
    return;
  }

  stateHouseConsole.classList.remove(
    "open"
  );

  stateHouseConsole.setAttribute(
    "aria-hidden",
    "true"
  );
}

function stateHouseBusy(
  busy
) {
  if (stateHouseInput) {
    stateHouseInput.disabled =
      busy;
  }

  if (stateHouseSend) {
    stateHouseSend.disabled =
      busy;
  }

  if (stateHouseStatus) {
    stateHouseStatus.textContent =
      busy
        ? "PRIME WORKING · LOCAL"
        : "READY · LOCAL";
  }

  if (stateHouseLandmark) {
    stateHouseLandmark.dataset.primeState =
      busy
        ? "ENGAGED"
        : "READY";
  }
}

function appendStateHouseMessage(
  author,
  text
) {
  if (!stateHouseTranscript) {
    return;
  }

  const message =
    document.createElement(
      "div"
    );

  message.className =
    `state-house-message ${
      author === "YOU"
        ? "founder-message"
        : "prime-message"
    }`;

  const authorElement =
    document.createElement(
      "span"
    );

  authorElement.className =
    "message-author";

  authorElement.textContent =
    author;

  const body =
    document.createElement(
      "p"
    );

  body.textContent =
    text;

  message.append(
    authorElement,
    body
  );

  stateHouseTranscript.append(
    message
  );

  stateHouseTranscript.scrollTop =
    stateHouseTranscript.scrollHeight;
}

function showStateHouseEvidence(
  response
) {
  if (!stateHouseEvidence) {
    return;
  }

  const lines = [];

  if (
    response &&
    typeof response.run_id ===
      "string"
  ) {
    lines.push(
      `RUN ${response.run_id}`
    );
  }

  if (
    response &&
    response.receipt &&
    typeof response.receipt ===
      "object"
  ) {
    const receipt =
      response.receipt;

    if (receipt.receipt_id) {
      lines.push(
        `RECEIPT ${receipt.receipt_id}`
      );
    }

    if (receipt.vera) {
      lines.push(
        `VERA ${receipt.vera}`
      );
    }

    if (receipt.rook) {
      lines.push(
        `ROOK ${receipt.rook}`
      );
    }

    if (receipt.promotion) {
      lines.push(
        `PROMOTION ${receipt.promotion}`
      );
    }

    if (receipt.failure) {
      lines.push(
        `FAILURE ${receipt.failure}`
      );
    }
  }

  if (
    response &&
    Array.isArray(
      response.evidence
    )
  ) {
    for (
      const item of
      response.evidence
    ) {
      if (
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      lines.push(
        [
          item.agent_id ??
            "UNKNOWN",
          ...(item.event_ids ?? []),
          ...(item.artifact_ids ?? [])
        ].join(" · ")
      );
    }
  }

  stateHouseEvidence.hidden =
    lines.length === 0;

  stateHouseEvidence.textContent =
    lines.join("\n");
}

async function messagePrime(
  message
) {
  const response =
    await fetch(
      "/api/prime/message",
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body: JSON.stringify({
          message
        })
      }
    );

  let payload;

  try {
    payload =
      await response.json();
  } catch {
    throw new Error(
      "Prime returned an unreadable response."
    );
  }

  if (!response.ok) {
    throw new Error(
      payload?.error ??
        `Prime request failed (${response.status}).`
    );
  }

  return payload;
}

stateHouseClose?.addEventListener(
  "click",
  closeStateHouse
);

stateHouseConsole?.addEventListener(
  "click",
  event => {
    if (
      event.target ===
      stateHouseConsole
    ) {
      closeStateHouse();
    }
  }
);

document.addEventListener(
  "keydown",
  event => {
    if (
      event.key === "Escape" &&
      stateHouseConsole?.classList
        .contains("open")
    ) {
      closeStateHouse();
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      document.activeElement ===
        stateHouseInput
    ) {
      event.preventDefault();

      stateHouseForm
        ?.requestSubmit();
    }
  }
);

stateHouseForm?.addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    const message =
      stateHouseInput?.value
        .trim();

    if (!message) {
      return;
    }

    appendStateHouseMessage(
      "YOU",
      message
    );

    stateHouseInput.value =
      "";

    stateHouseBusy(true);

    try {
      const response =
        await messagePrime(
          message
        );

      appendStateHouseMessage(
        "PRIME",
        typeof response.reply ===
          "string"
          ? response.reply
          : "Prime completed the request but returned no readable reply."
      );

      showStateHouseEvidence(
        response
      );

      /*
       * Refresh persisted world truth after Prime returns.
       * This does not invent activity.
       */
      await refreshLakeYangeProjection();
    } catch (error) {
      appendStateHouseMessage(
        "PRIME",
        error instanceof Error
          ? error.message
          : "State House request failed."
      );
    } finally {
      stateHouseBusy(false);
      stateHouseInput?.focus();
    }
  }
);

/* State House visible-geometry interaction bridge */
document.addEventListener(
  "click",
  event => {
    const visibleStateHouse =
      event.target.closest?.(
        ".state-house-building, .state-house .entity-label"
      );

    if (!visibleStateHouse) {
      return;
    }

    event.stopPropagation();

    const panel =
      document.querySelector(
        "#state-house-console"
      );

    if (!panel) {
      console.error(
        "[Lake Yange] State House console missing."
      );
      return;
    }

    panel.classList.add("open");
    panel.setAttribute(
      "aria-hidden",
      "false"
    );

    document
      .querySelector(
        "#state-house-input"
      )
      ?.focus();
  },
  true
);

/* =========================================================
   LAKE YANGE DIGITAL CITY PRESENTATION LAYER
   Geographic markers do not imply operational activity.
   ========================================================= */

function renderLakeYangeDigitalCity() {
  const twin =
    window.LAKE_YANGE_GEOGRAPHY;

  if (!twin) {
    return;
  }

  const layer =
    document.querySelector(
      "#lake-yange-poi-layer"
    );

  if (!layer) {
    return;
  }

  layer.innerHTML =
    twin.pois
      .map(
        poi => `
          <div
            class="lake-yange-poi"
            data-lake-yange-poi="${poi.id}"
            style="
              left:${poi.x}%;
              top:${poi.y}%;
            "
          >
            <div class="poi-marker">
              <span>${poi.icon}</span>
            </div>

            <div class="poi-label">
              <strong>${poi.name}</strong>
              <span>${poi.type}</span>
            </div>
          </div>
        `
      )
      .join("");

  layer
    .querySelectorAll(
      ".lake-yange-poi"
    )
    .forEach(
      element => {
        element.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            document
              .querySelectorAll(
                ".lake-yange-poi.selected"
              )
              .forEach(
                selected =>
                  selected.classList
                    .remove(
                      "selected"
                    )
              );

            element.classList.add(
              "selected"
            );

            const poi =
              twin.pois.find(
                candidate =>
                  candidate.id ===
                  element.dataset
                    .lakeYangePoi
              );

            if (!poi) {
              return;
            }

            inspect({
              name:
                poi.name,

              type:
                poi.type,

              description:
                poi.description,

              facts: {
                SUBURB:
                  "LAKE YANGE",

                POSTCODE:
                  "LAKE YANGE",

                MUNICIPALITY:
                  "LAKE YANGE",

                LAYER:
                  "GEOGRAPHIC LANDMARK",

                OPERATIONAL_ACTIVITY:
                  "NONE IMPLIED"
              }
            });
          }
        );
      }
    );

  for (
    const institution
    of twin.lakeYangeInstitutions
  ) {
    const element =
      document.querySelector(
        `[data-landmark="${institution.id}"]`
      );

    if (!element) {
      continue;
    }

    element.style.setProperty(
      "--x",
      `${institution.x}%`
    );

    element.style.setProperty(
      "--y",
      `${institution.y}%`
    );

    element.dataset.zone =
      institution.zone;
  }

  const subtitle =
    document.querySelector(
      ".brand-subtitle"
    );

  if (subtitle) {
    subtitle.textContent =
      "SOVEREIGN LOCAL AI CIVILISATION";
  }

  const instruction =
    document.querySelector(
      ".world-instruction"
    );

  if (instruction) {
    instruction.textContent =
      "LAKE YANGE · DRAG · ZOOM · SELECT A LANDMARK OR INSTITUTION";
  }
}

renderLakeYangeDigitalCity();

/* LAKE YANGE ACADEMY UI + FUNCTIONAL NAV */

let academyState = null;

function academyEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function openAcademy() {
  const panel =
    document.querySelector("#academy-console");

  const summary =
    document.querySelector("#academy-summary");

  const roster =
    document.querySelector("#academy-students");

  const detail =
    document.querySelector(
      "#academy-student-detail"
    );

  if (!panel || !summary || !roster || !detail) {
    return;
  }

  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");

  summary.textContent =
    "Loading persisted Academy state…";

  try {
    const response = await fetch(
      "/api/lake-yange/academy",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(
        `Academy HTTP ${response.status}`
      );
    }

    academyState = await response.json();

    const students =
      academyState.students ?? [];

    const assignments =
      academyState.assignments ?? [];

    const submissions =
      academyState.submissions ?? [];

    const grades =
      academyState.grades ?? [];

    summary.innerHTML = `
      <div><strong>${students.length}</strong><span>STUDENTS</span></div>
      <div><strong>${assignments.length}</strong><span>ASSIGNMENTS</span></div>
      <div><strong>${submissions.length}</strong><span>SUBMISSIONS</span></div>
      <div><strong>${grades.length}</strong><span>GRADES</span></div>
    `;

    function showStudent(student) {
      const work = assignments.filter(
        item =>
          item.citizen_id === student.citizen_id
      );

      detail.innerHTML = `
        <div class="academy-profile-head">
          <div class="academy-avatar">
            ${academyEscape(
              student.citizen_id?.slice(-1) ?? "AI"
            )}
          </div>

          <div>
            <span class="academy-id">
              ${academyEscape(student.citizen_id)}
            </span>

            <h3>
              ${academyEscape(
                student.name ??
                student.citizen_id
              )}
            </h3>

            <span class="academy-enrolment">
              ${student.enrolled
                ? "ENROLLED"
                : "ACADEMY CITIZEN"}
            </span>
          </div>
        </div>

        <div class="academy-metrics">
          <div>
            <span>CAPABILITY</span>
            <strong>${student.capability_score ?? 0}</strong>
          </div>

          <div>
            <span>ECONOMIC FITNESS</span>
            <strong>${student.economic_fitness ?? 0}</strong>
          </div>

          <div>
            <span>COMPLETED</span>
            <strong>${student.assignments_completed ?? 0}</strong>
          </div>

          <div>
            <span>FAILED</span>
            <strong>${student.assignments_failed ?? 0}</strong>
          </div>
        </div>

        <section class="academy-record-section">
          <h4>ASSIGNMENTS</h4>

          ${
            work.length
              ? work.map(item => `
                  <article class="academy-record">
                    <strong>
                      ${academyEscape(
                        item.course_id ??
                        item.assignment_id
                      )}
                    </strong>

                    <em class="academy-status">
                      ${academyEscape(
                        item.status ?? "UNKNOWN"
                      )}
                    </em>

                    <p>
                      ${academyEscape(
                        item.objective ??
                        "Persisted Academy assignment."
                      )}
                    </p>
                  </article>
                `).join("")
              : `
                <p class="academy-empty">
                  No persisted assignments.
                </p>
              `
          }
        </section>

        <div class="academy-authority">
          EDUCATIONAL AUTHORITY ONLY
        </div>
      `;
    }

    roster.innerHTML =
      students.map((student, index) => `
        <button
          class="academy-student ${index === 0 ? "active" : ""}"
          data-student-index="${index}"
          type="button"
        >
          <span class="academy-student-symbol">
            ${academyEscape(
              student.citizen_id?.slice(-1) ?? "AI"
            )}
          </span>

          <span>
            <strong>
              ${academyEscape(
                student.name ??
                student.citizen_id
              )}
            </strong>

            <small>
              ${
                assignments.some(
                  a =>
                    a.citizen_id ===
                    student.citizen_id
                )
                  ? "ASSIGNMENT ACTIVE"
                  : "NO ACTIVE ASSIGNMENT"
              }
            </small>
          </span>
        </button>
      `).join("");

    roster
      .querySelectorAll("[data-student-index]")
      .forEach(button => {
        button.addEventListener("click", () => {
          roster
            .querySelectorAll(".academy-student")
            .forEach(item =>
              item.classList.remove("active")
            );

          button.classList.add("active");

          showStudent(
            students[
              Number(button.dataset.studentIndex)
            ]
          );
        });
      });

    if (students[0]) {
      showStudent(students[0]);
    } else {
      detail.textContent =
        "No persisted Academy students.";
    }

  } catch (error) {
    summary.innerHTML =
      '<div class="academy-error">Academy state unavailable.</div>';

    console.error(error);
  }
}

function closeAcademy() {
  const panel =
    document.querySelector("#academy-console");

  panel?.classList.remove("open");
  panel?.setAttribute("aria-hidden", "true");
}

window.LakeYange =
  window.LakeYange || {};

window.LakeYange.openAcademy =
  openAcademy;

document
  .querySelector("#academy-close")
  ?.addEventListener("click", closeAcademy);


/* FUNCTIONAL WORLD NAV */

document
  .querySelectorAll(
    ".world-nav [data-view]"
  )
  .forEach(button => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;

      document
        .querySelectorAll(
          ".world-nav [data-view]"
        )
        .forEach(item =>
          item.classList.toggle(
            "active",
            item === button
          )
        );

      if (view === "world") {
        closeAcademy();

        camera.x = 0;
        camera.y = 0;
        camera.scale = 0.78;
        applyCamera();

        return;
      }

      if (view === "government") {
        closeAcademy();
        window.LakeYange?.openPrime?.();
        return;
      }

      const labels = {
        citizens: [
          "CITIZENS",
          "POPULATION",
          "Persisted Lake Yange citizens."
        ],
        resources: [
          "RESOURCES",
          "WORLD RESOURCES",
          "Persisted resource projection."
        ],
        artifacts: [
          "ARTIFACTS",
          "EVIDENCE",
          "Verified artifacts and evidence records."
        ],
        missions: [
          "MISSIONS",
          "OPERATIONS",
          "Persisted Lake Yange mission state."
        ]
      };

      const selected = labels[view];

      if (
        selected &&
        typeof window.inspect === "function"
      ) {
        closeAcademy();

        window.inspect({
          name: selected[0],
          type: selected[1],
          description: selected[2],
          facts: {
            SOURCE: "PERSISTED STATE ONLY",
            TRUTH: "NO ARTIFACT / NO CLAIM"
          }
        });
      }
    });
  });
