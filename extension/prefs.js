// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function formatSecs(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0)
        return `${h}h ${m}m`;
    if (sec === 0)
        return `${m} min`;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

export default class ClockZ99Preferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Timer',
            icon_name: 'appointment-soon-symbolic',
        });

        const timerGroup = new Adw.PreferencesGroup({ title: 'Countdown' });

        const durationRow = new Adw.SpinRow({
            title: 'Default duration (seconds)',
            subtitle: `Currently ${formatSecs(settings.get_int('default-duration'))}. Reset and autostart use this.`,
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 7200,
                step_increment: 30,
                page_increment: 300,
                value: settings.get_int('default-duration'),
            }),
        });
        settings.bind('default-duration', durationRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.connect('changed::default-duration', () => {
            durationRow.subtitle = `Currently ${formatSecs(settings.get_int('default-duration'))}. Reset and autostart use this.`;
        });
        timerGroup.add(durationRow);

        // Quick presets
        const presetRow = new Adw.ActionRow({ title: 'Presets', subtitle: 'One click to set common meeting lengths' });
        const box = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
        for (const [label, secs] of [['5:00', 300], ['25:00', 1500], ['60:00', 3600]]) {
            const btn = new Gtk.Button({ label });
            btn.connect('clicked', () => settings.set_int('default-duration', secs));
            box.append(btn);
        }
        presetRow.add_suffix(box);
        timerGroup.add(presetRow);
        page.add(timerGroup);

        const posGroup = new Adw.PreferencesGroup({ title: 'Position' });

        const yRow = new Adw.SpinRow({
            title: 'Distance from top',
            subtitle: 'Pixels from the top edge (negative tucks into the edge)',
            adjustment: new Gtk.Adjustment({
                lower: -60, upper: 120, step_increment: 1, page_increment: 10,
                value: settings.get_int('y-offset'),
            }),
        });
        settings.bind('y-offset', yRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(yRow);

        const xRow = new Adw.SpinRow({
            title: 'Horizontal offset',
            subtitle: '0 = centered. Dragging the island updates this.',
            adjustment: new Gtk.Adjustment({
                lower: -1200, upper: 1200, step_increment: 5, page_increment: 50,
                value: settings.get_int('x-offset'),
            }),
        });
        settings.bind('x-offset', xRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(xRow);

        const centerBtn = new Gtk.Button({ label: 'Re-center' });
        centerBtn.connect('clicked', () => settings.set_int('x-offset', 0));
        const centerRow = new Adw.ActionRow({ title: 'Reset position' });
        centerRow.add_suffix(centerBtn);
        posGroup.add(centerRow);
        page.add(posGroup);

        const padGroup = new Adw.PreferencesGroup({
            title: 'Text & Padding',
            description: 'Tune text size and its horizontal, top, and bottom margins inside the tab',
        });

        const fontRow = new Adw.SpinRow({
            title: 'Font size',
            adjustment: new Gtk.Adjustment({
                lower: 12, upper: 32, step_increment: 1, page_increment: 2,
                value: settings.get_int('font-size'),
            }),
        });
        settings.bind('font-size', fontRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        padGroup.add(fontRow);

        const padRow = new Adw.SpinRow({
            title: 'Horizontal padding',
            subtitle: 'Left and right margin around the text',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 60, step_increment: 1, page_increment: 5,
                value: settings.get_int('h-padding'),
            }),
        });
        settings.bind('h-padding', padRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        padGroup.add(padRow);

        const topPadRow = new Adw.SpinRow({
            title: 'Top padding',
            subtitle: 'Margin above the text',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 40, step_increment: 1, page_increment: 2,
                value: settings.get_int('top-padding'),
            }),
        });
        settings.bind('top-padding', topPadRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        padGroup.add(topPadRow);

        const bottomPadRow = new Adw.SpinRow({
            title: 'Bottom padding',
            subtitle: 'Margin below the text',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 40, step_increment: 1, page_increment: 2,
                value: settings.get_int('bottom-padding'),
            }),
        });
        settings.bind('bottom-padding', bottomPadRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        padGroup.add(bottomPadRow);
        page.add(padGroup);

        const uiGroup = new Adw.PreferencesGroup({ title: 'Appearance & Hotkey' });

        const bottomRow = new Adw.SpinRow({
            title: 'Bottom corner radius',
            subtitle: 'Convex rounding of the two free bottom corners',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 30, step_increment: 1, page_increment: 2,
                value: settings.get_int('bottom-radius'),
            }),
        });
        settings.bind('bottom-radius', bottomRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        uiGroup.add(bottomRow);

        const filletRow = new Adw.SpinRow({
            title: 'Top fillet radius',
            subtitle: 'Concave scoop where the tab meets the screen edge. 0 = square butt joint.',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 28, step_increment: 1, page_increment: 2,
                value: settings.get_int('top-fillet'),
            }),
        });
        settings.bind('top-fillet', filletRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        uiGroup.add(filletRow);

        const hotkeyRow = new Adw.EntryRow({
            title: 'Toggle hotkey',
            text: (settings.get_strv('toggle-hotkey')[0] || '').toString(),
        });
        hotkeyRow.connect('apply', () => {
            const t = hotkeyRow.get_text().trim() || '<Super>q';
            settings.set_strv('toggle-hotkey', [t]);
        });
        uiGroup.add(hotkeyRow);

        const helpRow = new Adw.ActionRow({
            title: 'Usage',
            subtitle: 'Click: pause/resume • Scroll: ±1min (Shift: ±10s) • Right-click: reset • Double-click: type MM:SS • Drag: move along top',
        });
        uiGroup.add(helpRow);
        page.add(uiGroup);

        window.add(page);
    }
}
