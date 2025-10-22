# Local MongoDB

`make db` wraps a local `mongod --fork` instance bound to `127.0.0.1:47017` with its data stored under `db/data/`.

## Commands

- `make db` or `make db-start` – start MongoDB (logs written to `db/mongod.log`).
- `make db-stop` – stop the running instance.
- `make db-status` – report whether `mongod` is running.
- `make db-clean` – wipe and recreate `db/data/` (useful for a fresh start).
- `make db-test` – run configuration checks ensuring custom ports are respected.

Adjust the port or bind address via environment variables before running the commands, for example:

```bash
MONGO_PORT=47018 make db
```

Update `.env.local` so the backend points to the same URI.
