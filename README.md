# tannerlarson.github.io

Personal GitHub Pages site.

## Subpages

- [/hanabi](hanabi/) — Hanabi hand tracker
- [/ti-calculator](ti-calculator/) — Twilight Imperium battle calculator
- [/deckbuilder](deckbuilder/) — EDH Commander deckbuilder (needs EDHREC proxy)

## EDH Deckbuilder setup

The deckbuilder talks to Scryfall from the browser and to EDHREC through a free Cloudflare Worker (CORS).

1. Deploy the proxy once:

```bash
cd workers/edhrec-proxy
npm install
npx wrangler login
npm run deploy
```

2. Copy the printed `https://….workers.dev` URL into [`deckbuilder/config.js`](deckbuilder/config.js) as `EDHREC_PROXY_URL`.

Details: [`workers/edhrec-proxy/README.md`](workers/edhrec-proxy/README.md).

### Local preview

Serve the repo root over HTTP (ES modules):

```bash
python -m http.server 8000
# open http://127.0.0.1:8000/deckbuilder/
```

For the proxy locally: `cd workers/edhrec-proxy && npm run dev`, then point `EDHREC_PROXY_URL` at `http://127.0.0.1:8787`.
