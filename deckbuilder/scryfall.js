import { SCRYFALL_USER_AGENT } from "./config.js";

const SCRYFALL = "https://api.scryfall.com";

const headers = {
  Accept: "application/json",
  "User-Agent": SCRYFALL_USER_AGENT,
};

async function scryfallFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data.details || data.error || `Scryfall error ${res.status}`
    );
    err.code = res.status === 404 ? "NOT_FOUND" : "ERROR";
    err.status = res.status;
    err.scryfall = data;
    throw err;
  }
  return data;
}

/**
 * Resolve a card name via fuzzy named lookup, then Scryfall search.
 * Uses a unique match even when the typed text is incomplete
 * (e.g. "Isilu" → Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight).
 * If search returns several cards but only one can be a commander, use that.
 * @param {string} name
 */
export async function lookupCard(name) {
  const q = name.trim();
  if (!q) throw new Error("Empty card name");

  try {
    return await scryfallFetch(
      `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(q)}`
    );
  } catch (e) {
    if (e.code !== "NOT_FOUND") throw e;
  }

  let data;
  try {
    data = await scryfallFetch(
      `${SCRYFALL}/cards/search?q=${encodeURIComponent(q)}`
    );
  } catch (e) {
    if (e.code === "NOT_FOUND") {
      throw new Error(`No Scryfall match for "${q}"`);
    }
    throw e;
  }

  const cards = data.data || [];
  if (cards.length === 1) return cards[0];

  const asCommanders = cards.filter(canBeCommander);
  if (asCommanders.length === 1) return asCommanders[0];

  const sample = cards
    .slice(0, 5)
    .map((c) => c.name)
    .join(", ");
  throw new Error(
    `Ambiguous name "${q}" (${cards.length} matches` +
      `${asCommanders.length ? `, ${asCommanders.length} possible commanders` : ""}): ` +
      `${sample}${cards.length > 5 ? "…" : ""}`
  );
}

/**
 * True if the card can be a commander (not merely commander-legal).
 * @param {object} card
 */
export function canBeCommander(card) {
  if (card.legalities?.commander !== "legal") return false;

  const type = card.type_line || "";
  if (/\bLegendary\b/i.test(type) && /\bCreature\b/i.test(type)) return true;

  const keywords = card.keywords || [];
  const commanderKeywords = [
    "Partner",
    "Partner with",
    "Friends forever",
    "Choose a Background",
    "Doctor's companion",
  ];
  if (
    keywords.some((k) =>
      commanderKeywords.some((ck) => k.toLowerCase() === ck.toLowerCase())
    )
  ) {
    return true;
  }

  if (/\bLegendary\b/i.test(type) && /\bBackground\b/i.test(type)) return true;

  const oracle = oracleText(card).toLowerCase();
  if (oracle.includes("can be your commander")) return true;

  return false;
}

/** @param {object} card */
function oracleText(card) {
  if (card.oracle_text) return card.oracle_text;
  if (Array.isArray(card.card_faces)) {
    return card.card_faces.map((f) => f.oracle_text || "").join("\n");
  }
  return "";
}

/**
 * Mana cost string for pip counting (joins DFC faces when needed).
 * @param {object} card
 */
export function cardManaCost(card) {
  if (card?.mana_cost) return card.mana_cost;
  if (Array.isArray(card?.card_faces)) {
    return card.card_faces.map((f) => f.mana_cost || "").join("");
  }
  return "";
}

/**
 * Batch card metadata via /cards/collection (chunks of 75).
 * @param {string[]} names
 * @returns {Promise<Map<string, object>>} name → card (lowercased key + exact name key)
 */
export async function fetchCollection(names) {
  const unique = [...new Set(names.filter(Boolean))];
  const byName = new Map();

  for (let i = 0; i < unique.length; i += 75) {
    const chunk = unique.slice(i, i + 75);
    const body = {
      identifiers: chunk.map((name) => ({ name })),
    };
    const data = await scryfallFetch(`${SCRYFALL}/cards/collection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    for (const card of data.data || []) {
      byName.set(card.name.toLowerCase(), card);
      byName.set(card.name, card);
      // Also index front face for DFC lookups
      const front = card.name.split(/\s*\/\/\s*/)[0];
      if (front && front !== card.name) {
        byName.set(front.toLowerCase(), card);
        byName.set(front, card);
      }
    }

    if (i + 75 < unique.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return byName;
}

const COLOR_PIP_RE = /\{([WUBRGC])(?:\/([WUBRGC]))?\}/gi;

/**
 * Count colored pips from a mana_cost string.
 * @param {string} manaCost
 * @returns {Record<string, number>}
 */
export function countPips(manaCost) {
  const counts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  if (!manaCost) return counts;

  for (const match of manaCost.matchAll(COLOR_PIP_RE)) {
    const a = match[1].toUpperCase();
    const b = match[2]?.toUpperCase();
    if (a !== "C" && counts[a] !== undefined) counts[a] += 1;
    if (b && b !== "C" && counts[b] !== undefined) counts[b] += 1;
  }
  return counts;
}

export function mergePipCounts(...parts) {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const part of parts) {
    for (const c of Object.keys(out)) {
      out[c] += part[c] || 0;
    }
  }
  return out;
}
