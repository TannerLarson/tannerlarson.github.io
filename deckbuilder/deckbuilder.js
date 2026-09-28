import { canBeCommander, lookupCard } from "./scryfall.js";
import { buildUngroupedPool, fetchCommanderPage } from "./edhrec.js";
import { buildDeck } from "./build.js";
import { downloadDecklist, formatMoxfield } from "./export.js";

const form = document.getElementById("build-form");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const resultsEl = document.getElementById("results");
const previewEl = document.getElementById("deck-preview");
const buildBtn = document.getElementById("build-btn");
const downloadBtn = document.getElementById("download-btn");

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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setError("");
  resultsEl.hidden = true;
  lastDeckText = "";
  buildBtn.disabled = true;

  const name1 = document.getElementById("commander-1").value.trim();
  const name2 = document.getElementById("commander-2").value.trim();

  try {
    setStatus("Looking up commander(s) on Scryfall…");
    const commanders = [];
    for (const name of [name1, name2].filter(Boolean)) {
      const card = await lookupCard(name);
      if (!canBeCommander(card)) {
        throw new Error(
          `"${card.name}" is not a valid commander (need a legendary creature, partner/background, or similar).`
        );
      }
      commanders.push(card);
    }

    setStatus("Fetching EDHREC recommendations…");
    const edhrec = await fetchCommanderPage(commanders.map((c) => c.name));
    const pool = buildUngroupedPool(edhrec);
    if (!pool.length) {
      throw new Error("EDHREC returned no card recommendations for this commander.");
    }

    setStatus("Building deck (synergy → inclusion → basics)…");
    const identity = colorIdentityUnion(commanders);
    const deck = await buildDeck(pool, commanders, identity);
    lastDeckText = formatMoxfield(deck.commanders, deck.mainboard);

    previewEl.textContent = lastDeckText;
    resultsEl.hidden = false;

    const mainCount = deck.mainboard.reduce((n, c) => n + c.qty, 0);
    setStatus(
      `Done — ${commanders.map((c) => c.name).join(" + ")} · ${mainCount + commanders.length} cards.`
    );
  } catch (err) {
    console.error(err);
    setStatus("");
    setError(err.message || String(err));
  } finally {
    buildBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!lastDeckText) return;
  downloadDecklist(lastDeckText);
});
