# Refactor Opportunities

## 2. Consolidate deck upsert document shaping

- **Context:** `backend/app/services/storage.py`
- **Problem:** `upsert_user_decks` and `upsert_user_deck_summaries` duplicate the logic that merges `synced_at`, `total_decks`, and per-deck metadata before calling the repository. Any change to the payload shape must be applied in two loops.
- **Refactor:** Introduce a shared `_prepare_user_document` helper plus a `_prepare_deck_documents(payload, kind="full"|"summary")` generator that normalises the documents. Both `upsert_*` functions can then call a single `repository.replace_documents(username, docs, collection)` entry point.
- **Payoff:** Removes divergent code paths, makes it trivial to add fields (e.g. caching metadata) once, and simplifies mocking in `backend/tests/test_storage.py`.
- **Speed impact:** Medium (3/5)
- **Tech debt reduction:** Medium-High (4/5)

## 3. Inject repositories through FastAPI dependencies

- **Context:** `backend/app/services/storage.py`, `backend/app/dependencies.py`
- **Problem:** Every call to the storage helpers instantiates a new `MoxfieldCacheRepository`, which re-reads settings and collection names. Tests also have to patch the constructor repeatedly.
- **Refactor:** Add `get_moxfield_cache_repository(database=Depends(get_mongo_database))` in `dependencies.py` that caches an instance per `AsyncIOMotorDatabase`. Update routers/services to accept the repository as an argument instead of constructing it ad-hoc.
- **Payoff:** Removes repeated configuration work, lets you swap in an in-memory fake for tests, and opens the door to measuring repository interactions centrally.
- **Speed impact:** Medium (3/5)
- **Tech debt reduction:** High (5/5)

## 4. Normalise deck personalisation sanitisation

- **Context:** `backend/app/services/deck_personalization.py`
- **Problem:** The sanitisation helpers (`_sanitize_deck_ratings`, `_sanitize_tag_list`, etc.) return loosely-typed dicts/lists, and `_normalize_storage_entry` builds new dicts manually. Mutating these dicts is error-prone and hard to validate.
- **Refactor:** Introduce a lightweight dataclass (e.g. `DeckPersonalizationRecord`) that encapsulates validation and provides `from_storage()` / `to_storage()` methods. Sanitisation helpers can become `@staticmethod`s on the class, ensuring consistent types and providing a single place to clamp values.
- **Payoff:** Clearer type semantics, easier diffing when records change, and simpler unit tests because serialisation is exercised through a single public interface.
- **Speed impact:** Low-Medium (2/5)
- **Tech debt reduction:** High (5/5)

## 5. Extract config generation primitives for reuse

- **Context:** `frontend/scripts/generate-config.mjs`, `frontend/tests/config.test.mjs`
- **Problem:** `generate-config.mjs` combines env resolution, commit metadata lookup, and file writing inside `main()`. Tests have to execute the script end-to-end instead of exercising smaller pieces, and other tooling (e.g. service worker version stamping) re-implements the same parsing logic.
- **Refactor:** Move the env parsing and commit info utilities into `frontend/scripts/lib/config-utils.mjs` exported as pure functions. The CLI entry point can call into the library, while tests import the helpers directly.
- **Payoff:** Encourages reuse for future scripts (Netlify deploy hooks, doctor checks), improves testability, and makes it easier to switch to ESM bundling without rewriting the business logic.
- **Speed impact:** Low-Medium (2/5)
- **Tech debt reduction:** Medium-High (4/5)
