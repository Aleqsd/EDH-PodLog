# EDH PodLog · Change Plans

## Frontend Page Controllers & Script Routing
- Status: completed — router logic now lives in `js/app-init.js` and page controllers register from `js/controllers/`.
- The bootstrap inspects `document.body.dataset.page` to invoke the matching controller.
- Shared utilities continue to live in `app-core.js` / `app-features.js`; controllers consume them through the shared namespace.
- Page-specific behaviours (landing, dashboard, decks, deck detail, card detail, profile, synchronisation) are encapsulated in their respective controller files.

## CSS Design Tokens & Layering
- Extract color, spacing, typography tokens into a dedicated source (e.g. `frontend/public/styles/tokens.css` or JSON feeding a build step).
- Split styles into layers: tokens/utilities, base layout, components, views.
- Enforce usage of the token utilities across components to reduce drift.
- Document how new styles must compose the tokens before merging.

## Backend Router Split
- Introduce feature routers (`profiles`, `users`, `cache`, `meta`) under `backend/app/routers/`.
- Register routers in `main.py` with the appropriate prefixes and tags.
- Move endpoint-specific dependencies (e.g. `get_moxfield_client`) to the routers to keep `main.py` focused on startup wiring.
- Update tests to import the new routers so coverage maps 1:1 with features.

## Mongo Repository & Index Audit
- Implement a repository layer (e.g. `backend/app/repositories/moxfield_cache.py`) that encapsulates canonical username handling and upsert behaviour.
- Use single `replace_one(..., upsert=True)` calls instead of manual matched-count branching.
- Define and enforce indexes: `{ user_key: 1 }`, `{ user_key: 1, public_id: 1 }` unique, etc.
- Add a lightweight migration/setup path that runs at startup (or via `make db`) to create indexes.

## Moxfield Fetch Strategy Cleanup
- Isolate the synchronous `cloudscraper` usage inside a helper and call it via `anyio.to_thread.run_sync` to avoid manual `run_in_threadpool` management.
- Batch deck detail requests with concurrency limits to cut total sync time for multi-deck users.
- Centralise retry/backoff logic so upstream hiccups don’t block the event loop.
- Record fetch timing metrics (via logger extras) to tune timeouts and future caching.

## Test Harness Improvements
- Expand Node-based DOM tests to cover page controllers directly, ensuring each controller can run with stubbed APIs and DOM fixtures.
- Add backend integration tests that spin up the FastAPI app with an in-memory Mongo double to verify router wiring and persistence paths.
- Document expected test commands (`make test`, targeted frontend/backend suites) so they remain part of the workflow.
