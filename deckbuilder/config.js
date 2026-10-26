// After deploying workers/edhrec-proxy, paste your workers.dev base URL here (no trailing slash).
// Example: "https://edhrec-proxy.your-subdomain.workers.dev"
export const EDHREC_PROXY_URL = "https://edhrec-proxy.tannerlarson.workers.dev";

/** Bump on each deckbuilder change; also update ?v= on CSS/JS in index.html. */
export const DECKBUILDER_VERSION = "1.1.1";

export const SCRYFALL_USER_AGENT =
  `TannerLarsonDeckbuilder/${DECKBUILDER_VERSION} (personal; https://tannerlarson.github.io/deckbuilder)`;
