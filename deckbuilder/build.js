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
 * @param {{ name: string, synergy: number, inclusion_pct: number, isLand: boolean }[]} pool
 * @param {object[]} commanders Scryfall cards
 * @param {string[]} colorIdentity e.g. ["G","U","W","B"]
 */
export async function buildDeck(pool, commanders, colorIdentity) {
  /** @type {Map<string, { name: string, qty: number, isLand: boolean }>} */
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
    });
  };

  const nonLandCount = () =>
    [...mainboard.values()].reduce((n, c) => n + (c.isLand ? 0 : c.qty), 0);

  // Synergy pass → 54 non-lands (lands added along the way)
  const bySynergy = [...pool].sort((a, b) => b.synergy - a.synergy);
  for (const card of bySynergy) {
    addCard(card);
    if (nonLandCount() >= 54) break;
  }

  // Inclusion pass → 60 non-lands
  const byInclusion = [...pool].sort((a, b) => b.inclusion_pct - a.inclusion_pct);
  for (const card of byInclusion) {
    if (mainboard.has(card.name)) continue;
    addCard(card);
    if (nonLandCount() >= 60) break;
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

  const mainboardCount = [...mainboard.values()].reduce((n, c) => n + c.qty, 0);
  let basicsNeeded = 100 - commanders.length - mainboardCount;
  if (basicsNeeded < 0) basicsNeeded = 0;

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
  };
}

function bumpBasic(mainboard, name, qty) {
  const existing = mainboard.get(name);
  if (existing) {
    existing.qty += qty;
    existing.isLand = true;
  } else {
    mainboard.set(name, { name, qty, isLand: true });
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
  let landCount = 0;
  for (const card of mainboard.values()) {
    if (!card.isLand) continue;
    landCount += card.qty;
    const scry = meta.get(card.name) || meta.get(card.name.toLowerCase());
    const produced = scry?.produced_mana || [];
    for (let i = 0; i < card.qty; i++) {
      for (const c of colors) {
        if (produced.includes(c)) sourceCounts[c] += 1;
      }
    }
  }

  const totalLandsTarget = landCount + basicsNeeded;
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
