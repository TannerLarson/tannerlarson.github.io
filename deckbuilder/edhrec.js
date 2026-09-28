import { EDHREC_PROXY_URL } from "./config.js";

const TYPE_TAGS = new Set([
  "creatures",
  "instants",
  "sorceries",
  "utilityartifacts",
  "enchantments",
  "manaartifacts",
  "battles",
  "planeswalkers",
  "utilitylands",
  "lands",
]);

const LAND_TAGS = new Set(["lands", "utilitylands"]);

/**
 * EDHREC-style slug: lowercase, strip punctuation, spaces → hyphens.
 * @param {string} name
 */
export function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Partner page slug: try "a-b" then "b-a".
 * @param {string} nameA
 * @param {string} nameB
 */
export function partnerSlugCandidates(nameA, nameB) {
  const a = slugify(nameA);
  const b = slugify(nameB);
  return [`${a}-${b}`, `${b}-${a}`];
}

async function fetchSlug(slug) {
  if (!EDHREC_PROXY_URL || EDHREC_PROXY_URL.includes("REPLACE_ME")) {
    throw new Error(
      "EDHREC proxy URL not configured. Deploy workers/edhrec-proxy and set EDHREC_PROXY_URL in config.js."
    );
  }

  const url = `${EDHREC_PROXY_URL.replace(/\/$/, "")}/?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (res.status === 404) {
    const err = new Error(data.error || "EDHREC commander page not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (!res.ok) {
    throw new Error(data.error || `EDHREC proxy error ${res.status}`);
  }
  return data;
}

function redirectSlug(payload) {
  if (!payload?.redirect || typeof payload.redirect !== "string") return null;
  // e.g. "/commanders/thrasios-triton-hero-tymna-the-weaver"
  const m = payload.redirect.match(/\/commanders\/([a-z0-9-]+)\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Fetch commander JSON, following partner redirects.
 * @param {string[]} commanderNames Scryfall-resolved names (1 or 2)
 */
export async function fetchCommanderPage(commanderNames) {
  const candidates =
    commanderNames.length === 2
      ? partnerSlugCandidates(commanderNames[0], commanderNames[1])
      : [slugify(commanderNames[0])];

  let lastErr;
  for (const slug of candidates) {
    try {
      let data = await fetchSlug(slug);
      const redir = redirectSlug(data);
      if (redir && redir !== slug) {
        data = await fetchSlug(redir);
      }
      if (data.redirect) {
        lastErr = new Error("EDHREC redirect loop or incomplete partner page");
        continue;
      }
      if (!data.container?.json_dict) {
        lastErr = new Error("Unexpected EDHREC payload");
        continue;
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (e.code !== "NOT_FOUND") throw e;
    }
  }
  throw lastErr || new Error("EDHREC commander page not found");
}

/**
 * Names from EDHREC's gamechangers list for this commander page.
 * @param {object} edhrecPayload
 * @returns {Set<string>}
 */
export function extractGameChangerNames(edhrecPayload) {
  const lists = edhrecPayload?.container?.json_dict?.cardlists || [];
  const names = new Set();
  for (const list of lists) {
    if (list.tag !== "gamechangers") continue;
    for (const cv of list.cardviews || []) {
      if (cv?.name) names.add(cv.name);
    }
  }
  return names;
}

/**
 * Merge type-tagged cardlists into an Ungrouped pool.
 * @param {object} edhrecPayload
 * @param {Set<string>} [gameChangers]
 * @returns {{ name: string, synergy: number, inclusion_pct: number, isLand: boolean, isGameChanger: boolean }[]}
 */
export function buildUngroupedPool(edhrecPayload, gameChangers = new Set()) {
  const lists = edhrecPayload?.container?.json_dict?.cardlists || [];
  /** @type {Map<string, { name: string, synergy: number, inclusion_pct: number, isLand: boolean, isGameChanger: boolean }>} */
  const byName = new Map();

  for (const list of lists) {
    const tag = list.tag || "";
    if (!TYPE_TAGS.has(tag)) continue;
    const isLand = LAND_TAGS.has(tag);

    for (const cv of list.cardviews || []) {
      if (!cv?.name) continue;
      const potential = cv.potential_decks || 0;
      const inclusion = potential > 0 ? cv.num_decks / potential : 0;
      const synergy = typeof cv.synergy === "number" ? cv.synergy : 0;
      const existing = byName.get(cv.name);

      if (!existing) {
        byName.set(cv.name, {
          name: cv.name,
          synergy,
          inclusion_pct: inclusion,
          isLand,
          isGameChanger: gameChangers.has(cv.name),
        });
        continue;
      }

      if (synergy > existing.synergy) existing.synergy = synergy;
      if (inclusion > existing.inclusion_pct) existing.inclusion_pct = inclusion;
      if (isLand) existing.isLand = true;
      if (gameChangers.has(cv.name)) existing.isGameChanger = true;
    }
  }

  return [...byName.values()];
}
