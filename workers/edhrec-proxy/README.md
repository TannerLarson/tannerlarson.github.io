# EDHREC Proxy (Cloudflare Worker)

Locked-down CORS proxy for `json.edhrec.com` commander pages. Used by the `/deckbuilder` page on this site.

**Not** an open proxy — it only fetches `https://json.edhrec.com/pages/commanders/{slug}.json`.

## One-time setup

1. Create a free [Cloudflare account](https://dash.cloudflare.com/sign-up).
2. From this directory:

```bash
cd workers/edhrec-proxy
npm install
npx wrangler login
npm run deploy
```

3. Note the printed URL, e.g. `https://edhrec-proxy.<subdomain>.workers.dev`.
4. Set that base URL in [`../../deckbuilder/config.js`](../../deckbuilder/config.js) as `EDHREC_PROXY_URL`.

## API

```
GET /?slug=krenko-mob-boss
```

- Valid slug: lowercase letters, digits, hyphens only.
- 200: EDHREC JSON (including partner `redirect` payloads).
- 404: commander page missing (EDHREC 403/404).
- 400 / 429 / 502: validation, rate limit, or upstream errors.

CORS allows `https://tannerlarson.github.io` and common localhost origins (see `wrangler.toml`).

Successful responses are cached ~12 hours. Soft limit: ~30 requests/minute/IP in-worker.

## Local dev

```bash
npm run dev
```

Point `EDHREC_PROXY_URL` at the local wrangler URL (usually `http://127.0.0.1:8787`).

## Optional dashboard rate limiting

Workers Free may also use Cloudflare’s Rate limiting rules on the Worker route if you want stricter caps without code changes.
