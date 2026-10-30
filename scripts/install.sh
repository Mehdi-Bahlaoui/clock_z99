#!/bin/bash
set -e
EXTENSION_UUID="clock-z99@mehdi-bahlaoui.github.io"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
SOURCE_DIR="$(dirname "$0")/../extension"
echo "Installing Clock Z99..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -r "$SOURCE_DIR"/* "$INSTALL_DIR/"
glib-compile-schemas "$INSTALL_DIR/schemas/"
echo "Done. Log out/in on Wayland if needed, then: gnome-extensions enable $EXTENSION_UUID"
