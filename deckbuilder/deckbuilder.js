import { canBeCommander, lookupCard } from "./scryfall.js";
import {
  buildUngroupedPool,
  extractGameChangerNames,
  fetchCommanderPage,
} from "./edhrec.js";
import { buildDeck } from "./build.js";
import { copyDecklist, formatMoxfield } from "./export.js";

const form = document.getElementById("build-form");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const resultsEl = document.getElementById("results");
const previewEl = document.getElementById("deck-preview");
const buildBtn = document.getElementById("build-btn");
const copyBtn = document.getElementById("copy-btn");
const mixHint = document.getElementById("mix-hint");
const synergyPercentInput = document.getElementById("synergy-percent");
const landInput = document.getElementById("land-count");
const maxGameChangersInput = document.getElementById("max-game-changers");
const allowTutorsInput = document.getElementById("allow-tutors");
const commander1 = document.getElementById("commander-1");
const commander2 = document.getElementById("commander-2");

let lastDeckText = "";

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function setError(msg) {
  if (!msg) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = msg;
}

function colorIdentityUnion(commanders) {
  const set = new Set();
  for (const c of commanders) {
    for (const color of c.color_identity || []) set.add(color);
  }
  return [...set];
}

function commanderSlotCount() {
  return commander2.value.trim() ? 2 : 1;
}

let lastCommanderSlots = commanderSlotCount();

function readMix() {
  return {
    synergyPercent: Number.parseInt(synergyPercentInput.value, 10),
    targetLands: Number.parseInt(landInput.value, 10),
    maxGameChangers: Number.parseInt(maxGameChangersInput.value, 10),
    allowTutors: allowTutorsInput.checked,
  };
}

function updateMixHint() {
  const slots = commanderSlotCount();
  if (slots !== lastCommanderSlots) {
    const delta = lastCommanderSlots - slots;
    const lands = Number.parseInt(landInput.value, 10);
    if (Number.isFinite(lands)) {
      landInput.value = String(Math.max(0, lands + delta));
    }
    lastCommanderSlots = slots;
  }

  const pct = Number.parseInt(synergyPercentInput.value, 10);
  const lands = Number.parseInt(landInput.value, 10);
  const cmd = slots;
  const nonLands = 100 - cmd - (Number.isFinite(lands) ? lands : 0);
  const valid =
    Number.isFinite(pct) &&
    pct >= 0 &&
    pct <= 100 &&
    Number.isFinite(lands) &&
    lands >= 0 &&
    nonLands >= 0;

  if (!valid) {
    mixHint.textContent = "Synergy % must be 0–100; lands + commanders must leave room for non-lands.";
    mixHint.classList.add("invalid");
    return;
  }

  const synergyCards = Math.round((nonLands * pct) / 100);
  const inclusionCards = nonLands - synergyCards;
  const inclusionPct = 100 - pct;
  const cmdLabel = cmd === 1 ? "1 commander" : "2 commanders";
  mixHint.textContent =
    `${pct}% synergy / ${inclusionPct}% inclusion → ${synergyCards} + ${inclusionCards} non-lands · ${lands} lands · ${cmdLabel}`;
  mixHint.classList.remove("invalid");
}

for (const el of [synergyPercentInput, landInput, commander1, commander2]) {
  el.addEventListener("input", updateMixHint);
}
updateMixHint();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");
  resultsEl.hidden = true;
  lastDeckText = "";
  buildBtn.disabled = true;

  const name1 = commander1.value.trim();
  const name2 = commander2.value.trim();
  const mix = readMix();

  try {
    const cmdSlots = name2 ? 2 : 1;
    const nonLands = 100 - cmdSlots - mix.targetLands;
    if (!Number.isFinite(mix.synergyPercent) || mix.synergyPercent < 0 || mix.synergyPercent > 100) {
      throw new Error("Synergy % must be between 0 and 100.");
    }
    if (!Number.isFinite(mix.targetLands) || mix.targetLands < 0 || nonLands < 0) {
      throw new Error(
        `Lands + commanders must leave room for non-lands (max lands: ${100 - cmdSlots}).`
      );
    }

    setStatus("Looking up commander(s) on Scryfall…");
    const commanders = [];
    const inputs = [
      { el: commander1, name: name1 },
      { el: commander2, name: name2 },
    ].filter((x) => x.name);
    for (const { el, name } of inputs) {
      const card = await lookupCard(name);
      if (!canBeCommander(card)) {
        throw new Error(
          `"${card.name}" is not a valid commander (need a legendary creature, partner/background, or similar).`
        );
      }
      // Reflect the resolved Scryfall name (helps with DFCs / typos).
      el.value = card.name;
      commanders.push(card);
    }

    setStatus("Fetching EDHREC recommendations…");
    const edhrec = await fetchCommanderPage(commanders.map((c) => c.name));
    const gameChangers = extractGameChangerNames(edhrec);
    const pool = buildUngroupedPool(edhrec, gameChangers);
    if (!pool.length) {
      throw new Error("EDHREC returned no card recommendations for this commander.");
    }

    setStatus("Building deck (synergy → inclusion → basics)…");
    const identity = colorIdentityUnion(commanders);
    const deck = await buildDeck(pool, commanders, identity, mix);
    lastDeckText = formatMoxfield(deck.commanders, deck.mainboard);

    previewEl.textContent = lastDeckText;
    resultsEl.hidden = false;

    const BASIC_NAMES = new Set(["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"]);
    const mainCount = deck.mainboard.reduce((n, c) => n + c.qty, 0);
    const landCards = deck.mainboard.filter((c) => c.isLand);
    const basicQty = landCards
      .filter((c) => BASIC_NAMES.has(c.name))
      .reduce((n, c) => n + c.qty, 0);
    const nonbasicQty = landCards
      .filter((c) => !BASIC_NAMES.has(c.name))
      .reduce((n, c) => n + c.qty, 0);
    const gcs = deck.mainboard.reduce((n, c) => n + (c.isGameChanger ? c.qty : 0), 0);
    const syn = deck.options.synergyNonLands;
    const inc = deck.options.inclusionNonLands;
    setStatus(
      `Done — ${commanders.map((c) => c.name).join(" + ")} · ${syn} synergy + ${inc} inclusion · ` +
        `${nonbasicQty} nonbasic lands + ${basicQty} basics · ${gcs} game changers · ${mainCount + commanders.length} total.`
    );
  } catch (err) {
    console.error(err);
    setStatus("");
    setError(err.message || String(err));
  } finally {
    buildBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  if (!lastDeckText) return;
  const label = copyBtn.textContent;
  try {
    await copyDecklist(lastDeckText);
    copyBtn.textContent = "Copied!";
  } catch (err) {
    console.error(err);
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => {
    copyBtn.textContent = label;
  }, 1500);
});
