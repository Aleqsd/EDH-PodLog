# Tests Reference

This document enumerates every automated test in the repository and what each case covers.
Keep it in sync whenever you add, rename, or delete tests.

## Running Tests

- `make test` runs the full suite: Node controller/unit tests, backend pytest suites (unit + e2e), and the database checks.
- `make front-test` executes the Node `test` runner against `frontend/tests/*.mjs`.
- `make backend-test` runs `pytest` for everything under `backend/tests` (unit + integration, excluding e2e-only and prod-only targets).
- `make backend-test-e2e` scopes pytest to `backend/tests/e2e`.
- `make backend-test-prod` enables the `prod` marker (equivalent to `pytest --prod-smoke -m prod backend/tests`); requires `PROD_FRONTEND_BASE_URL`, `PROD_API_BASE_URL`, and `PROD_MONGO_URI` to be set or resolvable via `.env` files.
- `make db-test` runs the Mongo port safety checks in `db/tests`.

## Pytest Configuration & Fixtures

- `pytest.ini` registers the `prod` marker used by production smoke tests.
- `backend/tests/conftest.py` exposes:
  - `--prod-smoke` / `RUN_PROD_SMOKE` flagging to opt into prod tests.
  - An `api_client` fixture that spins up the FastAPI app with stubbed Mongo + Moxfield clients (stored at `app.state.stub_db`).

## Frontend Tests

### `frontend/tests/config.test.mjs`
| Test | What it verifies |
| --- | --- |
| `generate-config falls back to defaults without env files` | Running `frontend/scripts/generate-config.mjs` in an empty temp directory produces fallback values (`GOOGLE_CLIENT_ID`, `API_BASE_URL`). |
| `generate-config honours values provided in env files` | The generator reads `.env` entries when present and emits them into the runtime config. |

### `frontend/tests/moxfield.test.mjs`
| Test | What it verifies |
| --- | --- |
| `validateMoxfieldHandle accepts valid usernames` | Accepts uppercase, lowercase, underscore, and dash handles. |
| `validateMoxfieldHandle rejects invalid usernames` | Rejects empty, too-short, spaced, or punctuated handles. |
| `normalizeMoxfieldDeck extracts metadata from backend payloads` | Normalises deck payloads and counts cards from board lists. |
| `deckMatchesIdentifier recognises legacy and public deck identifiers` | Candidate extraction includes both legacy IDs and new public IDs; matcher resolves either. |
| `createCardSnapshot preserves core card data for fast detail rendering` | Card snapshots strip extraneous fields while keeping deck context, pricing, and quantities. |
| `createDeckSnapshot serialises decks with sanitised boards for fast rendering` | Deck snapshots trim raw board data, clean prices, and standardise metadata. |
| `collectDeckBoards normalises board dictionaries from Moxfield` | Converts dict-based board payloads into ordered arrays while preserving counts. |
| `resolveDeckColorIdentity prioritises commander colour identity` | Commander colour identity overrides deck-level colour hints. |
| `resolveDeckColorIdentity returns colourless when commanders lack colours` | Returns a single `'C'` marker when commanders have no colour identity. |
| `doesDeckMatchSearch matches card names inside deck boards` | Text search helper matches on card names within boards and rejects non-matching decks. |

### `frontend/tests/controllers.test.mjs`
| Test | What it verifies |
| --- | --- |
| `landing controller primes sign-in button state when Google config is missing` | Landing page disables sign-in, updates copy, and shows guidance when OAuth config is absent. |
| `decks controller requests cached decks when integration has no local data` | Deck dashboard loads cached decks using the stored Moxfield handle before rendering. |
| `dashboard controller initialises pod composition with four default players` | Dashboard controller seeds four players, marks owner, and primes default names. |
| `dashboard controller records additional players into the known list after confirmation` | Saving a result persists newly entered players into the known-players datalist. |
| `profile controller allows updating pseudonyme, description, and avatar` | Profile page trims inputs, clears avatar to identity picture, persists via fetch, and syncs session storage. |

