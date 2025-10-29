# Feature Ideas

## 1. Deck history timeline
- **What:** Surface a timeline view in the dashboard that shows when each deck was last synced, highlighting periods of inactivity or rapid iteration.
- **How:** Extend the `/cache/users/{username}/decks` payloads to include `synced_at` (already stored in Mongo) and render a chronological chart using vanilla SVG or `<canvas>` (no new framework). On the backend, add an endpoint that aggregates sync timestamps per deck.
- **Why:** Helps pilots understand cadence, spot neglected decks, and plan future updates without re-querying Moxfield.

## 2. Card-by-card diff view
- **What:** Let users compare two cached deck snapshots and view additions/removals per board.
- **How:** Persist a lightweight history table (or reuse existing deck documents with versioning) and add a `/users/{username}/decks/{deck_id}/diff?at=timestamp` endpoint that returns delta arrays. Frontend controllers can reuse existing modal patterns to display the diff.
- **Why:** Delivers immediate insight into what changed between syncs, aiding playtesting conversations and regression tracking.

## 3. Playgroup performance dashboard
- **What:** Provide aggregate statistics per playgroup (win rates, seat order outcomes, deck popularity).
- **How:** Build aggregation pipelines in `GameRepository` to summarise `rankings` and `players`, expose them via a new `/playgroups/{id}/stats` route, and render compact tables/charts in `frontend/public/js/controllers/groupes.js`.
- **Why:** Turns the recorded play data into actionable insights for the Playtest Conductor without manual spreadsheet work.

## 4. Personalisation progress tracker
- **What:** Introduce a dashboard widget that shows completion status for deck personalisation (ratings filled, notes present, tags assigned).
- **How:** Extend `DeckPersonalizationRepository` to return completeness metrics, expose them through `/profiles/{googleSub}/personalizations/summary`, and reuse existing badge styles to show progress bars in the UI.
- **Why:** Encourages users to finish annotating decks and provides a quick overview of which lists still need attention.

## 5. Scheduled sync CLI helper
- **What:** Ship a lightweight CLI (Python or Node script) that calls `/users/{username}/decks` on a schedule and pushes results into Git or a JSON archive.
- **How:** Add a script under `scripts/` (no external framework) that reads usernames from a config file, hits the API, and writes timestamped dumps into `db/data/snapshots`. Document how to hook it into cron/Task Scheduler.
- **Why:** Guarantees data freshness without manual clicks and creates an audit trail of deck states for future analytics.

