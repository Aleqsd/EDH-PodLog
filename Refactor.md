## Refactor Candidates (Ranked)

Scoring is on a 1–5 scale (higher is better) for Speed impact and Tech Debt reduction; total score = Speed + Tech Debt.

| Rank | Area | Speed | Tech Debt | Notes |
| --- | --- | --- | --- | --- |
| 1 | Game history access patterns | 5 | 4 | `backend/app/repositories/play_data.py:204` fetches every game for an owner into Python before sorting. Switching to `.find(...).sort("created_at", -1).limit(n)` with projection keeps list views fast and shrinks memory spikes as data grows. |
| 2 | Player identity propagation | 4 | 5 | `backend/app/repositories/play_data.py:232` iterates every stored game to update a single player. Leveraging `update_many` with array filters and targeted `$set` calls turns the write into a single O(1) Mongo statement and removes Python-side rewrites. |
| 3 | Groupes controller boot | 4 | 3 | `frontend/public/js/controllers/groupes.js:881` waits for playgroups, available players, and tracked players sequentially. Firing these through `Promise.all` and reusing shared payloads shortens boot time and trims duplicate network work during edits. |
| 4 | Dashboard data hydration | 3 | 3 | `frontend/public/js/controllers/dashboard.js:1528` chains `await load*` calls even though they target independent resources. Running the initial fetches concurrently and coordinating state updates reduces perceived loading cost. |
| 5 | Player listing queries | 2 | 3 | `backend/app/repositories/players.py:33` pulls every tracked player into Python just to sort by `updated_at`. Moving the sort/limit server-side and projecting only needed fields will lighten list endpoints and align with pagination plans. |

## Completed Refactors

- Public profile search — the social search service now uses a Mongo text index with projection and limiting, avoiding full collection scans while keeping score ordering stable.
- Profile fan-out lookups — batched profile reads via `fetch_user_profiles` now power follow and available-player flows, removing the Mongo N+1 query pattern in `services/social.py` and `services/players.py`, with tests in `backend/tests/test_social.py` and `backend/tests/test_players.py` covering the new paths.
