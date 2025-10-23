# Moxfield Scraping API

The backend is a FastAPI application that proxies the public endpoints used by [moxfield.com](https://moxfield.com). It consolidates deck metadata, fetches full cardlists, and persists everything in MongoDB so repeated syncs are fast.

## Running locally

From the repository root:

```bash
make backend-install  # bootstrap backend/.venv and install dependencies
make back             # launch uvicorn on http://127.0.0.1:4310 with auto-reload
```

Both commands load environment variables from `.env` and `.env.local`. Defaults live in `backend/app/config.py`:

- `MONGO_URI` (defaults to `mongodb://127.0.0.1:47017`)
- `MONGO_DB_NAME` (defaults to `edh_podlog`)
- `MONGO_USERS_COLLECTION` (Google profiles), `MONGO_MOXFIELD_USERS_COLLECTION`,
  `MONGO_DECKS_COLLECTION`, `MONGO_DECK_SUMMARIES_COLLECTION`

Use `make db` in the monorepo root to start `mongod` if you do not already have a local MongoDB instance.

Prefer working inside this directory? The scoped `Makefile` mirrors the same commands:

```bash
cd backend
make install
make run
```

## API surface

- `GET /health` – simple health probe.
- `GET /profiles/{google_sub}` – fetch a Google-authenticated user profile.
- `PUT /profiles/{google_sub}` – create or update a Google-authenticated user profile.
- `GET /users/{username}/decks` – fetch decks with full card lists and upsert them in MongoDB.
- `GET /users/{username}/deck-summaries` – fetch decks without card breakdowns.
- `GET /cache/users/{username}/decks` – return cached decks without hitting Moxfield.
- `GET /cache/users/{username}/deck-summaries` – cached summaries.

Example request:

```bash
curl http://127.0.0.1:4310/users/BimboLegrand/decks | jq
```

## Testing

Tests stub network calls and run quickly:

```bash
make backend-test
```

Or, from this subdirectory:

```bash
cd backend
make test
```

## OpenAPI / docs

Regenerate the bundled OpenAPI schema whenever endpoints or schemas change:

```bash
make backend-openapi
```

With the server running, open <http://127.0.0.1:4310/docs> for FastAPI's interactive Swagger UI.

## Notes

- User profiles persist Google identity metadata, the saved Moxfield handle, and the list of
  selected decks. Cached Moxfield payloads now live in the dedicated `MONGO_MOXFIELD_USERS_COLLECTION`.
- Only public decks are returned; private decks remain inaccessible without Moxfield authentication.
- Responses include the raw Moxfield card payload so the frontend can decide how much detail to surface.
- Requests are intentionally sequential to avoid hammering Moxfield. Tweak `MoxfieldClient.collect_user_decks_with_details` if you need concurrency.
