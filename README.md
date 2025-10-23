# EDH PodLog Monorepo

This repository now groups the static frontend, the FastAPI backend that proxies Moxfield, and a local MongoDB data directory in a single tree. Everything runs without Docker and can be started with a handful of `make` commands.

## Directory Layout

- `frontend/` – static site assets and the config generator (`scripts/generate-config.mjs`).
- `backend/` – FastAPI application exposing the Moxfield proxy API plus tests and scripts.
- `db/` – local MongoDB data directory used by `make db` (contains a tracked `.gitkeep`).
- `AGENTS.md` – agent playbook for teammates and automation.
- `docs/` – long-form product documentation (`edh-podlog-trashdraft.md`, etc.).

## Prerequisites

- Node.js 18+ (for the config generator and `npx serve`).
- Python 3.11+.
- MongoDB Community Edition installed locally (`mongod` available on your path).
- Optional: Netlify CLI if you plan to deploy the static site.

## Quickstart

1. Copy the shared environment template and adjust the values:

   ```bash
   cp .env.example .env
   ```

   Set `GOOGLE_CLIENT_ID`, and override the MongoDB settings if you do not want the defaults (`mongodb://127.0.0.1:47017`, database `edh_podlog`).

2. Start MongoDB, the backend, and the frontend (each command runs until you stop it):

   ```bash
   make db          # starts mongod on 127.0.0.1:47017 with data stored in db/data
   make back        # launches FastAPI on http://127.0.0.1:4310
   make front       # serves frontend/public on http://127.0.0.1:3170
   ```

   Use `CTRL+C` to stop the `make back` / `make front` processes. Shut down MongoDB with `make db-stop` when you are done.

The frontend automatically reads `API_BASE_URL` from `.env.local` (defaults to `http://localhost:4310`) and calls the Python API instead of hitting Moxfield directly.

## Make Targets

- `make front-config` – generate `frontend/public/config.js` from `.env` / `.env.local`.
- `make front-build` – ensure assets are ready (used by Netlify builds).
- `make front-test` – run the Node-based frontend test suite (`node --test`).
- `make front-preview` / `make front-deploy` – deploy previews or production with Netlify CLI.
- `make backend-install` – install backend dependencies into the current Python environment (tracked by `backend/.deps-installed`).
- `make backend-run` or `make back` – start the FastAPI server with environment variables from `.env` / `.env.local`.
- `make backend-test` – run the backend test suite via `python -m pytest`.
- `make backend-openapi` – regenerate `backend/openapi.json` from the live app.
- `make backend-deps` – reinstall backend dependencies (clears the stamp file before rerunning `backend-install`).
- `make db-start` / `make db` – start MongoDB (data stored under `db/data`).
- `make db-stop` / `make db-status` / `make db-clean` – manage the local MongoDB instance.
- `make db-preview` – preview up to three documents from every Mongo collection.
- `make db-test` – run configuration checks for the database layer.
- `make vps-deploy` – on the VPS, rebuild frontend config, sync the static bundle into `/var/www/edh-podlog` for Nginx (override with `VPS_FRONTEND_ROOT=/path` if needed), restart MongoDB + backend services, and deploy the static assets to Netlify.
- `make log-db` / `make log-back` / `make log-front` – stream MongoDB, backend systemd, or Nginx logs (Ctrl+C to exit).
- `make test` – aggregate frontend, backend, and db tests.
- `make doctor` – verify required tooling and sanity-check environment variables.
- `make deps` – convenience shortcut for installing backend dependencies with the system interpreter.

Every backend-oriented target automatically loads `.env` and `.env.local` so the FastAPI app picks up your MongoDB configuration.

## Frontend Notes

The static site lives in `frontend/public/`. `config.js` is generated at runtime to keep secrets out of Git. Netlify builds can keep using `make front-build` followed by `make front-deploy`, supplying `NETLIFY_SITE=...` when needed.

## Backend Notes

The FastAPI application keeps the original endpoints:

- `GET /health` – health probe.
- `GET /users/{username}/decks` – fetch decks with full card lists and cache the payload in MongoDB.
- `GET /users/{username}/deck-summaries` – same without card lists.
- `GET /cache/users/{username}/...` – return cached copies without hitting Moxfield.

Cross-origin requests are allowed from `http://localhost:3170` / `http://127.0.0.1:3170` by default. Override the list with the comma-separated `API_CORS_ALLOW_ORIGINS` variable when deploying to other domains.

See `backend/README.md` for more detail on testing and contributing changes to the API layer.

