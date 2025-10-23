# EDH PodLog · Change Plans

## CSS Design Tokens & Layering

- Extract color, spacing, typography tokens into a dedicated source (e.g. `frontend/public/styles/tokens.css` or JSON feeding a build step).
- Split styles into layers: tokens/utilities, base layout, components, views.
- Enforce usage of the token utilities across components to reduce drift.
- Document how new styles must compose the tokens before merging.

## Test Harness Improvements

- Expand Node-based DOM tests to cover page controllers directly, ensuring each controller can run with stubbed APIs and DOM fixtures.
- Add backend integration tests that spin up the FastAPI app with an in-memory Mongo double to verify router wiring and persistence paths.
- Document expected test commands (`make test`, targeted frontend/backend suites) so they remain part of the workflow.
