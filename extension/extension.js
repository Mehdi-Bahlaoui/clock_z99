// SPDX-License-Identifier: GPL-3.0-or-later
// clock_z99 — always-on-top top-edge tab countdown.
// Toggle: Super+Q (configurable). Click: pause/resume.
// Scroll: +/-1min (Shift+scroll: +/-10s). Right-click: reset + autostart.
// Double-click: quick-set via inline entry (MM:SS). Drag: move along top.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DRAG_THRESHOLD = 6;

// Wall-clock based deadline. Uses GLib.get_real_time() so the countdown
// keeps running across suspend; manual/NTP clock changes can shift it.


function formatTime(totalSeconds) {
    totalSeconds = Math.max(0, Math.ceil(totalSeconds));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = n => String(n).padStart(2, '0');
    if (h > 0)
        return `${h}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
}

function parseTimeString(text) {
    if (!text)
        return null;
    text = text.trim().toLowerCase().replace(/[.,]/g, ':');
    // plain minutes: "10" -> 10:00 ; plain seconds with s: "90s"
    let m = text.match(/^(\d+)\s*s$/);
    if (m)
        return parseInt(m[1], 10);
    m = text.match(/^(\d+)\s*m$/);
    if (m)
        return parseInt(m[1], 10) * 60;
    m = text.match(/^(\d+)\s*h$/);
    if (m)
        return parseInt(m[1], 10) * 3600;
    const parts = text.split(':').map(p => p.trim());
    if (parts.some(p => p === '' || isNaN(Number(p))))
        return null;
    const nums = parts.map(Number);
    if (nums.some(n => n < 0))
        return null;
    if (nums.length === 1)
        return Math.round(nums[0] * 60); // "10" = 10 minutes
    if (nums.length === 2)
        return Math.round(nums[0] * 60 + nums[1]); // MM:SS
    if (nums.length === 3)
        return Math.round(nums[0] * 3600 + nums[1] * 60 + nums[2]);
    return null;
}

export default class ClockZ99Extension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._settings = null;
        this._island = null;
        this._bg = null;
        this._pill = null;
        this._label = null;
        this._entry = null;
        this._tickId = 0;
        this._flashId = 0;
        this._flashOn = false;
        this._remaining = 600;
        this._endUsec = 0;
        this._running = false;
        this._finished = false;
        this._editing = false;
        this._monitorsChangedId = 0;
        this._pressX = 0;
        this._pressY = 0;
        this._islandX = 0;
        this._dragging = false;
        this._lastClickTime = 0;
        this._unredirectDisabled = false;
        this._settingsChangedId = 0;
    }

    enable() {
        this._settings = this.getSettings();
        this._remaining = this._settings.get_int('default-duration');

        this._buildIsland();

        // Tracked chrome (not a raw stage child) so the island stays above
        // fullscreen windows such as presentation apps in F11.
        //
        // trackFullscreen MUST stay false: it does not mean "draw over
        // fullscreen windows". Shell's LayoutManager instead HIDES tracked
        // actors whenever a fullscreen window is on the same monitor.
        // Plain chrome already paints above fullscreen windows, which stay
        // in window_group. (Same pattern as ../zoomer/extension/modules/spotlight.js:264.)
        Main.layoutManager.addChrome(this._island, {
            affectsStruts: false,
            trackFullscreen: false,
        });
        this._raiseAbovePanel();
        this._positionIsland();

        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => {
                this._positionIsland();
                this._raiseAbovePanel();
            });

        Main.wm.addKeybinding(
            'toggle-hotkey',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => this.toggle(),
        );

        // live-apply appearance & position settings (see prefs.js)
        this._settingsChangedId = this._settings.connect(
            'changed', (settings, key) => {
                if (key === 'h-padding' || key === 'top-padding' ||
                    key === 'bottom-padding' || key === 'bottom-radius' ||
                    key === 'font-size' || key === 'top-fillet') {
                    this._applyPillStyle();
                    this._repaintBg();
                    this._positionIsland();
                } else if (key === 'x-offset' || key === 'y-offset') {
                    this._positionIsland();
                }
            });

        if (this._settings.get_boolean('visible'))
            this.show(true);
        else
            this.hide();
        console.log('[clock_z99] enabled');
    }

    disable() {
        try {
            Main.wm.removeKeybinding('toggle-hotkey');
        } catch (e) { /* not bound */ }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        this._stopTick();
        this._stopFlash();
        this._restoreUnredirect();
        this._closeEditor();

        if (this._island) {
            try {
                Main.layoutManager.removeChrome(this._island);
            } catch (e) {
                // already untracked; fall through to manual unparent
            }
            if (this._island.get_parent())
                this._island.get_parent().remove_child(this._island);
            this._island.destroy();
            this._island = null;
            this._bg = null;
            this._pill = null;
            this._label = null;
            this._entry = null;
        }
        this._settings = null;
    }

    // ---- public API (keybinding) ----
    toggle() {
        if (!this._island)
            return;
        if (this._island.visible)
            this.hide();
        else
            this.show(true); // auto-start per spec
    }

    show(autostart) {
        this._closeEditor();
        this._island.visible = true;
        this._island.opacity = 255;
        this._applyPillStyle();
        this._repaintBg();
        this._positionIsland();
        this._raiseAbovePanel();
        this._settings.set_boolean('visible', true);
        // A fullscreen window can be direct-scanned-out by Mutter: its
        // buffer is presented straight to the display, bypassing the
        // stage, so the island would sit "under" the app. Disable
        // unredirect while the island is up - exactly what Shell's own
        // OSD does. (Same pattern as zoomer spotlight.js:274.)
        if (!this._unredirectDisabled) {
            global.compositor.disable_unredirect();
            this._unredirectDisabled = true;
        }
        if (autostart) {
            if (this._finished || this._remaining <= 0)
                this._remaining = this._settings.get_int('default-duration');
            this.start();
        } else {
            this._render();
        }
    }

    hide() {
        this._closeEditor();
        this._stopTick();
        this._stopFlash();
        this._restoreUnredirect();
        if (this._island)
            this._island.visible = false;
        this._settings.set_boolean('visible', false);
    }

    _restoreUnredirect() {
        if (this._unredirectDisabled) {
            this._unredirectDisabled = false;
            try {
                global.compositor.enable_unredirect();
            } catch (e) { /* already restored */ }
        }
    }

    // The top bar lives in layoutManager.panelBox. Nothing guarantees our
    // island paints above that container, so pin it on top explicitly and
    // re-assert after show() / monitor changes (overview transitions can
    // reorder chrome). Best effort: never throw from here.
    _raiseAbovePanel() {
        if (!this._island)
            return;
        try {
            const uiGroup = Main.uiGroup;
            const panelBox = Main.layoutManager.panelBox;
            if (!this._island.get_parent())
                uiGroup.add_child(this._island);
            if (panelBox && panelBox.get_parent() === uiGroup &&
                this._island.get_parent() === uiGroup)
                uiGroup.set_child_above_sibling(this._island, panelBox);
        } catch (e) { /* stacking stays as-is */ }
    }

    start() {
        this._finished = false;
        this._stopFlash();
        if (this._remaining <= 0)
            this._remaining = this._settings.get_int('default-duration');
        this._endUsec = this._nowUsec() + this._remaining * 1_000_000;
        this._running = true;
        this._startTick();
        this._render();
    }

    pause() {
        if (!this._running)
            return;
        this._remaining = this._remainingFromClock();
        this._running = false;
        this._stopTick();
        this._render();
    }

    resume() {
        if (this._running || this._finished)
            return;
        this._endUsec = this._nowUsec() + this._remaining * 1_000_000;
        this._running = true;
        this._startTick();
        this._render();
    }

    reset() {
        this._remaining = this._settings.get_int('default-duration');
        this.start();
    }

    // ---- island UI ----
    // Single unified Cairo silhouette on St.DrawingArea (_bg) + transparent
    // content box (_pill) stacked via Clutter.BinLayout. Because the top
    // concave fillets, vertical sides, and bottom convex corners are drawn
    // in one closed Cairo path, there can never be a seam between pieces.
    _buildIsland() {
        this._island = new St.Widget({
            style_class: 'clock-z99-island',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
            can_focus: true,
            visible: false,
        });

        this._bg = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
        });
        this._bg.connect('repaint', () => this._drawTabShape());
        this._island.add_child(this._bg);

        this._pill = new St.BoxLayout({
            style_class: 'clock-z99-pill',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._island.add_child(this._pill);

        this._label = new St.Label({
            style_class: 'clock-z99-label',
            text: formatTime(this._remaining),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pill.add_child(this._label);

        this._entry = new St.Entry({
            style_class: 'clock-z99-entry',
            hint_text: 'MM:SS',
            visible: false,
            can_focus: true,
        });
        this._entry.clutter_text.set_max_length(8);
        this._pill.add_child(this._entry);

        this._applyPillStyle();

        this._island.connect('notify::width', () => {
            if (!this._dragging)
                this._positionIsland();
            this._repaintBg();
        });
        this._island.connect('notify::height', () => {
            this._repaintBg();
        });

        // click / drag / right-click / double-click
        this._island.connect('button-press-event', (a, e) => this._onPress(e));
        this._island.connect('motion-event', (a, e) => this._onMotion(e));
        this._island.connect('button-release-event', (a, e) => this._onRelease(e));
        this._island.connect('scroll-event', (a, e) => this._onScroll(e));

        this._entry.clutter_text.connect('activate', () => this._commitEditor());
        this._entry.clutter_text.connect('key-press-event', (a, e) => {
            if (e.get_key_symbol() === Clutter.KEY_Escape) {
                this._closeEditor();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    // Reserve horizontal space (F + h-padding) on each side so the label sits
    // inside the main body between the two concave top fillets, plus explicit
    // top-padding and bottom-padding around the label.
    _applyPillStyle() {
        if (!this._pill || !this._label || !this._settings)
            return;
        const F = Math.max(0, this._settings.get_int('top-fillet'));
        const h = Math.max(0, this._settings.get_int('h-padding'));
        const top = Math.max(0, this._settings.get_int('top-padding'));
        const bottom = Math.max(0, this._settings.get_int('bottom-padding'));
        const padX = F + h;
        this._pill.style = `padding: ${top}px ${padX}px ${bottom}px ${padX}px;`;
        const px = this._settings.get_int('font-size');
        this._label.style = `font-size: ${px}px;`;
    }

    _drawTabShape() {
        if (!this._bg || !this._settings)
            return;
        const cr = this._bg.get_context();
        const [W, H] = this._bg.get_surface_size();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();

        if (W > 0 && H > 0) {
            let F = Math.max(0, this._settings.get_int('top-fillet'));
            let R = Math.max(0, this._settings.get_int('bottom-radius'));
            // If F + R exceeds H, scale proportionally so the concave top arc
            // flows directly into the convex bottom arc as a smooth S-curve.
            if (F + R > H && (F + R) > 0) {
                const s = H / (F + R);
                F *= s;
                R *= s;
            }
            R = Math.min(R, Math.max(0, (W - 2 * F) / 2));

            cr.setOperator(Cairo.Operator.OVER);
            if (this._finished && this._flashOn)
                cr.setSourceRGBA(0.753, 0.110, 0.157, 1); // #c01c28
            else
                cr.setSourceRGBA(0, 0, 0, 1);

            cr.moveTo(0, 0);
            cr.lineTo(W, 0);
            if (F > 0)
                cr.arcNegative(W, F, F, -Math.PI / 2, -Math.PI);
            if (H - R > F)
                cr.lineTo(W - F, H - R);
            if (R > 0)
                cr.arc(W - F - R, H - R, R, 0, Math.PI / 2);
            cr.lineTo(F + R, H);
            if (R > 0)
                cr.arc(F + R, H - R, R, Math.PI / 2, Math.PI);
            if (H - R > F)
                cr.lineTo(F, F);
            if (F > 0)
                cr.arcNegative(0, F, F, 0, -Math.PI / 2);
            cr.closePath();
            cr.fill();
        }
        cr.$dispose();
    }

    _repaintBg() {
        if (this._bg)
            this._bg.queue_repaint();
    }

    _positionIsland() {
        if (!this._island)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const xOff = this._settings.get_int('x-offset');
        const yOff = this._settings.get_int('y-offset');
        const w = this._island.width || 140;
        const x = Math.round(monitor.x + (monitor.width - w) / 2 + xOff);
        const y = Math.round(monitor.y + yOff);
        this._island.set_position(
            Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - w)),
            y,
        );
    }

    // ---- input ----
    _onPress(event) {
        const button = event.get_button();
        if (button === 3) // right-click handled on release
            return Clutter.EVENT_STOP;
        if (button !== 1)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        this._pressX = x;
        this._pressY = y;
        this._islandX = this._island.x;
        this._dragging = false;
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        if (!event.get_state() || !(event.get_state() & Clutter.ModifierType.BUTTON1_MASK))
            return Clutter.EVENT_PROPAGATE;
        const [x] = event.get_coords();
        if (!this._dragging && Math.abs(x - this._pressX) < DRAG_THRESHOLD)
            return Clutter.EVENT_STOP;
        this._dragging = true;
        const monitor = Main.layoutManager.primaryMonitor;
        const w = this._island.width || 140;
        let nx = Math.round(this._islandX + (x - this._pressX));
        nx = Math.max(monitor.x, Math.min(nx, monitor.x + monitor.width - w));
        this._island.set_position(nx, this._island.y);
        return Clutter.EVENT_STOP;
    }

    _onRelease(event) {
        const button = event.get_button();
        if (button === 3) {
            this.reset(); // right-click: reset + autostart
            return Clutter.EVENT_STOP;
        }
        if (button !== 1)
            return Clutter.EVENT_PROPAGATE;
        if (this._dragging) {
            this._dragging = false;
            const monitor = Main.layoutManager.primaryMonitor;
            const centerX = monitor.x + monitor.width / 2;
            const islandCenter = this._island.x + (this._island.width || 140) / 2;
            this._settings.set_int('x-offset', Math.round(islandCenter - centerX));
            this._positionIsland(); // snap/clamp
            return Clutter.EVENT_STOP;
        }
        // click vs double-click
        const now = GLib.get_monotonic_time();
        const isDouble = (now - this._lastClickTime) < 350 * 1000;
        this._lastClickTime = now;
        if (isDouble) {
            this._openEditor();
        } else if (this._finished) {
            this.reset();
        } else if (this._running) {
            this.pause();
        } else {
            this.resume();
        }
        return Clutter.EVENT_STOP;
    }

    _onScroll(event) {
        const direction = event.get_scroll_direction();
        let step = 60;
        if (event.get_state() & Clutter.ModifierType.SHIFT_MASK)
            step = 10;
        if (direction === Clutter.ScrollDirection.UP)
            this._nudge(step);
        else if (direction === Clutter.ScrollDirection.DOWN)
            this._nudge(-step);
        else
            return Clutter.EVENT_PROPAGATE;
        return Clutter.EVENT_STOP;
    }

    _nudge(delta) {
        if (this._finished) {
            this._finished = false;
            this._stopFlash();
            this._remaining = Math.max(1, delta);
            this.start();
            return;
        }
        if (this._running) {
            this._remaining = Math.max(0, this._remainingFromClock() + delta);
            this._endUsec = this._nowUsec() + this._remaining * 1_000_000;
        } else {
            this._remaining = Math.max(0, this._remaining + delta);
        }
        this._render();
    }

    // ---- quick-set editor ----
    _openEditor() {
        this.pause();
        this._editing = true;
        this._label.visible = false;
        this._entry.visible = true;
        this._entry.set_text(formatTime(this._remaining));
        this._positionIsland();
        global.stage.set_key_focus(this._entry);
        this._entry.clutter_text.set_selection(0, -1);
    }

    _commitEditor() {
        const secs = parseTimeString(this._entry.get_text());
        this._closeEditor();
        if (secs !== null && secs >= 0 && secs <= 12 * 3600) {
            this._remaining = secs;
            this._settings.set_int('default-duration', secs);
        }
        this._finished = false;
        this._stopFlash();
        this._render();
        this.start();
    }

    _closeEditor() {
        if (!this._editing && !this._entry)
            return;
        this._editing = false;
        if (this._entry)
            this._entry.visible = false;
        if (this._label)
            this._label.visible = true;
        if (global.stage && this._entry && global.stage.get_key_focus() === this._entry)
            global.stage.set_key_focus(null);
    }

    // ---- timer core ----
    // "Now" in microseconds (wall clock).
    _nowUsec() {
        return GLib.get_real_time();
    }

    _remainingFromClock() {
        if (!this._running)
            return this._remaining;
        const left = (this._endUsec - this._nowUsec()) / 1_000_000;
        return Math.max(0, left);
    }

    _startTick() {
        this._stopTick();
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._onTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTick() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _onTick() {
        if (!this._running)
            return GLib.SOURCE_REMOVE;
        this._remaining = this._remainingFromClock();
        if (this._remaining <= 0) {
            this._remaining = 0;
            this._running = false;
            this._finished = true;
            this._stopTick();
            this._render();
            this._startFlash();
            return GLib.SOURCE_REMOVE;
        }
        this._render();
        return GLib.SOURCE_CONTINUE;
    }

    _render() {
        if (!this._label)
            return;
        if (!this._editing)
            this._label.text = formatTime(this._finished ? 0 : this._remaining);
        this._island.queue_relayout();
        this._repaintBg();
        if (!this._dragging)
            this._positionIsland();
    }

    _startFlash() {
        this._stopFlash();
        this._flashOn = true;
        this._repaintBg();
        this._flashId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._flashOn = !this._flashOn;
            this._repaintBg();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopFlash() {
        if (this._flashId) {
            GLib.source_remove(this._flashId);
            this._flashId = 0;
        }
        this._flashOn = false;
        this._repaintBg();
    }
}
