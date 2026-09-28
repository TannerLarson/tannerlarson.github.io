import {
  cardManaCost,
  countPips,
  fetchCollection,
  mergePipCounts,
} from "./scryfall.js";
import { isTutorCard } from "./filters.js";

const BASIC_BY_COLOR = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};

/**
 * @typedef {{
 *   synergyPercent?: number,
 *   targetLands?: number,
 *   maxGameChangers?: number,
 *   allowTutors?: boolean,
 * }} BuildOptions
 */

/**
 * @param {{ name: string, synergy: number, inclusion_pct: number, isLand: boolean, isGameChanger?: boolean }[]} pool
 * @param {object[]} commanders Scryfall cards
 * @param {string[]} colorIdentity e.g. ["G","U","W","B"]
 * @param {BuildOptions} [options]
 */
export async function buildDeck(pool, commanders, colorIdentity, options = {}) {
  const synergyPercent = clampInt(options.synergyPercent, 0, 100, 90);
  const targetLands = clampInt(options.targetLands, 0, 99, 39);
  const maxGameChangers = clampInt(options.maxGameChangers, 0, 99, 0);
  const allowTutors = options.allowTutors === true;

  // Lands input sizes the non-land budget. EDHREC lands picked along the way are extras;
  // basics then fill whatever slots remain to reach 100.
  const nonLandSlots = 100 - commanders.length - targetLands;
  if (nonLandSlots < 0) {
    throw new Error(
      `Too many lands for a 100-card deck with ${commanders.length} commander(s). ` +
        `Max lands: ${100 - commanders.length}.`
    );
  }

  const synergyTarget = Math.round((nonLandSlots * synergyPercent) / 100);
  const inclusionTarget = nonLandSlots;

  /** @type {Map<string, { name: string, qty: number, isLand: boolean, synergy: number, inclusion_pct: number, isGameChanger: boolean }>} */
  const mainboard = new Map();

  const addCard = (entry) => {
    const existing = mainboard.get(entry.name);
    if (existing) {
      existing.qty += 1;
      return;
    }
    mainboard.set(entry.name, {
      name: entry.name,
      qty: 1,
      isLand: !!entry.isLand,
      synergy: entry.synergy ?? 0,
      inclusion_pct: entry.inclusion_pct ?? 0,
      isGameChanger: !!entry.isGameChanger,
    });
  };

  const nonLandCount = () =>
    [...mainboard.values()].reduce((n, c) => n + (c.isLand ? 0 : c.qty), 0);

  const gameChangerCount = () =>
    [...mainboard.values()].reduce((n, c) => n + (c.isGameChanger ? c.qty : 0), 0);

  const allowedByFilters = (card) => {
    if (!allowTutors && isTutorCard(card.name)) return false;
    if (card.isGameChanger && gameChangerCount() >= maxGameChangers) return false;
    return true;
  };

  /**
   * Add every card (lands included). Stop condition is non-land count only.
   * @param {typeof pool[0]} card
   * @param {number} nonLandCap
   */
  const tryAdd = (card, nonLandCap) => {
    if (!allowedByFilters(card)) return;
    if (mainboard.has(card.name)) return;
    // Once non-land cap is hit we stop the pass entirely (caller breaks).
    // Lands encountered before that cap are always added.
    if (!card.isLand && nonLandCount() >= nonLandCap) return;
    addCard(card);
  };

  const bySynergy = [...pool].sort((a, b) => b.synergy - a.synergy);
  for (const card of bySynergy) {
    tryAdd(card, synergyTarget);
    if (nonLandCount() >= synergyTarget) break;
  }

  const byInclusion = [...pool].sort((a, b) => b.inclusion_pct - a.inclusion_pct);
  for (const card of byInclusion) {
    tryAdd(card, inclusionTarget);
    if (nonLandCount() >= inclusionTarget) break;
  }

  const names = [
    ...commanders.map((c) => c.name),
    ...[...mainboard.keys()],
  ];
  const meta = await fetchCollection(names);

  // Refine land flags from Scryfall; don't drop cards — they already earned a slot.
  for (const card of mainboard.values()) {
    const scry = meta.get(card.name) || meta.get(card.name.toLowerCase());
    if (scry?.type_line && /\bLand\b/i.test(scry.type_line)) {
      card.isLand = true;
    }
  }

  // If reclassification put us under the non-land target, keep walking inclusion.
  if (nonLandCount() < inclusionTarget) {
    for (const card of byInclusion) {
      tryAdd(card, inclusionTarget);
      if (nonLandCount() >= inclusionTarget) break;
    }
    const missingMeta = [...mainboard.keys()].filter(
      (n) => !meta.has(n) && !meta.has(n.toLowerCase())
    );
    if (missingMeta.length) {
      const extra = await fetchCollection(missingMeta);
      for (const [k, v] of extra) meta.set(k, v);
      for (const name of missingMeta) {
        const card = mainboard.get(name);
        const scry = meta.get(name) || meta.get(name.toLowerCase());
        if (card && scry?.type_line && /\bLand\b/i.test(scry.type_line)) {
          card.isLand = true;
        }
      }
    }
  }

  const mainboardCount = [...mainboard.values()].reduce((n, c) => n + c.qty, 0);
  const basicsNeeded = Math.max(0, 100 - commanders.length - mainboardCount);

  const colors = (colorIdentity || []).filter((c) => BASIC_BY_COLOR[c]);

  if (basicsNeeded > 0 && colors.length === 0) {
    bumpBasic(mainboard, "Wastes", basicsNeeded);
  } else if (basicsNeeded > 0 && colors.length === 1) {
    bumpBasic(mainboard, BASIC_BY_COLOR[colors[0]], basicsNeeded);
  } else if (basicsNeeded > 0) {
    allocateBasics(mainboard, meta, commanders, colors, basicsNeeded);
  }

  return {
    commanders,
    mainboard: [...mainboard.values()].sort((a, b) => a.name.localeCompare(b.name)),
    meta,
    options: {
      synergyPercent,
      targetLands,
      synergyNonLands: synergyTarget,
      inclusionNonLands: Math.max(0, inclusionTarget - synergyTarget),
      maxGameChangers,
      allowTutors,
    },
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bumpBasic(mainboard, name, qty) {
  const existing = mainboard.get(name);
  if (existing) {
    existing.qty += qty;
    existing.isLand = true;
  } else {
    mainboard.set(name, {
      name,
      qty,
      isLand: true,
      synergy: 0,
      inclusion_pct: 0,
      isGameChanger: false,
    });
  }
}

function allocateBasics(mainboard, meta, commanders, colors, basicsNeeded) {
  let pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const cmd of commanders) {
    pips = mergePipCounts(pips, countPips(cardManaCost(cmd)));
  }
  for (const card of mainboard.values()) {
    const scry = meta.get(card.name) || meta.get(card.name.toLowerCase());
    if (!scry) continue;
    const costPips = countPips(cardManaCost(scry));
    for (let i = 0; i < card.qty; i++) {
      pips = mergePipCounts(pips, costPips);
    }
  }

  const pipTotal = colors.reduce((n, c) => n + (pips[c] || 0), 0) || colors.length;
  const pipShare = {};
  for (const c of colors) {
    pipShare[c] = (pips[c] || 0) / pipTotal;
  }

  const sourceCounts = Object.fromEntries(colors.map((c) => [c, 0]));
  let existingLands = 0;
  for (const card of mainboard.values()) {
    if (!card.isLand) continue;
    existingLands += card.qty;
    const scry = meta.get(card.name) || meta.get(card.name.toLowerCase());
    const produced = scry?.produced_mana || [];
    for (let i = 0; i < card.qty; i++) {
      for (const c of colors) {
        if (produced.includes(c)) sourceCounts[c] += 1;
      }
    }
  }

  const totalLandsTarget = existingLands + basicsNeeded;
  const basicQty = Object.fromEntries(colors.map((c) => [c, 0]));

  for (let i = 0; i < basicsNeeded; i++) {
    let bestColor = colors[0];
    let bestScore = -Infinity;
    for (const c of colors) {
      const target = (pipShare[c] + 0.1) * totalLandsTarget;
      const current = sourceCounts[c] + basicQty[c];
      const shortfall = target - current;
      const score = shortfall + pipShare[c] * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestColor = c;
      }
    }
    basicQty[bestColor] += 1;
  }

  for (const c of colors) {
    if (basicQty[c]) bumpBasic(mainboard, BASIC_BY_COLOR[c], basicQty[c]);
  }
}