## Database Notes

`make db` wraps `mongod --fork` bound to `127.0.0.1:47017` with data persisted to `db/data/`. Adjust `MONGO_URI` in `.env.local` if you prefer a different port or host. `make db-clean` wipes and recreates the local data directory.

## Deployment

- Frontend: Netlify via `make front-build` and `make front-deploy`.
- Backend: deploy however you prefer (e.g., uvicorn / Gunicorn on a VM). The code expects MongoDB credentials in the environment; see `.env.example` for the full list of variables.

## VPS Operations (vps.zqsdev.com)

- **MongoDB service**  
  - Start/enable: `systemctl enable --now mongod` (listens on `127.0.0.1:27017`).  
  - Health check: `mongosh --port 27017 --eval 'db.runCommand({ ping: 1 })'`.  
  - Restart: `systemctl restart mongod`. Logs available with `journalctl -u mongod`.
- **FastAPI backend (`edh-podlog.service`)**  
  - Managed via `/etc/systemd/system/edh-podlog.service` with `EnvironmentFile=/root/EDH-PodLog/.env`.  
  - Start/enable: `systemctl enable --now edh-podlog`. Restart after updates: `systemctl restart edh-podlog`.  
  - Logs/health: `journalctl -u edh-podlog`, `curl http://127.0.0.1:4310/health`. Externally, hit `https://vps.zqsdev.com/api/health` once the proxy is active.
- **Reverse proxy (Nginx)**  
  - Config stored in `/etc/nginx/sites-available/edh-podlog` (symlinked into `sites-enabled`).  
  - Set `root /var/www/edh-podlog;` (or adjust `VPS_FRONTEND_ROOT`) so workers can read the static bundle staged by `make vps-deploy`. Avoid pointing Nginx at `/root/...` because the default permissions block `www-data`.  
  - If your Nginx worker runs under a different account, invoke `make vps-deploy` with `VPS_FRONTEND_OWNER=user:group` so file ownership matches.
  - Reload after edits: `nginx -t && systemctl reload nginx`. Use `certbot --nginx -d vps.zqsdev.com` for TLS.
- **Log streaming**  
  - `make log-db` pour `journalctl -u mongod`.  
  - `make log-back` pour `journalctl -u edh-podlog`.  
  - `make log-front` pour `tail -f /var/log/nginx/access.log /var/log/nginx/error.log`.  
  - Chaque commande alimente `/root/EDH-PodLog/{db,back,front}.log`. `make log-front` relaie aussi les journaux Nginx par défaut vers `front.log` pour avoir un flux immédiat. Exécutez `sudo scripts/configure-vps-logs.sh` une fois pour installer les overrides systemd (option `LOG_ROOT=/path`) et mettre à jour les directives `access_log`/`error_log` de Nginx vers ce fichier.  
  - Deck sync requests emit structured summaries (counts, success/failure, persistence status) in `journalctl -u edh-podlog`.
- **Frontend on Netlify**  
  - Production deploy: `make front-build` then `netlify deploy --prod --dir frontend/public --site <SITE_ID>` (requires `NETLIFY_AUTH_TOKEN` or `netlify login`).  
  - Ensure Netlify env vars include `API_BASE_URL=https://vps.zqsdev.com/api` and `API_CORS_ALLOW_ORIGINS` is mirrored in `.env` for the backend. Trigger rebuilds from the Netlify UI if needed.
- **After updating code**  
  - Pull latest repo changes, regenerate frontend config (`make front-config`), redeploy Netlify, then restart backend (`systemctl restart edh-podlog`).  
  - Run `make test` locally before rolling out and `journalctl -u edh-podlog -f` to monitor for regressions.
- **One-liner rollout**  
  - From `/root/EDH-PodLog`, run `make vps-deploy` (with `sudo` if needed to write `/var/www/edh-podlog`) to regenerate the frontend config, stage world-readable static assets, restart `mongod`/`edh-podlog`, and push the bundle to Netlify (requires Netlify CLI credentials and `NETLIFY_SITE` configured).

## Helpful Scripts

- `frontend/scripts/generate-config.mjs` builds the runtime config injected into the static bundle.
- `backend/scripts/generate_openapi.py` refreshes `backend/openapi.json` for documentation consumers.
- `scripts/configure-vps-logs.sh` installe les overrides systemd côté backend/Mongo et fournit les instructions pour faire écrire Nginx dans `/root/EDH-PodLog/front.log` (exécuter avec sudo).

Happy logging!
