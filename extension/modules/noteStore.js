// SPDX-License-Identifier: GPL-3.0-or-later
// Simple JSON-backed single-note store for clock_z99.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'clock-z99']);
const FILE = GLib.build_filenamev([DIR, 'note.json']);

function ensureDir() {
    GLib.mkdir_with_parents(DIR, 0o755);
}

export function load() {
    try {
        const f = Gio.File.new_for_path(FILE);
        if (!f.query_exists(null))
            return '';
        const [ok, contents] = f.load_contents(null);
        if (!ok)
            return '';
        const text = new TextDecoder().decode(contents);
        const data = JSON.parse(text);
        return (data && typeof data.text === 'string') ? data.text : '';
    } catch (e) {
        return '';
    }
}

export function save(text) {
    try {
        ensureDir();
        const f = Gio.File.new_for_path(FILE);
        const data = JSON.stringify({ text: text || '', updated: Date.now() });
        f.replace_contents(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (e) {
        // best effort
    }
}

export function path() {
    return FILE;
}
