import type { BundleWindow } from 'belte/bundle/BundleWindow'

/*
Optional desktop-window config, default-exported from src/bundle/window.ts
and baked into the launcher by `belte bundle`. Every field is optional —
without this file the launcher falls back to the program name for the
title and to the webview's default size.

`menu` adds custom top-level menus between the standard Edit and Window
menus. A menu item carries no arguments; clicking it dispatches a
`belte:menu` CustomEvent (`detail: { name }`) into the page, so the app
computes any arguments itself and makes the rpc call. `shortcut` is the
key for the Cmd-based accelerator (e.g. `'r'` → Cmd-R).
*/
export default {
    title: 'belte kitchen-sink',
    width: 1280,
    height: 880,
    menu: [
        {
            label: 'Demo',
            items: [
                { label: 'Reload session', shortcut: 'r', emit: 'reload-session' },
                { separator: true },
                { label: 'Open MCP panel', emit: 'open-mcp' },
            ],
        },
    ],
} satisfies BundleWindow
