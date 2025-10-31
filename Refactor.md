# Refactor Opportunities

## Recently Shipped

### Inject repositories through FastAPI dependencies
- **Status:** ✅ Completed in `backend/app/dependencies.py` with cached `MoxfieldCacheRepository` instances and updated storage helpers.
- **Context:** `backend/app/services/storage.py`, `backend/app/dependencies.py`
- **Problem solved:** We no longer recreate repositories (and their configuration) on every call, letting tests swap fakes without constructor patching.
- **Payoff:** Removes repeated configuration work, enables central instrumentation, and simplifies dependency injection.
- **Speed impact:** Medium (3/5)
- **Tech debt reduction:** High (5/5)

### Extract config generation primitives for reuse
- **Status:** ✅ Completed via `frontend/scripts/lib/config-utils.mjs` with `generate-config.mjs` now delegating to pure helpers covered by unit tests.
- **Context:** `frontend/scripts/generate-config.mjs`, `frontend/tests/config.test.mjs`
- **Problem solved:** Env parsing and commit metadata logic are reusable without shelling out, so other scripts can import them and tests no longer require full CLI runs.
- **Payoff:** Encourages reuse for future tooling (service worker, doctor checks), improves testability, and positions us for ESM bundling.
- **Speed impact:** Low-Medium (2/5)
- **Tech debt reduction:** Medium-High (4/5)

## Next Up

### Normalise deck personalisation sanitisation
- **Status:** ⏳ Pending
- **Context:** `backend/app/services/deck_personalization.py`
- **Problem:** The sanitisation helpers (`_sanitize_deck_ratings`, `_sanitize_tag_list`, etc.) return loosely-typed dicts/lists, and `_normalize_storage_entry` builds new dicts manually. Mutating these dicts is error-prone and hard to validate.
- **Refactor:** Introduce a lightweight dataclass (e.g. `DeckPersonalizationRecord`) that encapsulates validation and provides `from_storage()` / `to_storage()` methods. Sanitisation helpers can become `@staticmethod`s on the class, ensuring consistent types and providing a single place to clamp values.
- **Payoff:** Clearer type semantics, easier diffing when records change, and simpler unit tests because serialisation is exercised through a single public interface.
- **Speed impact:** Low-Medium (2/5)
- **Tech debt reduction:** High (5/5)
