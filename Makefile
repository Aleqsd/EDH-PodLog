ENV_FILES := $(wildcard .env .env.local)
ifneq ($(ENV_FILES),)
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' $(ENV_FILES))
include $(ENV_FILES)
endif

PYTHON ?= python

FRONTEND_DIR := frontend
FRONT_PUBLIC_DIR := $(FRONTEND_DIR)/public
FRONT_CONFIG_SCRIPT := $(FRONTEND_DIR)/scripts/generate-config.mjs
FRONT_SERVE_CONFIG := $(abspath $(FRONTEND_DIR)/serve.dev.json)
FRONTEND_PORT ?= 3170

BACKEND_DIR := backend
BACKEND_REQUIREMENTS := $(BACKEND_DIR)/requirements.txt
BACKEND_PIP := $(PYTHON) -m pip
BACKEND_UVICORN := $(PYTHON) -m uvicorn
BACKEND_PYTEST := $(PYTHON) -m pytest
BACKEND_PORT ?= 4310
BACKEND_DEPS_STAMP := $(BACKEND_DIR)/.deps-installed

MONGO_DATA_DIR ?= db/data
MONGO_LOG_PATH ?= db/mongod.log
MONGO_PID_PATH ?= db/mongod.pid
MONGO_PORT ?= 47017
MONGO_BIND_IP ?= 127.0.0.1

NETLIFY_SITE ?= deeffb22-eb20-4da2-8b41-2cd04e411d94
NETLIFY_CMD := netlify
NETLIFY_SITE_FLAG := $(if $(NETLIFY_SITE),--site $(NETLIFY_SITE),)
VPS_FRONTEND_ROOT ?= /var/www/edh-podlog
VPS_FRONTEND_OWNER ?= www-data:www-data
VPS_LOG_ROOT ?= /root/EDH-PodLog
VPS_BACK_LOG ?= $(VPS_LOG_ROOT)/back.log
VPS_DB_LOG ?= $(VPS_LOG_ROOT)/db.log
VPS_FRONT_LOG ?= $(VPS_LOG_ROOT)/front.log
VERSION_MANAGER := $(PYTHON) scripts/version_manager.py

.PHONY: front back db deps doctor \
	front-config front-build front-serve front-preview front-deploy front-clean front-test \
	backend backend-install backend-run backend-test backend-test-e2e backend-test-prod backend-openapi backend-deps \
	db-start db-stop db-status db-clean db-preview db-test \
	check-env check-tools test vps-deploy log-db log-back log-front \
	version-current version-prepare version-publish

front: front-serve

back: backend-run

db: db-start

backend: backend-run

front-config:
	@node $(FRONT_CONFIG_SCRIPT)

front-build: front-config
	@echo "Static assets ready in $(FRONT_PUBLIC_DIR)"

front-serve: front-config
	@npx --yes serve --config $(FRONT_SERVE_CONFIG) --listen tcp://127.0.0.1:$(FRONTEND_PORT) $(FRONT_PUBLIC_DIR)

