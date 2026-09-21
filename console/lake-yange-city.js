(() => {
  const geography =
    window.LAKE_YANGE_GEOGRAPHY;

  const viewport =
    document.querySelector(".world-viewport");

  if (!viewport || !geography) {
    console.error(
      "[Lake Yange] city renderer prerequisites missing"
    );
    return;
  }

  const legacy =
    viewport.querySelector(".world-surface");

  if (legacy) {
    legacy.style.display = "none";
  }

  const city =
    document.createElement("div");

  city.id = "lake-yange-city";

  city.innerHTML = `
    <div class="ly-city-terrain"></div>
    <div class="ly-city-grid"></div>

    <div class="ly-water ly-water-nw"></div>
    <div class="ly-water ly-water-se"></div>

    <div class="ly-road ly-road-a"></div>
    <div class="ly-road ly-road-b"></div>
    <div class="ly-road ly-road-c"></div>
    <div class="ly-road ly-road-d"></div>
    <div class="ly-road ly-road-e"></div>

    <div class="ly-neighbourhood ly-neighbourhood-a"></div>
    <div class="ly-neighbourhood ly-neighbourhood-b"></div>
    <div class="ly-neighbourhood ly-neighbourhood-c"></div>
    <div class="ly-neighbourhood ly-neighbourhood-d"></div>

    <div class="ly-core-ring">
      <span>LAKE YANGE CORE</span>
    </div>

    <div id="ly-building-layer"></div>
    <div id="ly-poi-layer"></div>

    <div class="ly-city-title">
      <strong>LAKE YANGE</strong>
      <span>LOCAL AI CIVILISATION</span>
    </div>

    <div class="ly-map-status">
      CITY PROJECTION · PERSISTED ACTIVITY ONLY
    </div>
  `;

  viewport.prepend(city);

  const buildings = [
    {
      id: "prime",
      name: "PRIME TOWER",
      role: "GOVERNANCE",
      x: 50,
      y: 43,
      kind: "tower"
    },
    {
      id: "academy",
      name: "ACADEMY",
      role: "LEARNING",
      x: 50,
      y: 62,
      kind: "academy"
    },
    {
      id: "model",
      name: "MODEL COMMONS",
      role: "LOCAL COGNITION",
      x: 61,
      y: 34,
      kind: "spire"
    },
    {
      id: "vera",
      name: "VERA ARCHIVE",
      role: "EVIDENCE",
      x: 62,
      y: 48,
      kind: "archive"
    },
    {
      id: "ledger",
      name: "LEDGER HOUSE",
      role: "ECONOMICS",
      x: 38,
      y: 48,
      kind: "ledger"
    },
    {
      id: "rook",
      name: "ROOK KEEP",
      role: "ADVERSARIAL",
      x: 39,
      y: 34,
      kind: "keep"
    },
    {
      id: "scout",
      name: "SCOUT OUTPOST",
      role: "RESEARCH",
      x: 27,
      y: 44,
      kind: "outpost"
    },
    {
      id: "forge",
      name: "FORGE",
      role: "ENGINEERING",
      x: 46,
      y: 75,
      kind: "forge"
    },
    {
      id: "gate",
      name: "WORLD GATE",
      role: "EXTERNAL BOUNDARY",
      x: 72,
      y: 73,
      kind: "gate"
    }
  ];

  const buildingLayer =
    city.querySelector("#ly-building-layer");

  for (const building of buildings) {
    const node =
      document.createElement("button");

    node.className =
      `ly-building ly-${building.kind}`;

    node.dataset.building =
      building.id;

    node.style.left =
      `${building.x}%`;

    node.style.top =
      `${building.y}%`;

    node.innerHTML = `
      <span class="ly-building-glow"></span>
      <span class="ly-building-body"></span>

      <span class="ly-building-label">
        <strong>${building.name}</strong>
        <small>${building.role}</small>
      </span>
    `;

    node.addEventListener(
      "click",
      () => {
        if (
          building.id === "prime" &&
          window.LakeYange?.openPrime
        ) {
          window.LakeYange.openPrime();
          return;
        }

        if (
          building.id === "academy" &&
          window.LakeYange?.openAcademy
        ) {
          window.LakeYange.openAcademy();
          return;
        }

        if (
          typeof window.inspect ===
          "function"
        ) {
          window.inspect({
            name: building.name,
            type: building.role,
            description:
              `${building.name} is a Lake Yange institution.`,
            facts: {
              CITY: "LAKE YANGE",
              ROLE: building.role,
              ACTIVITY:
                "STATE BACKED ONLY"
            }
          });
        }
      }
    );

    buildingLayer.appendChild(node);
  }

  const poiLayer =
    city.querySelector("#ly-poi-layer");

  for (const poi of geography.pois ?? []) {
    const node =
      document.createElement("button");

    node.className =
      "ly-poi";

    node.style.left =
      `${poi.x}%`;

    node.style.top =
      `${poi.y}%`;

    node.innerHTML = `
      <span class="ly-poi-dot"></span>

      <span class="ly-poi-label">
        <strong>${poi.name}</strong>
        <small>${poi.type}</small>
      </span>
    `;

    node.addEventListener(
      "click",
      () => {
        if (
          typeof window.inspect ===
          "function"
        ) {
          window.inspect({
            name: poi.name,
            type: poi.type,
            description:
              poi.description,
            facts: {
              CITY: "LAKE YANGE",
              CLASS:
                "GEOGRAPHIC LANDMARK"
            }
          });
        }
      }
    );

    poiLayer.appendChild(node);
  }

  console.log(
    "[Lake Yange] new city renderer mounted"
  );
})();

