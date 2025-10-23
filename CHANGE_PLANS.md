# EDH PodLog · Change Plans

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

## Moxfield Fetch Strategy Cleanup

- Isolate the synchronous `cloudscraper` usage inside a helper and call it via `anyio.to_thread.run_sync` to avoid manual `run_in_threadpool` management.
- Batch deck detail requests with concurrency limits to cut total sync time for multi-deck users.
- Centralise retry/backoff logic so upstream hiccups don’t block the event loop.
- Record fetch timing metrics (via logger extras) to tune timeouts and future caching.

## Test Harness Improvements

- Expand Node-based DOM tests to cover page controllers directly, ensuring each controller can run with stubbed APIs and DOM fixtures.
- Add backend integration tests that spin up the FastAPI app with an in-memory Mongo double to verify router wiring and persistence paths.
- Document expected test commands (`make test`, targeted frontend/backend suites) so they remain part of the workflow.
