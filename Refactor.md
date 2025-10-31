## Refactor Candidates (Ranked)

Scoring is on a 1–5 scale (higher is better) for Speed impact and Tech Debt reduction; total score = Speed + Tech Debt.

| Rank | Area | Speed | Tech Debt | Notes |
| --- | --- | --- | --- | --- |
| 1 | Backend social search | 5 | 5 | `backend/app/services/social.py:42` loads every profile into memory before filtering. Adding a case-insensitive text index plus a filtered `find`/aggregation (with projection + limit) would avoid full scans and drastically lower response times as the user table grows. |
| 2 | Game history access patterns | 4 | 4 | `backend/app/repositories/play_data.py:206` and `update_player_identity` pull entire game collections into Python and sort/update there. Moving the sort/limit into Mongo (e.g., `.sort("created_at",-1).limit(n)` and targeted `$set`/`$pull` updates) keeps public profile loads lightweight and makes identity updates O(1). |
| 3 | Frontend bundle size | 3 | 4 | Static assets ship unbundled (`frontend/public/js/app-features.js` ≈132 KB, `app-core.js` ≈83 KB). Introducing an esbuild/rollup step with code-splitting and hashed filenames would cut initial download size and simplify long-term maintenance of shared utilities. |
| 4 | Groupes controller boot | 3 | 3 | `frontend/public/js/controllers/groupes.js:881` waits for playgroups, available players, and tracked players sequentially. Kicking these off with `Promise.all` and memoising shared results will shorten first paint and remove redundant fetches during member edits. |

## Completed Refactors

- Profile fan-out lookups — batched profile reads via `fetch_user_profiles` now power follow and available-player flows, removing the Mongo N+1 query pattern in `services/social.py` and `services/players.py`, with tests in `backend/tests/test_social.py` and `backend/tests/test_players.py` covering the new paths.
