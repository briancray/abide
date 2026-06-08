import type { BundleWindow } from '@belte/belte/bundle/BundleWindow'
import { z } from 'zod'

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

`config` declares the env the embedded server needs as a Standard Schema (zod
here). Its JSON Schema drives the connect screen's setup modal: each key becomes
one env var the server reads via `Bun.env`, `.meta({ title })` is the field
label, `.describe()`/`.meta({ description })` the hint, `format: 'password'`
masks the input, and `.default()` pre-fills it. The required HOST_ROOT (no
default) is what makes the modal appear on first Start; the rest are optional.
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
    config: z.object({
        // Required, no default → forces the setup modal on first Start.
        HOST_ROOT: z.string().meta({
            title: 'Content folder',
            description: 'Absolute path the server reads content from',
        }),
        // Optional, masked input.
        API_KEY: z.string().optional().meta({
            title: 'API key',
            format: 'password',
            description: 'Leave blank to run without auth',
        }),
        // Optional with a default → pre-filled in the form, no asterisk.
        WELCOME_MESSAGE: z
            .string()
            .default('Hello from the kitchen sink')
            .optional()
            .meta({ title: 'Welcome message' }),
    }),
} satisfies BundleWindow