## Backend Tests

### `backend/tests/test_config_defaults.py`
| Test | What it verifies |
| --- | --- |
| `test_default_settings_use_custom_mongo_port` | `Settings.from_env()` defaults to the non-standard Mongo port (`47017`) and baseline collection names. |

### `backend/tests/test_health.py`
| Test | What it verifies |
| --- | --- |
| `test_health_endpoint_returns_ok` | `/health` returns HTTP 200 with `{"status": "ok"}` when served through FastAPI. |
| `test_meta_router_exposes_health_route` | Confirms the meta router includes the health route definition. |

### `backend/tests/test_logging_utils.py`
| Test | What it verifies |
| --- | --- |
| `test_configure_logging_respects_env_level` (parametrised) | Logging setup honours `EDH_PODLOG_LOG_LEVEL` values (case-insensitive) and falls back to INFO on invalid input. |
| `test_configure_logging_includes_timestamp` | Log formatter emits timestamp, namespace, and message content. |

### `backend/tests/test_storage.py`
| Test | What it verifies |
| --- | --- |
| `test_upsert_user_decks_persists_user_and_decks` | Detailed deck payloads upsert user & deck documents with sync timestamps. |
| `test_upsert_user_deck_summaries_persists_user_and_summaries` | Deck summary payloads populate the summary collection with sync metadata. |
| `test_fetch_user_decks_returns_payload_if_present` | `fetch_user_decks` rebuilds typed responses from stored deck documents. |
| `test_fetch_user_decks_returns_none_when_missing` | Missing deck records yield `None`. |
| `test_delete_user_deck_matches_case_insensitive_username` | Deleting a deck matches on lowercased user key, prunes deck + summary docs, and updates totals. |
| `test_fetch_user_deck_summaries_returns_payload_if_present` | Summary fetch reconstructs stored summaries into the typed response. |
| `test_fetch_user_deck_summaries_returns_none_when_missing` | Absent summaries return `None`. |
| `test_ensure_moxfield_cache_indexes_creates_expected_indexes` | Repository helper declares the required indexes on moxfield users, decks, and summaries. |

### `backend/tests/test_users.py`
Autouse fixture `_ensure_router_prefixes` asserts that `/users`, `/profiles`, and `/cache` routers expose the expected prefixes.

| Test | What it verifies |
| --- | --- |
| `test_get_user_decks_success` | `/users/{name}/decks` normalises a complete Moxfield payload (boards, tags, stats). |
| `test_get_user_decks_color_identity_from_cards` | Colour identity falls back to card data when deck colours are missing. |
| `test_get_user_profile_not_found` | Unknown profiles return HTTP 404. |
| `test_upsert_user_profile_creates_and_updates_document` | Profile upsert trims fields, persists decks, and preserves prior deck lists across updates. |
| `test_upsert_user_profile_rejects_long_description` | Enforces the 1000-character bio limit. |
| `test_get_user_decks_not_found` | Converts `MoxfieldNotFoundError` into HTTP 404. |
| `test_get_user_decks_generic_error` | Other Moxfield failures surface as HTTP 502. |
| `test_get_user_deck_summaries_success` | Summary endpoint omits card boards while returning deck metadata. |
| `test_get_user_deck_summaries_not_found` | Summary endpoint maps not-found to HTTP 404. |
| `test_get_user_deck_summaries_generic_error` | Summary endpoint maps generic upstream failures to HTTP 502. |
| `test_get_cached_user_decks_returns_cached_payload` | Hitting the live decks endpoint primes the cache; cached route returns stored payload. |
| `test_get_cached_user_decks_returns_404_when_missing` | Cached decks endpoint returns 404 when no cache exists. |
| `test_get_cached_deck_summaries_returns_cached_payload` | Cached summaries return the primed payload from the live endpoint. |
| `test_get_cached_deck_summaries_returns_404_when_missing` | Cached summaries return 404 when absent. |
| `test_delete_user_deck_removes_documents_and_updates_cache` | Deleting a deck prunes Mongo documents and synchronises cache totals. |
| `test_delete_user_deck_returns_404_for_unknown_identifier` | Deleting a non-existent deck returns HTTP 404 without altering cache. |

