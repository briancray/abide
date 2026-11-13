---
'@abide/abide': minor
---

The desktop launcher moves from `src/launcher.abide` to `src/native/launcher.abide`. The root's `native` directory is now a fence (RULEBOOK 23.33). A `native` directory deeper in the app is still an ordinary route directory. A root `launcher.abide` that still calls `onLauncher` fails the build and names where it goes (RULEBOOK 38.107).

`onLauncher` takes new options for the desktop app's window:

- `maxWidth` and `maxHeight` cap the window's size (RULEBOOK 38.150, 38.151).
- `titlebar: 'hidden' | 'inset'` draws the page under the window's controls, which stay where macOS puts them. The page reads `--abide-titlebar-height` and `--abide-titlebar-inset` to keep clear of them, and is dragged by any element marked `data-abide-titlebar` (RULEBOOK 38.152, 38.153, 38.155).
- `vibrancy` draws a macOS material behind the page (RULEBOOK 38.154).
- `appearance`, `resizable`, `fullScreen`, `alwaysOnTop`, `shadow`, `rememberFrame`, `inspector` and `dock` each set one thing about the window (RULEBOOK 38.157-38.163, 38.165).

The window now takes its background from the page's own background, and opens on the last one at the next launch, so it no longer flashes a default color (RULEBOOK 38.156).

`menuBarExtra: true` puts the app in the macOS menu bar, drawn from `/icon-menubar.png` as a template image, else from `/icon.png` (RULEBOOK 38.166). A click opens `src/native/menubar.abide` in a panel under the icon, `panelWidth` by `panelHeight`. That page is answered at `/__abide/menubar`, outside every layout (RULEBOOK 38.167, 38.168, 38.171). Without that page, or with no app running, a click shows and hides the window (RULEBOOK 38.169). A right click lists the page's `onMenu` menus and Quit (RULEBOOK 38.170). Closing the window keeps the app running in the menu bar (RULEBOOK 38.172).
