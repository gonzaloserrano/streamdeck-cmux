PLUGIN_DIR := com.cmux.streamdeck.sdPlugin
INSTALL_DIR := $(HOME)/Library/Application Support/com.elgato.StreamDeck/Plugins/$(PLUGIN_DIR)

.PHONY: help deploy build setup install package release

help: ## Show available targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

deploy: build ## Build and hot-reload plugin to Stream Deck
	@# Overwrite files in place; kill plugin process; Stream Deck auto-restarts it
	rm -rf "$(INSTALL_DIR)/bin"
	cp -r $(PLUGIN_DIR)/bin "$(INSTALL_DIR)/bin"
	cp -r $(PLUGIN_DIR)/imgs "$(INSTALL_DIR)/imgs"
	cp $(PLUGIN_DIR)/manifest.json "$(INSTALL_DIR)/manifest.json"
	@# Sync node_modules only if missing
	@[ -d "$(INSTALL_DIR)/node_modules" ] || cp -r node_modules "$(INSTALL_DIR)/node_modules"
	@# Kill plugin process; Stream Deck restarts it automatically
	pkill -f "com.cmux.streamdeck.sdPlugin/bin/plugin.js" 2>/dev/null || true

install: build ## Full install (first time). Restarts Stream Deck
	pkill -x "Stream Deck" 2>/dev/null || true
	sleep 1
	rm -rf "$(INSTALL_DIR)"
	cp -r $(PLUGIN_DIR) "$(INSTALL_DIR)"
	cp -r node_modules "$(INSTALL_DIR)/node_modules"
	open -a "Elgato Stream Deck"

package: build ## Create .streamDeckPlugin (double-click to install)
	rm -f com.cmux.streamdeck.streamDeckPlugin
	cd $(PLUGIN_DIR) && cp -r ../node_modules . && cd .. && \
		zip -r com.cmux.streamdeck.streamDeckPlugin $(PLUGIN_DIR) -x "$(PLUGIN_DIR)/node_modules/.cache/*" && \
		rm -rf $(PLUGIN_DIR)/node_modules
	@echo "Created com.cmux.streamdeck.streamDeckPlugin"

release: ## Bump patch version, tag, and push to trigger release
	@latest=$$(git tag --sort=-v:refname | head -1); \
	if [ -z "$$latest" ]; then next="v0.1.0"; \
	else next=$$(echo "$$latest" | awk -F. '{printf "%s.%s.%d", $$1, $$2, $$3+1}'); \
	fi; \
	echo "$$latest -> $$next"; \
	git tag "$$next" && git push origin "$$next"

build: setup
	npm run build

setup:
	@[ -d node_modules ] || npm install
	@[ -f $(PLUGIN_DIR)/imgs/state-normal.png ] || node scripts/gen-images.js