front-test:
	@node --test $(FRONTEND_DIR)/tests/*.mjs

front-preview: front-build
	@$(NETLIFY_CMD) deploy $(NETLIFY_SITE_FLAG) --dir $(FRONT_PUBLIC_DIR) --alias preview

front-deploy: front-build
	@$(NETLIFY_CMD) deploy $(NETLIFY_SITE_FLAG) --dir $(FRONT_PUBLIC_DIR) --prod

front-clean:
	@node -e "try{require('node:fs').unlinkSync('$(FRONT_PUBLIC_DIR)/config.js');}catch(error){if(error.code!=='ENOENT'){throw error;}}"

backend-install: $(BACKEND_DEPS_STAMP)
	@echo "Backend dependencies installed via $(PYTHON)"

$(BACKEND_DEPS_STAMP): $(BACKEND_REQUIREMENTS)
	@$(BACKEND_PIP) install --break-system-packages -r $(BACKEND_REQUIREMENTS)
	@touch $(BACKEND_DEPS_STAMP)

backend-run: backend-install
	@set -a; \
	[ -f $(CURDIR)/.env ] && . $(CURDIR)/.env; \
	[ -f $(CURDIR)/.env.local ] && . $(CURDIR)/.env.local; \
	set +a; \
	$(BACKEND_UVICORN) app.main:app --reload --app-dir $(BACKEND_DIR) --host 127.0.0.1 --port $(BACKEND_PORT)

backend-test: backend-install
	@set -a; \
	[ -f $(CURDIR)/.env ] && . $(CURDIR)/.env; \
	[ -f $(CURDIR)/.env.local ] && . $(CURDIR)/.env.local; \
	set +a; \
	$(BACKEND_PYTEST) $(BACKEND_DIR)/tests

backend-test-e2e: backend-install
	@set -a; \
	[ -f $(CURDIR)/.env ] && . $(CURDIR)/.env; \
	[ -f $(CURDIR)/.env.local ] && . $(CURDIR)/.env.local; \
	set +a; \
	$(BACKEND_PYTEST) $(BACKEND_DIR)/tests/e2e

backend-test-prod: backend-install
	@set -a; \
	[ -f $(CURDIR)/.env ] && . $(CURDIR)/.env; \
	[ -f $(CURDIR)/.env.local ] && . $(CURDIR)/.env.local; \
	set +a; \
	$(BACKEND_PYTEST) --prod-smoke -m prod $(BACKEND_DIR)/tests

backend-openapi: backend-install
	@set -a; \
	[ -f $(CURDIR)/.env ] && . $(CURDIR)/.env; \
	[ -f $(CURDIR)/.env.local ] && . $(CURDIR)/.env.local; \
	set +a; \
	$(PYTHON) $(BACKEND_DIR)/scripts/generate_openapi.py

backend-deps:
	@rm -f $(BACKEND_DEPS_STAMP)
	@$(MAKE) backend-install

vps-deploy: front-build
	@echo "Staging frontend assets to $(VPS_FRONTEND_ROOT)..."
	@install -d -m 755 $(VPS_FRONTEND_ROOT)
	@rsync -rlptgoD --delete $(FRONT_PUBLIC_DIR)/ $(VPS_FRONTEND_ROOT)/
	@chmod -R go+rX $(VPS_FRONTEND_ROOT)
	@chown -R $(VPS_FRONTEND_OWNER) $(VPS_FRONTEND_ROOT) >/dev/null 2>&1 || true
	@echo "Restarting MongoDB service..."
	@systemctl restart mongod
	@echo "Restarting FastAPI service..."
	@systemctl restart edh-podlog
	@echo "Deploying frontend to Netlify..."
	@$(NETLIFY_CMD) deploy $(NETLIFY_SITE_FLAG) --dir $(FRONT_PUBLIC_DIR) --prod
	@echo "VPS deployment complete."

log-db:
	@echo "Streaming MongoDB logs (CTRL+C to stop)..."
	@mkdir -p $(VPS_LOG_ROOT)
	@touch $(VPS_DB_LOG)
	@tail -n 200 -F $(VPS_DB_LOG)

log-back:
	@echo "Streaming FastAPI backend logs (CTRL+C to stop)..."
	@mkdir -p $(VPS_LOG_ROOT)
	@touch $(VPS_BACK_LOG)
	@tail -n 200 -F $(VPS_BACK_LOG)

log-front:
	@echo "Streaming Nginx access/error logs (CTRL+C to stop)..."
	@mkdir -p $(VPS_LOG_ROOT)
	@touch $(VPS_FRONT_LOG)
	@if [ -f /var/log/nginx/access.log ] || [ -f /var/log/nginx/error.log ]; then \
		tail -n 200 -f /var/log/nginx/access.log /var/log/nginx/error.log 2>/dev/null | stdbuf -oL tee -a $(VPS_FRONT_LOG); \
	else \
		tail -n 200 -F $(VPS_FRONT_LOG); \
	fi

db-start:
	@command -v mongod >/dev/null || (echo "mongod not found. Install MongoDB Community Edition to use this target." && exit 1)
	@mkdir -p $(MONGO_DATA_DIR)
	@RUNNING=0; \
	if [ -f $(MONGO_PID_PATH) ]; then \
		case "$$(uname -s 2>/dev/null)" in \
			MINGW*|MSYS*|CYGWIN* ) \
				MONGO_PID=$$(cat $(MONGO_PID_PATH)); \
				if [ -n "$$MONGO_PID" ] && kill -0 $$MONGO_PID 2>/dev/null; then \
					RUNNING=1; \
				fi ;; \
			* ) \
				if kill -0 $$(cat $(MONGO_PID_PATH)) 2>/dev/null; then \
					RUNNING=1; \
				fi ;; \
		esac; \
	fi; \
	if [ $$RUNNING -eq 1 ]; then \
		echo "MongoDB already running (PID $$(cat $(MONGO_PID_PATH)))."; \
	else \
		echo "Starting MongoDB on port $(MONGO_PORT)..."; \
		case "$$(uname -s 2>/dev/null)" in \
			MINGW*|MSYS*|CYGWIN* ) \
				nohup mongod --dbpath "$(MONGO_DATA_DIR)" --logpath "$(MONGO_LOG_PATH)" --bind_ip "$(MONGO_BIND_IP)" --port "$(MONGO_PORT)" --logappend >/dev/null 2>&1 & \
				MONGO_PID=$$!; \
				printf '%s\n' "$$MONGO_PID" > "$(MONGO_PID_PATH)"; \
				sleep 1; \
				if ! kill -0 $$MONGO_PID 2>/dev/null; then \
					echo "MongoDB failed to start; check $(MONGO_LOG_PATH)"; \
					rm -f "$(MONGO_PID_PATH)"; \
					exit 1; \
				fi; \
				;; \
			* ) \
				mongod --dbpath $(MONGO_DATA_DIR) --logpath $(MONGO_LOG_PATH) --bind_ip $(MONGO_BIND_IP) --port $(MONGO_PORT) --fork --pidfilepath $(MONGO_PID_PATH); \
				;; \
		esac; \
	fi

db-stop:
	@RUNNING=0; \
	if [ -f $(MONGO_PID_PATH) ]; then \
		case "$$(uname -s 2>/dev/null)" in \
			MINGW*|MSYS*|CYGWIN* ) \
				MONGO_PID=$$(cat $(MONGO_PID_PATH)); \
				if [ -n "$$MONGO_PID" ] && kill -0 $$MONGO_PID 2>/dev/null; then \
					RUNNING=1; \
				fi ;; \
			* ) \
				if kill -0 $$(cat $(MONGO_PID_PATH)) 2>/dev/null; then \
					RUNNING=1; \
				fi ;; \
		esac; \
	fi; \
	if [ $$RUNNING -eq 1 ]; then \
		echo "Shutting down MongoDB..."; \
		case "$$(uname -s 2>/dev/null)" in \
			MINGW*|MSYS*|CYGWIN* ) \
				MONGO_PID=$$(cat $(MONGO_PID_PATH)); \
				if [ -n "$$MONGO_PID" ]; then \
					if ! kill $$MONGO_PID >/dev/null 2>&1; then \
						if command -v taskkill >/dev/null 2>&1; then \
							taskkill /PID $$MONGO_PID /F >/dev/null 2>&1 || true; \
						fi; \
					fi; \
				fi; \
				;; \
			* ) \
				mongod --dbpath $(MONGO_DATA_DIR) --shutdown >/dev/null 2>&1 || kill $$(cat $(MONGO_PID_PATH)) >/dev/null 2>&1; \
				;; \
		esac; \
		rm -f $(MONGO_PID_PATH); \
	else \
		echo "MongoDB is not running."; \
	fi

db-status:
	@STATUS=1; \
	if [ -f $(MONGO_PID_PATH) ]; then \
		case "$$(uname -s 2>/dev/null)" in \
			MINGW*|MSYS*|CYGWIN* ) \
				MONGO_PID=$$(cat $(MONGO_PID_PATH)); \
				if [ -n "$$MONGO_PID" ] && kill -0 $$MONGO_PID 2>/dev/null; then \
					STATUS=0; \
				fi ;; \
			* ) \
				if kill -0 $$(cat $(MONGO_PID_PATH)) 2>/dev/null; then \
					STATUS=0; \
				fi ;; \
		esac; \
	fi; \
	if [ $$STATUS -eq 0 ]; then \
		echo "MongoDB running (PID $$(cat $(MONGO_PID_PATH)))"; \
	else \
		echo "MongoDB not running"; \
	fi

db-clean:
	@echo "Resetting MongoDB data directory $(MONGO_DATA_DIR)..."
	@$(PYTHON) -c "import pathlib, shutil; path = pathlib.Path('$(MONGO_DATA_DIR)'); shutil.rmtree(path, ignore_errors=True); path.mkdir(parents=True, exist_ok=True)"

db-preview:
	@command -v mongosh >/dev/null || command -v mongo >/dev/null || (echo "mongosh (or legacy mongo) CLI not found. Install MongoDB Shell to use db-preview." && exit 1)
	@set -a; \
	[ -f $(CURDIR)/.env ] && . $(CURDIR)/.env; \
	[ -f $(CURDIR)/.env.local ] && . $(CURDIR)/.env.local; \
	set +a; \
	URI=$${MONGO_URI:-mongodb://127.0.0.1:$(MONGO_PORT)}; \
	DB=$${MONGO_DB_NAME:-edh_podlog}; \
	if command -v mongosh >/dev/null; then \
		CLI=mongosh; \
	else \
		CLI=mongo; \
	fi; \
	SCRIPT='const maxDocs = 3; const getCollectionNames = () => (typeof db.getCollectionNames === "function" ? db.getCollectionNames() : db.getCollectionInfos().map((info) => info.name)); const collections = getCollectionNames().filter((name) => !name.startsWith("system.")); if (!collections.length) { print("No collections found."); } else { collections.forEach((name) => { print("\n== " + name + " =="); const cursor = db.getCollection(name).find().limit(maxDocs); if (!cursor.hasNext()) { print("  (empty)"); } else { cursor.forEach((doc) => printjson(doc)); } }); }'; \
	echo "Previewing MongoDB database '$$DB' at $$URI"; \
	$$CLI "$$URI/$$DB" --quiet --eval "$$SCRIPT"

db-test: backend-install
	@set -a; \
	[ -f $(CURDIR)/.env ] && . $(CURDIR)/.env; \
	[ -f $(CURDIR)/.env.local ] && . $(CURDIR)/.env.local; \
	set +a; \
	$(PYTHON) -m pytest db/tests

check-tools:
	@command -v node >/dev/null || (echo "Missing required tool: node" && exit 1)
	@command -v $(PYTHON) >/dev/null || (echo "Missing required tool: $(PYTHON)" && exit 1)
	@command -v mongod >/dev/null || (echo "Missing required tool: mongod" && exit 1)

check-env:
	@$(PYTHON) scripts/check_env.py

doctor: check-tools check-env

deps: backend-deps

test: front-test backend-test backend-test-e2e db-test

version-current:
	@$(VERSION_MANAGER) current

version-prepare:
	@if [ -z "$(PART)" ]; then \
		echo "Usage: make version-prepare PART=major|minor|patch"; \
		exit 1; \
	fi
	@$(VERSION_MANAGER) prepare $(PART)

version-publish:
	@$(VERSION_MANAGER) publish $(ARGS)
