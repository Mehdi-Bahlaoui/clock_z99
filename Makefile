.PHONY: all install clean pack deploy-remote

EXTENSION_UUID = clock-z99@mehdi-bahlaoui.github.io
EXTENSION_DIR = extension
REMOTE_HOST = wolfie@dionisus.local
REMOTE_EXT_DIR = .local/share/gnome-shell/extensions/$(EXTENSION_UUID)

all: install

install:
	@echo "📦 Installing $(EXTENSION_UUID)..."
	@mkdir -p ~/.local/share/gnome-shell/extensions/$(EXTENSION_UUID)
	@cp -r $(EXTENSION_DIR)/* ~/.local/share/gnome-shell/extensions/$(EXTENSION_UUID)/
	@glib-compile-schemas ~/.local/share/gnome-shell/extensions/$(EXTENSION_UUID)/schemas/
	@echo "✅ Installed. Log out/in on Wayland if first install, then:"
	@echo "   gnome-extensions enable $(EXTENSION_UUID)"

deploy-remote:
	@echo "🚀 Deploying to $(REMOTE_HOST)..."
	@ssh $(REMOTE_HOST) "mkdir -p '$(REMOTE_EXT_DIR)'"
	@scp -r $(EXTENSION_DIR)/* $(REMOTE_HOST):"$(REMOTE_EXT_DIR)/"
	@ssh $(REMOTE_HOST) "glib-compile-schemas '$(REMOTE_EXT_DIR)/schemas/'"
	@echo "✅ Deployed."

pack:
	@echo "📦 Packaging..."
	@mkdir -p dist
	@rm -f $(EXTENSION_DIR)/schemas/gschemas.compiled
	@glib-compile-schemas $(EXTENSION_DIR)/schemas/
	@cd $(EXTENSION_DIR) && zip -r ../dist/$(EXTENSION_UUID).zip * -x "schemas/gschemas.compiled"
	@echo "✅ dist/$(EXTENSION_UUID).zip"

clean:
	@rm -rf $(EXTENSION_DIR)/schemas/gschemas.compiled dist
	@echo "✅ Clean."
