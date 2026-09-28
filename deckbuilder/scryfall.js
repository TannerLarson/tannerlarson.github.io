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
  if (res.status === 404) {
    const err = new Error("Card not found on Scryfall");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Scryfall error ${res.status}`);
  }
  return res.json();
}

/**
 * Fuzzy named lookup.
 * @param {string} name
 */
export async function lookupCard(name) {
  const url = `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name.trim())}`;
  return scryfallFetch(url);
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
  if (keywords.some((k) => commanderKeywords.some((ck) => k.toLowerCase() === ck.toLowerCase()))) {
    return true;
  }

  // Background enchantments / similar: Legendary + Enchantment — Background
  if (/\bLegendary\b/i.test(type) && /\bBackground\b/i.test(type)) return true;

  const oracle = (card.oracle_text || "").toLowerCase();
  if (oracle.includes("can be your commander")) return true;

  return false;
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
    }

    // Be polite between chunks
    if (i + 75 < unique.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return byName;
}

const COLOR_PIP_RE = /\{([WUBRGC])(?:\/([WUBRGC]))?\}/gi;

/**
 * Count colored pips from a mana_cost string.
 * Each monocolor symbol = 1; hybrid sides each count (e.g. {W/U} → W+1, U+1).
 * Ignores generic {N} and bare {C} for identity pip shares (C tracked but unused for basics bias).
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
