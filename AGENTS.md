# EDH PodLog · Agent Handbook

## Mission Snapshot
- Keep the mono-repo (frontend / backend / db) healthy and coherent.
- Protect player data while integrating Google Identity, Moxfield and MongoDB.
- Ensure every contribution stays reproducible via `make` targets and documented workflows.

## Team Topology
- **Product Navigator** – steers roadmap and success metrics, syncs user feedback into actionable bets.
- **Experience Cartographer** – owns the UX for static frontend assets (`frontend/public`), keeps flows accessible, and syncs design tokens.
- **API Integrator** – maintains the FastAPI backend (`backend/`), stabilises external calls, and wires the caching strategy with MongoDB.
- **Data Chronicler** – shapes Mongo schemas, monitors persistence under `db/`, and keeps analytics/exports consistent.
- **Playtest Conductor** – organises session capture, exercises sync flows through the CLI, and files regression reports backed by tests.

## Operating Principles
- Work through the root `Makefile` whenever possible (`make front`, `make back`, `make db`, `make test`).
- Inside the Codex CLI, skip `make front`; run `make front-config` and start a one-off `npx --yes serve frontend/public` when you need a preview, otherwise the CLI session locks up.
- Prefer non-standard ports (frontend 3170, API 4310, MongoDB 47017) to coexist with other VPS services.
- Run `make doctor` before handoff to verify prerequisites and environment variables (requires `GOOGLE_CLIENT_ID`, `MONGO_URI`, etc.).
- Keep credentials out of Git; rely on `.env.local` merged by `frontend/scripts/generate-config.mjs` and backend env loading.
- When touching CSS, introduce values via the tokens catalogue and layer-safe utilities instead of hard-coding hex/rgba literals.
- Extend or update tests alongside features and bug fixes; add a covering unit or e2e test for each fix whenever feasible. `make test` aggregates Node + pytest suites and guards against regressions.
- Let the docs automation ping this file for review every Monday so AGENTS.md stays current with repo and workflow shifts.
- After `make test`, exercise a manual `/users/{username}/decks` fetch (e.g. via `httpie` or `curl` against a multi-deck account like `BimboLegrand`) and inspect backend logs to confirm batched fetch timings and retry/backoff behaviour remain healthy.

## Workflow Checklists
- **Bootstrap**: `make deps` (system Python deps if no venv) or `make backend-install`, then `make front`, `make back`, `make db`.
- **Feature dev**: branch → update docs/tests → run `make test` → run `make doctor` → submit PR.
- **Incidents**: capture reproduction steps, add coverage, confirm fix with end-to-end `make test` and relevant `make front/back` smoke checks.

## Knowledge Map
- Product vision notes live in `docs/edh-podlog-trashdraft.md`.
- Frontend runtime config is generated via `frontend/scripts/generate-config.mjs`.
- Frontend runtime splits into `frontend/public/js/app-core.js` & `app-features.js` for shared utilities, `app-init.js` for the router, and per-page controllers under `frontend/public/js/controllers/`.
- Social graph & guest player data live behind the new `backend/app/repositories/{players,follows}.py` repositories with services in `services/players.py` and `services/social.py`. The dashboard controller now pulls `/profiles/{sub}/players/available` to prefill participant pickers, and the revamped `groupes.js` handles playgroup detail, membership, search and linking flows.
- Shared styles layer through `frontend/public/styles.css` (`tokens → utilities → base → components → views`):
  - Design tokens live in `frontend/public/styles/tokens.css` (colors, spacing, radii, shadows, gradients, base swatches).
  - Utility helpers sit in `frontend/public/styles/utilities.css`.
  - Global resets in `frontend/public/styles/base.css`; component primitives in `frontend/public/styles/components.css`; page/view rules in `frontend/public/styles/views.css` with responsive overrides co-located in `frontend/public/styles/responsive.css`.
- Identity assets now ship as `frontend/public/favicon.ico` and `frontend/public/apple-touch-icon.png`; additional logos stay under `frontend/public/assets/`.
- Backend API surface and persistence logic sit under `backend/app/` (Moxfield proxy, Mongo upserts, cache endpoints).
- End-to-end regression coverage lives under `backend/tests/e2e/`; run `make backend-test` or `pytest backend/tests/e2e` to exercise the full platform flow.
- Production smoke checks reside in `backend/tests/prod/`; export `PROD_FRONTEND_BASE_URL`, `PROD_API_BASE_URL`, and `PROD_MONGO_URI`, then run `make backend-test-prod` from the VPS to hit Nginx, FastAPI, and Mongo.
- Local Mongo data persists in `db/data/` (ignored except for `.gitkeep`).

## Open Questions
- When should the frontend call `/cache/users/...` endpoints to avoid hitting Moxfield for unchanged decks?
- What anonymisation is required if we export pod statistics publicly?
- How do we support alternate identity providers without complicating the static frontend?

Document updates should accompany repo structure changes so every agent lands in a familiar map.
