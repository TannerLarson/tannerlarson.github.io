import {
  cardManaCost,
  cardUsdPrice,
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

const COLLECTION_CHUNK = 75;

/**
 * @typedef {{
 *   synergyPercent?: number,
 *   targetLands?: number,
 *   maxGameChangers?: number,
 *   allowTutors?: boolean,
 *   maxUsd?: number | null,
 * }} BuildOptions
 */

/**
 * @param {{ name: string, synergy: number, inclusion_pct: number, isLand: boolean, isGameChanger?: boolean }[]} pool
 * @param {object[]} commanders Scryfall cards
 * @param {string[]} colorIdentity e.g. ["G","U","W","B"]
 * @param {BuildOptions} [options]
 */
export async function buildDeck(pool, commanders, colorIdentity, options = {}) {
  const synergyPercent = clampInt(options.synergyPercent, 0, 100, 0);
  const targetLands = clampInt(options.targetLands, 0, 99, 39);
  const maxGameChangers = clampInt(options.maxGameChangers, 0, 99, 0);
  const allowTutors = options.allowTutors === true;
  const maxUsd =
    typeof options.maxUsd === "number" && Number.isFinite(options.maxUsd)
      ? options.maxUsd
      : null;

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

  // Price / game-changer filters need Scryfall fields. Otherwise we can walk on
  // EDHREC tags alone and only collection-fetch the final mainboard for pips.
  const needsLiveMeta = maxUsd != null || maxGameChangers < 99;

  /** @type {Map<string, object>} */
  const meta = new Map();

  /** @type {Map<string, { name: string, qty: number, isLand: boolean, synergy: number, inclusion_pct: number, isGameChanger: boolean }>} */
  const mainboard = new Map();

  const scryFor = (name) => meta.get(name) || meta.get(name.toLowerCase());

  const cardIsGameChanger = (card) => {
    const scry = scryFor(card.name);
    if (scry && typeof scry.game_changer === "boolean") return scry.game_changer;
    return !!card.isGameChanger;
  };

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
      isGameChanger: cardIsGameChanger(entry),
    });
  };

  const nonLandCount = () =>
    [...mainboard.values()].reduce((n, c) => n + (c.isLand ? 0 : c.qty), 0);

  const gameChangerCount = () =>
    [...mainboard.values()].reduce((n, c) => n + (c.isGameChanger ? c.qty : 0), 0);

  const underBudget = (card) => {
    if (maxUsd == null) return true;
    const scry = scryFor(card.name);
    if (!scry) return false;
    const price = cardUsdPrice(scry);
    // Digital-only default prints (e.g. Mana Flare / ME1) have null USD.
    if (price == null) return true;
    return price <= maxUsd;
  };

  const allowedByFilters = (card) => {
    if (!allowTutors && isTutorCard(card.name)) return false;
    if (needsLiveMeta) {
      if (!scryFor(card.name)) return false;
      if (cardIsGameChanger(card) && gameChangerCount() >= maxGameChangers) return false;
      if (!underBudget(card)) return false;
    } else if (card.isGameChanger && gameChangerCount() >= maxGameChangers) {
      return false;
    }
    return true;
  };

  /**
   * @param {typeof pool[0]} card
   * @param {number} nonLandCap
   */
  const tryAdd = (card, nonLandCap) => {
    if (!allowedByFilters(card)) return;
    if (mainboard.has(card.name)) return;
    if (!card.isLand && nonLandCount() >= nonLandCap) return;
    addCard(card);
  };

  /**
   * Prefetch the next window of candidates that still need Scryfall meta, then
   * walk until the non-land cap — avoids /cards/collection on the whole pool.
   * @param {typeof pool} sorted
   * @param {number} nonLandCap
   */
  const walkPass = async (sorted, nonLandCap) => {
    let i = 0;
    while (i < sorted.length && nonLandCount() < nonLandCap) {
      if (needsLiveMeta) {
        const prefetch = [];
        for (let j = i; j < sorted.length && prefetch.length < COLLECTION_CHUNK; j++) {
          const c = sorted[j];
          if (mainboard.has(c.name)) continue;
          if (!allowTutors && isTutorCard(c.name)) continue;
          if (!scryFor(c.name)) prefetch.push(c.name);
        }
        if (prefetch.length) await fetchCollection(prefetch, meta);
      }

      const startCount = nonLandCount();
      const startIdx = i;
      while (i < sorted.length && nonLandCount() < nonLandCap) {
        const card = sorted[i];
        if (needsLiveMeta && !mainboard.has(card.name) && !scryFor(card.name)) {
          // Need another prefetch window.
          if (!allowTutors && isTutorCard(card.name)) {
            i++;
            continue;
          }
          break;
        }
        tryAdd(card, nonLandCap);
        i++;
      }

      // No progress and still missing meta on current card — fetch it alone.
      if (
        i === startIdx &&
        nonLandCount() === startCount &&
        i < sorted.length &&
        needsLiveMeta &&
        !scryFor(sorted[i].name)
      ) {
        await fetchCollection([sorted[i].name], meta);
        tryAdd(sorted[i], nonLandCap);
        i++;
      } else if (i === startIdx && nonLandCount() === startCount) {
        i++; // avoid infinite loop on a stubborn card
      }
    }
  };

  const bySynergy = [...pool].sort((a, b) => b.synergy - a.synergy);
  const byInclusion = [...pool].sort((a, b) => b.inclusion_pct - a.inclusion_pct);

  await walkPass(bySynergy, synergyTarget);
  await walkPass(byInclusion, inclusionTarget);

  // Ensure mainboard has Scryfall rows for land refine + pip basics.
  const missingMain = [...mainboard.keys()].filter((n) => !scryFor(n));
  if (missingMain.length) await fetchCollection(missingMain, meta);

  for (const card of mainboard.values()) {
    const scry = scryFor(card.name);
    if (scry?.type_line && /\bLand\b/i.test(scry.type_line)) {
      card.isLand = true;
    }
  }

  if (nonLandCount() < inclusionTarget) {
    await walkPass(byInclusion, inclusionTarget);
    const missingMore = [...mainboard.keys()].filter((n) => !scryFor(n));
    if (missingMore.length) await fetchCollection(missingMore, meta);
    for (const card of mainboard.values()) {
      const scry = scryFor(card.name);
      if (scry?.type_line && /\bLand\b/i.test(scry.type_line)) {
        card.isLand = true;
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
      maxUsd,
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

/**
 * Split basics across identity colors in proportion to colored mana symbols
 * in the commanders + mainboard (largest-remainder rounding).
 * Ignores existing land production — duals/fetches do not skew the split.
 */
function allocateBasics(mainboard, meta, commanders, colors, basicsNeeded) {
  let pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const cmd of commanders) {
    pips = mergePipCounts(pips, countPips(cardManaCost(cmd)));
  }
  for (const card of mainboard.values()) {
    if (card.isLand) continue;
    const scry = meta.get(card.name) || meta.get(card.name.toLowerCase());
    if (!scry) continue;
    const costPips = countPips(cardManaCost(scry));
    for (let i = 0; i < card.qty; i++) {
      pips = mergePipCounts(pips, costPips);
    }
  }

  const weights = Object.fromEntries(colors.map((c) => [c, pips[c] || 0]));
  let weightTotal = colors.reduce((n, c) => n + weights[c], 0);
  if (weightTotal <= 0) {
    for (const c of colors) weights[c] = 1;
    weightTotal = colors.length;
  }

  const basicQty = Object.fromEntries(colors.map((c) => [c, 0]));
  const remainders = [];
  let assigned = 0;
  for (const c of colors) {
    const exact = (basicsNeeded * weights[c]) / weightTotal;
    const whole = Math.floor(exact);
    basicQty[c] = whole;
    assigned += whole;
    remainders.push({ c, frac: exact - whole });
  }

  remainders.sort((a, b) => b.frac - a.frac || a.c.localeCompare(b.c));
  let left = basicsNeeded - assigned;
  for (let i = 0; left > 0; i++, left--) {
    basicQty[remainders[i % remainders.length].c] += 1;
  }

  for (const c of colors) {
    if (basicQty[c]) bumpBasic(mainboard, BASIC_BY_COLOR[c], basicQty[c]);
  }
}