### `backend/tests/test_social.py`
| Test | What it verifies |
| --- | --- |
| `test_search_public_profiles_filters_private_entries_and_limits_results` | Public profile search excludes private/anonymous entries, sorts alphabetically, and flags followed users. |
| `test_get_public_profile_returns_recent_games_and_counts_followers` | Public profiles expose follower counts, deck list, and the five most recent games; private profiles raise `LookupError`. |

### `backend/tests/test_deck_personalization.py`
| Test | What it verifies |
| --- | --- |
| `test_upsert_and_fetch_deck_personalization` | Upserting trims inputs, enforces rating ranges, truncates notes, and lists personalizations. |
| `test_upsert_deck_personalization_supports_slash_in_deck_id` | Deck personalizations handle encoded deck IDs containing `/` and can be retrieved afterwards. |

### `backend/tests/test_play_data.py`
| Test | What it verifies |
| --- | --- |
| `test_create_playgroup_and_list` | Creating a playgroup returns an ID and initial list call shows zero games. |
| `test_record_game_updates_history_and_playgroup` | Recording a game stores rankings, decks, and updates playgroup metadata. |
| `test_list_games_filters_by_playgroup_identifier` | Game listing filters by `playgroup_id` and returns all games when unfiltered. |
| `test_record_game_creates_playgroup_when_missing` | Recording a game with only a name auto-creates the playgroup. |
| `test_playgroup_detail_includes_stats_and_members` | Playgroup detail reports aggregated stats and member list after updates. |
| `test_linking_tracked_player_updates_games` | Linking a stored player to a Google identity updates historic game records and availability listings. |

### `backend/tests/e2e/test_platform_e2e.py`
All tests run with AnyIO's asyncio backend using stubbed Mongo and Moxfield clients.

| Test | What it verifies |
| --- | --- |
| `test_full_platform_flow` | Exercises the primary user journey: profile sync, deck caching, personalization, player linking, playgroup creation, game recording, social follow/unfollow, and cache pruning. |
| `test_deck_cache_warmup_flow` | Cache endpoints return 404 until live sync happens, then reflect deck deletions. |
| `test_playgroup_update_and_delete_flow` | Playgroups support updates (name + members) and hard deletes clean up listings. |
| `test_guest_player_validation_flow` | Guest player endpoints enforce name validation, reject bad links, and delete cleanly. |
| `test_public_profile_privacy_flow` | Social search respects privacy, follows private/public users, and hides private profile fetches. |
| `test_deck_personalization_missing_returns_404` | Missing deck personalizations return HTTP 404 and listing returns an empty set. |
| `test_game_record_validation_errors` | Game recording enforces minimum players, complete rankings, and existing playgroups. |
| `test_linking_player_updates_game_history` | Linking a guest player retrofits stored games with the linked user's metadata. |
| `test_moxfield_error_handling` | Upstream Moxfield errors map to HTTP 404 (not found) or 502 (generic failure) across decks and summaries. |

### `backend/tests/prod/test_prod_smoke.py`
Runs only under the `prod` marker (`make backend-test-prod` or `pytest --prod-smoke`).

| Test | What it verifies |
| --- | --- |
| `test_frontend_serves_index` | Production frontend base URL returns a non-empty HTML response. |
| `test_api_healthcheck_is_healthy` | Production API `/health` endpoint responds with `{"status": "ok"}`. |
| `test_mongo_ping_succeeds` | Production MongoDB URI accepts a `ping` command via Motor. |

## Database Tests

### `db/tests/test_ports.py`
| Test | What it verifies |
| --- | --- |
| `test_env_example_uses_custom_mongo_port` | `.env.example` advertises the custom Mongo port (`47017`). |
| `test_makefile_mongo_port_matches_env` | `Makefile` default `MONGO_PORT` matches the documented custom port. |