/* ============================================================
   LAKE YANGE CITY V2
   Dense deterministic urban fabric.
   Decorative structures imply no operational activity.
   ============================================================ */

function lyHash(value) {
  let h = 2166136261;

  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

function lyRandom(seed, index) {
  const h = lyHash(`${seed}:${index}`);
  return (h % 10000) / 10000;
}

function createLakeYangeFabric() {
  const city =
    document.querySelector("#lake-yange-city");

  if (!city) {
    return;
  }

  if (
    city.querySelector(
      "#ly-urban-fabric"
    )
  ) {
    return;
  }

  const layer =
    document.createElement("div");

  layer.id = "ly-urban-fabric";
  layer.className =
    "ly-urban-fabric";

  const exclusions = [
    [50, 44, 17, 19],
    [50, 62, 14, 12],
    [61, 34, 10, 10],
    [39, 37, 10, 10],
    [63, 47, 10, 10],
    [37, 48, 10, 10],
    [46, 76, 12, 10],
    [76, 67, 12, 12],
    [15, 14, 16, 12],
    [86, 84, 15, 12]
  ];

  function excluded(x, y) {
    return exclusions.some(
      ([cx, cy, w, h]) =>
        Math.abs(x - cx) < w &&
        Math.abs(y - cy) < h
    );
  }

  const districts = [
    {
      id: "north-west",
      x1: 8,
      x2: 37,
      y1: 18,
      y2: 39
    },
    {
      id: "north-east",
      x1: 67,
      x2: 91,
      y1: 17,
      y2: 42
    },
    {
      id: "west",
      x1: 8,
      x2: 34,
      y1: 44,
      y2: 72
    },
    {
      id: "east",
      x1: 69,
      x2: 93,
      y1: 45,
      y2: 72
    },
    {
      id: "south-west",
      x1: 13,
      x2: 38,
      y1: 72,
      y2: 91
    },
    {
      id: "south-east",
      x1: 58,
      x2: 87,
      y1: 73,
      y2: 91
    }
  ];

  let structureIndex = 0;

  for (const district of districts) {
    const rows = 7;
    const cols = 10;

    for (
      let row = 0;
      row < rows;
      row += 1
    ) {
      for (
        let col = 0;
        col < cols;
        col += 1
      ) {
        const index =
          structureIndex++;

        const rx =
          lyRandom(
            district.id,
            index * 4
          );

        const ry =
          lyRandom(
            district.id,
            index * 4 + 1
          );

        const rw =
          lyRandom(
            district.id,
            index * 4 + 2
          );

        const rh =
          lyRandom(
            district.id,
            index * 4 + 3
          );

        const x =
          district.x1 +
          (
            (col + .25 + rx * .5) /
            cols
          ) *
          (
            district.x2 -
            district.x1
          );

        const y =
          district.y1 +
          (
            (row + .25 + ry * .5) /
            rows
          ) *
          (
            district.y2 -
            district.y1
          );

        if (excluded(x, y)) {
          continue;
        }

        const structure =
          document.createElement(
            "div"
          );

        const tall =
          rw > .82;

        structure.className =
          tall
            ? "ly-fabric-building tall"
            : "ly-fabric-building";

        structure.style.left =
          `${x}%`;

        structure.style.top =
          `${y}%`;

        structure.style.setProperty(
          "--fw",
          `${8 + rw * 12}px`
        );

        structure.style.setProperty(
          "--fh",
          `${7 + rh * (tall ? 35 : 16)}px`
        );

        structure.style.setProperty(
          "--fr",
          `${-12 + rw * 24}deg`
        );

        structure.innerHTML = `
          <span class="ly-fabric-roof"></span>
          <span class="ly-fabric-core"></span>
          <span class="ly-fabric-light"></span>
        `;

        layer.appendChild(
          structure
        );
      }
    }
  }

  city.appendChild(layer);
}

function createLakeYangeInfrastructure() {
  const city =
    document.querySelector(
      "#lake-yange-city"
    );

  if (
    !city ||
    city.querySelector(
      "#ly-infrastructure"
    )
  ) {
    return;
  }

  const layer =
    document.createElement("div");

  layer.id =
    "ly-infrastructure";

  layer.className =
    "ly-infrastructure";

  const nodes = [
    [22, 31],
    [31, 42],
    [43, 31],
    [50, 43],
    [59, 39],
    [68, 49],
    [77, 58],
    [31, 63],
    [43, 70],
    [57, 70],
    [68, 73],
    [82, 76]
  ];

  layer.innerHTML =
    nodes
      .map(
        ([x, y], index) => `
          <div
            class="ly-infra-node"
            style="
              left:${x}%;
              top:${y}%;
            "
          >
            <span></span>
            <i>${String(index + 1).padStart(2, "0")}</i>
          </div>
        `
      )
      .join("");

  city.appendChild(layer);
}

function createMoorhenComplex() {
  const city =
    document.querySelector(
      "#lake-yange-city"
    );

  if (
    !city ||
    city.querySelector(
      ".ly-moorhen-complex"
    )
  ) {
    return;
  }

  const oval =
    document.createElement("div");

  oval.className =
    "ly-moorhen-complex";

  oval.innerHTML = `
    <div class="ly-oval-field">
      <div class="ly-oval-centre"></div>
      <div class="ly-goal north"></div>
      <div class="ly-goal south"></div>
    </div>

    <div class="ly-oval-stand"></div>

    <div class="ly-landmark-caption">
      <strong>MOORHEN OVAL</strong>
      <span>SPORT · RECREATION</span>
    </div>
  `;

  city.appendChild(oval);
}

function createParkDistricts() {
  const city =
    document.querySelector(
      "#lake-yange-city"
    );

  if (
    !city ||
    city.querySelector(
      ".ly-park-district"
    )
  ) {
    return;
  }

  const parks = [
    {
      name: "LEVI PARK",
      className: "levi"
    },
    {
      name: "RONSARD PARK",
      className: "ronsard"
    }
  ];

  for (const park of parks) {
    const element =
      document.createElement(
        "div"
      );

    element.className =
      `ly-park-district ${park.className}`;

    element.innerHTML = `
      <div class="ly-park-path one"></div>
      <div class="ly-park-path two"></div>

      ${Array.from(
        { length: 14 },
        (_, i) => `
          <i
            class="ly-park-tree"
            style="
              --tx:${10 + lyRandom(park.name, i) * 80}%;
              --ty:${12 + lyRandom(park.name, i + 50) * 72}%;
            "
          ></i>
        `
      ).join("")}

      <span>${park.name}</span>
    `;

    city.appendChild(element);
  }
}

function createCommercialPrecinct() {
  const city =
    document.querySelector(
      "#lake-yange-city"
    );

  if (
    !city ||
    city.querySelector(
      ".ly-commercial-precinct"
    )
  ) {
    return;
  }

  const precinct =
    document.createElement(
      "div"
    );

  precinct.className =
    "ly-commercial-precinct";

  precinct.innerHTML = `
    <div class="ly-commercial-road"></div>

    <div class="ly-shop xiga">
      <div class="ly-shop-roof"></div>
      <strong>xIGA</strong>
      <span>LOCAL RETAIL</span>
    </div>

    <div class="ly-shop cookhouse">
      <div class="ly-shop-roof"></div>
      <strong>LW COOKHOUSE</strong>
      <span>LOCAL BUSINESS</span>
    </div>

    <div class="ly-shop chickens">
      <div class="ly-shop-roof"></div>
      <strong>TREATING CHICKENS</strong>
      <span>LOCAL BUSINESS</span>
    </div>

    <div class="ly-carpark">
      ${Array.from(
        { length: 13 },
        (_, i) =>
          `<i style="--car:${i}"></i>`
      ).join("")}
    </div>
  `;

  city.appendChild(
    precinct
  );
}

function createPrimeCivicPlaza() {
  const city =
    document.querySelector(
      "#lake-yange-city"
    );

  if (
    !city ||
    city.querySelector(
      ".ly-prime-plaza"
    )
  ) {
    return;
  }

  const plaza =
    document.createElement(
      "div"
    );

  plaza.className =
    "ly-prime-plaza";

  plaza.innerHTML = `
    <div class="ly-plaza-ring outer"></div>
    <div class="ly-plaza-ring middle"></div>
    <div class="ly-plaza-ring inner"></div>

    <div class="ly-plaza-axis north"></div>
    <div class="ly-plaza-axis east"></div>
    <div class="ly-plaza-axis south"></div>
    <div class="ly-plaza-axis west"></div>

    <div class="ly-prime-beacon"></div>
  `;

  city.appendChild(plaza);
}

function upgradeLakeYangeArchitecture() {
  const prime =
    document.querySelector(
      '.ly-building[data-building="prime"]'
    );

  if (prime) {
    prime.classList.add(
      "ly-prime-megastructure"
    );

    const body =
      prime.querySelector(
        ".ly-building-body"
      );

    if (
      body &&
      !body.querySelector(
        ".ly-prime-crown"
      )
    ) {
      body.innerHTML = `
        <div class="ly-prime-crown">
          <i></i><i></i><i></i>
        </div>

        <div class="ly-prime-spine"></div>

        <div class="ly-prime-wing left"></div>
        <div class="ly-prime-wing right"></div>

        <div class="ly-prime-chamber"></div>

        <div class="ly-prime-entrance"></div>
      `;
    }
  }

  const academy =
    document.querySelector(
      '.ly-building[data-building="academy"]'
    );

  academy?.classList.add(
    "ly-academy-campus"
  );

  const forge =
    document.querySelector(
      '.ly-building[data-building="forge"]'
    );

  forge?.classList.add(
    "ly-forge-complex"
  );

  const gate =
    document.querySelector(
      '.ly-building[data-building="gate"]'
    );

  gate?.classList.add(
    "ly-world-gate-complex"
  );
}

function bootLakeYangeCityV2() {
  createLakeYangeFabric();
  createLakeYangeInfrastructure();
  createMoorhenComplex();
  createParkDistricts();
  createCommercialPrecinct();
  createPrimeCivicPlaza();
  upgradeLakeYangeArchitecture();

  document
    .querySelector(
      "#lake-yange-city"
    )
    ?.classList.add(
      "lake-yange-city-v2"
    );
}

window.requestAnimationFrame(
  bootLakeYangeCityV2
);
