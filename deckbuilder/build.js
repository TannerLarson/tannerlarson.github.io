import {
  countPips,
  fetchCollection,
  mergePipCounts,
} from "./scryfall.js";

const BASIC_BY_COLOR = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};

/**
 * @typedef {{ synergyNonLands?: number, inclusionNonLands?: number, targetLands?: number }} BuildOptions
 */

/**
 * @param {{ name: string, synergy: number, inclusion_pct: number, isLand: boolean }[]} pool
 * @param {object[]} commanders Scryfall cards
 * @param {string[]} colorIdentity e.g. ["G","U","W","B"]
 * @param {BuildOptions} [options]
 */
export async function buildDeck(pool, commanders, colorIdentity, options = {}) {
  const synergyTarget = clampInt(options.synergyNonLands, 0, 99, 54);
  const inclusionExtra = clampInt(options.inclusionNonLands, 0, 99, 6);
  const targetLands = clampInt(options.targetLands, 0, 99, 39);
  const inclusionTarget = synergyTarget + inclusionExtra;

  const expectedMain = synergyTarget + inclusionExtra + targetLands;
  const expectedTotal = expectedMain + commanders.length;
  if (expectedTotal !== 100) {
    throw new Error(
      `Deck mix must total 100 cards (synergy + inclusion + lands + commanders). ` +
        `Got ${synergyTarget} + ${inclusionExtra} + ${targetLands} + ${commanders.length} = ${expectedTotal}.`
    );
  }

  /** @type {Map<string, { name: string, qty: number, isLand: boolean, synergy: number, inclusion_pct: number }>} */
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
    });
  };

  const nonLandCount = () =>
    [...mainboard.values()].reduce((n, c) => n + (c.isLand ? 0 : c.qty), 0);

  const landCount = () =>
    [...mainboard.values()].reduce((n, c) => n + (c.isLand ? c.qty : 0), 0);

  const tryAdd = (card, nonLandCap) => {
    if (card.isLand) {
      if (landCount() >= targetLands) return;
    } else if (nonLandCount() >= nonLandCap) {
      return;
    }
    if (mainboard.has(card.name)) return;
    addCard(card);
  };

  // Synergy pass — lands along the way, capped by targetLands
  const bySynergy = [...pool].sort((a, b) => b.synergy - a.synergy);
  for (const card of bySynergy) {
    tryAdd(card, synergyTarget);
    if (nonLandCount() >= synergyTarget) break;
  }

  // Inclusion pass — more non-lands (and lands if under target)
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

  for (const card of mainboard.values()) {
    const scry = meta.get(card.name) || meta.get(card.name.toLowerCase());
    if (scry?.type_line && /\bLand\b/i.test(scry.type_line)) {
      card.isLand = true;
    }
  }

  // If Scryfall reclassified cards as lands, we may be over the land cap — trim weakest lands.
  trimLandsToTarget(mainboard, targetLands);

  // Prefer filling remaining land slots from EDHREC land pool before basics.
  if (landCount() < targetLands) {
    const landPool = [...pool]
      .filter((c) => c.isLand && !mainboard.has(c.name))
      .sort((a, b) => b.synergy - a.synergy || b.inclusion_pct - a.inclusion_pct);
    for (const card of landPool) {
      if (landCount() >= targetLands) break;
      addCard(card);
    }
  }

  // Refresh meta for any newly added lands
  const missingMeta = [...mainboard.keys()].filter(
    (n) => !meta.has(n) && !meta.has(n.toLowerCase())
  );
  if (missingMeta.length) {
    const extra = await fetchCollection(missingMeta);
    for (const [k, v] of extra) meta.set(k, v);
  }

  let basicsNeeded = targetLands - landCount();
  if (basicsNeeded < 0) {
    trimLandsToTarget(mainboard, targetLands);
    basicsNeeded = 0;
  }

  // If non-land passes came up short, leftover slots become extra basics so we still hit 100.
  const mainboardCount = [...mainboard.values()].reduce((n, c) => n + c.qty, 0);
  const slotsLeft = 100 - commanders.length - mainboardCount;
  if (slotsLeft > basicsNeeded) {
    basicsNeeded = slotsLeft;
  }

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
    options: { synergyNonLands: synergyTarget, inclusionNonLands: inclusionExtra, targetLands },
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function trimLandsToTarget(mainboard, targetLands) {
  let lands = landQty(mainboard);
  if (lands <= targetLands) return;

  const landEntries = [...mainboard.values()]
    .filter((c) => c.isLand)
    .sort(
      (a, b) =>
        a.synergy - b.synergy ||
        a.inclusion_pct - b.inclusion_pct ||
        a.name.localeCompare(b.name)
    );

  for (const card of landEntries) {
    while (card.qty > 0 && lands > targetLands) {
      card.qty -= 1;
      lands -= 1;
    }
    if (card.qty <= 0) mainboard.delete(card.name);
    if (lands <= targetLands) break;
  }
}

function landQty(mainboard) {
  return [...mainboard.values()].reduce((n, c) => n + (c.isLand ? c.qty : 0), 0);
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
    });
  }
}

function allocateBasics(mainboard, meta, commanders, colors, basicsNeeded) {
  let pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const cmd of commanders) {
    pips = mergePipCounts(pips, countPips(cmd.mana_cost || ""));
  }
  for (const card of mainboard.values()) {
    const scry = meta.get(card.name) || meta.get(card.name.toLowerCase());
    if (!scry) continue;
    const costPips = countPips(scry.mana_cost || "");
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
