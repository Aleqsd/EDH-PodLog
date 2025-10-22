# Default location of the generated static assets
PUBLIC_DIR := public
CONFIG_SCRIPT := scripts/generate-config.mjs
NETLIFY_SITE ?=
NETLIFY_CMD := netlify
NETLIFY_SITE_FLAG := $(if $(NETLIFY_SITE),--site $(NETLIFY_SITE),)

.PHONY: config build preview deploy clean

config:
	@node $(CONFIG_SCRIPT)

build: config
	@echo "Static assets ready in $(PUBLIC_DIR)"

preview: build
	@$(NETLIFY_CMD) deploy $(NETLIFY_SITE_FLAG) --dir $(PUBLIC_DIR) --alias preview

deploy: build
	@$(NETLIFY_CMD) deploy $(NETLIFY_SITE_FLAG) --dir $(PUBLIC_DIR) --prod

clean:
	@rm -f $(PUBLIC_DIR)/config.js
