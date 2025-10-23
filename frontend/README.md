# Frontend (Static Site)

The frontend lives in `frontend/public/` and is served as a static site. It reads runtime configuration from `config.js`, which is generated from environment variables so secrets stay out of Git.

## Commands

- `make front-config` – write `frontend/public/config.js` from `.env` / `.env.local`.
- `make front` – run the config generator and serve the static assets with `npx serve` on `http://127.0.0.1:3170`.
- `make front-build` – prep assets for deployment (used by Netlify builds).
- `make front-test` – execute the Node-based unit tests living in `frontend/tests`.
- `make front-preview` / `make front-deploy` – push previews or production via Netlify CLI (set `NETLIFY_SITE` if required).

## Environment values

`frontend/scripts/generate-config.mjs` looks at `.env.local` first, then `.env`, then falls back to environment variables. The keys currently consumed by the UI are:

- `GOOGLE_CLIENT_ID`
- `API_BASE_URL` (defaults to `http://localhost:4310`)

Run `make front-config` whenever these values change.

## Styles

- Global design tokens live in `frontend/public/styles/tokens.css` and expose color, spacing, radius, shadow, and gradient primitives. Always reference tokens (or derive from them with `color-mix`) instead of hard-coding values.
- Layout helpers and shared utility classes are defined in `frontend/public/styles/utilities.css`.
- The cascade is layered via `frontend/public/styles.css` in the order: `tokens → utilities → base → components → views`. Media queries share the `views` layer to keep overrides predictable.
- Per-view rules reside in `frontend/public/styles/views.css` and should compose tokens by name (for example, `var(--color-brand-soft)` or `color-mix` using `--color-base-*` swatches).
- Component primitives live in `frontend/public/styles/components.css`. Bring new components into this file or a co-located module, but ensure they only consume tokens/utilities.
