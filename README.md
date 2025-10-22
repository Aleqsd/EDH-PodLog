# EDH PodLog

Static front-end for Commander players to manage pods, decks, and integrations such as Moxfield and Archidekt.

## Project layout

- `public/`: HTML pages, static assets, and the main front-end bundle (`js/app.js`).  
  `public/config.js` is generated at build time so secrets stay out of Git.
- `scripts/`: small utilities (for now, `generate-config.mjs` to build `config.js`).
- `docs/`: product notes (`AGENTS.md`, roadmap drafts, etc.).

## Secrets & local configuration

1. Copy the template:
   ```bash
   cp .env.example .env.local
   ```
2. Fill in `GOOGLE_CLIENT_ID` inside `.env.local`.
3. Generate the front-end configuration:
   ```bash
   make config
   ```
   This writes `public/config.js` (ignored by Git).  
   In Netlify, set the same environment variable and keep the same command in the build step (e.g., `make deploy`).

## Netlify workflow (Makefile)

- `make build`: ensures `public/config.js` exists and assets are ready.
- `make preview`: deploys a preview (`netlify deploy --alias preview`).
- `make deploy`: deploys to production (`netlify deploy --prod`).

Supply a target site ID with `NETLIFY_SITE=my-site-id make deploy`.

> Requires [Netlify CLI](https://docs.netlify.com/cli/get-started/) and an active `netlify login`.

## Quick local preview

```bash
make config
npx serve public
```

Open the URL printed by `serve` (typically `http://localhost:3000`).
