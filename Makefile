PLUGIN_DIR := com.cmux.streamdeck.sdPlugin
INSTALL_DIR := $(HOME)/Library/Application Support/com.elgato.StreamDeck/Plugins/$(PLUGIN_DIR)

.PHONY: deploy build setup install

deploy: build
	@# Overwrite files in place; kill plugin process; Stream Deck auto-restarts it
	rm -rf "$(INSTALL_DIR)/bin"
	cp -r $(PLUGIN_DIR)/bin "$(INSTALL_DIR)/bin"
	cp -r $(PLUGIN_DIR)/imgs "$(INSTALL_DIR)/imgs"
	cp $(PLUGIN_DIR)/manifest.json "$(INSTALL_DIR)/manifest.json"
	@# Sync node_modules only if missing
	@[ -d "$(INSTALL_DIR)/node_modules" ] || cp -r node_modules "$(INSTALL_DIR)/node_modules"
	@# Kill plugin process; Stream Deck restarts it automatically
	pkill -f "com.cmux.streamdeck.sdPlugin/bin/plugin.js" 2>/dev/null || true

install: build
	@# Full install (first time or after clean). Restarts Stream Deck.
	pkill -x "Stream Deck" 2>/dev/null || true
	sleep 1
	rm -rf "$(INSTALL_DIR)"
	cp -r $(PLUGIN_DIR) "$(INSTALL_DIR)"
	cp -r node_modules "$(INSTALL_DIR)/node_modules"
	open -a "Elgato Stream Deck"

build: setup
	npm run build

setup:
	@[ -d node_modules ] || npm install
	@[ -f $(PLUGIN_DIR)/imgs/state-normal.png ] || node scripts/gen-images.js
