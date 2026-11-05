# Clock Z99

A gnome-extention, always-on-top timer.

It is made for people that prefer to have fullscreen in everything (No top bar)

## How it looks
A black pill (Movable by drag) sticks at the top of the screen. (Design is customizable)
Stays visible even while switching workspace.

## Usage

| Action | Result |
|---|---|
| `Super+Q` | Show/hide island (show auto-starts) |
| Click | Pause / resume |
| Scroll | ±1 min (`Shift`+scroll: ±10 s) |
| Right-click | Reset to default + autostart |
| Double-click | Type a new time (`MM:SS`, `10` = 10 min) **and** a multi-line note |
| Drag | Move along the top (position is saved) |

At `00:00` the island flashes red and stays visible until hidden.

## Install (Ubuntu 26.04, GNOME 50)

```bash
make install
# Wayland: log out/in once so Shell picks up the new UUID, then:
gnome-extensions enable clock-z99@mehdi-bahlaoui.github.io
```

Settings live in the Extensions app: default duration + presets, distance from top, horizontal offset, font size, toggle hotkey.

## Notes

- Pure GJS, 1 Hz tick — no per-frame loop, negligible memory.
- Timing uses the wall clock (`GLib.get_real_time()`), so the countdown keeps running while the machine sleeps. Manual/NTP clock changes can shift it.
- Layering: plain tracked chrome with `trackFullscreen: false` (the `true` setting *hides* actors under fullscreen) plus `disable_unredirect()` while visible so Mutter can't scan out the fullscreen app under the island.
