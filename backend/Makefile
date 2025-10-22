.PHONY: install run test openapi clean

PYTHON ?= python3
VENV := .venv
PIP := $(VENV)/bin/pip
UVICORN := $(VENV)/bin/uvicorn
PYTEST := $(VENV)/bin/pytest

install: $(VENV)

$(VENV):
	@$(PYTHON) -m venv $(VENV)
	@$(PIP) install --upgrade pip
	@$(PIP) install -r requirements.txt

run: $(VENV)
	@$(UVICORN) app.main:app --reload --host 127.0.0.1 --port 4310

test: $(VENV)
	@$(PYTEST) tests

openapi: $(VENV)
	@$(VENV)/bin/python scripts/generate_openapi.py

clean:
	@$(PYTHON) -c "import shutil, pathlib; path = pathlib.Path('$(VENV)'); shutil.rmtree(path, ignore_errors=True)"
