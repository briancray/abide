import type { StandardSchemaV1 } from '../shared/types/StandardSchemaV1.ts'
import type { BundleMenu } from './BundleMenu.ts'

/*
User-authored bundle window configuration, default-exported from an
optional `src/bundle/window.ts`. Baked into the launcher at build time
(via the `abide:bundle-window` virtual) and read directly in dev. Every
field is optional — the launcher falls back to the program name for the
title and to openWebview's defaults for size.

The standard App/Edit/Window menus (Quit, copy/paste, minimize/close) plus the
built-in File menu (Start server / Connect / Disconnect) are always installed.
`menu` adds custom top-level menus between the Edit and Window menus; their items
emit `abide:menu` events the app handles. See BundleMenuItem.
*/
// @documentation bundle
export type BundleWindow = {
    title?: string
    width?: number
    height?: number
    menu?: BundleMenu[]
    /*
    Overrides the bundle setup form's schema. By default the form is derived from
    src/server/config.ts's env schema, so one declaration drives both boot
    validation and the form — set this only when the bundle form should differ
    from the env schema (it replaces, not merges; compose with the env schema
    yourself via its `.extend(...)` if you want both).

    A Standard Schema (the same kind abide accepts for RPC/MCP). Its JSON Schema
    drives the connect screen's first-run form, shown as a modal when Start is
    clicked with a required key still unset; the user's answers persist to the
    data-dir `.env` the server loads at boot. Each property maps to one env var of
    the same name; `title` is the field label, `description` the hint,
    `format: 'password'` masks the input, and `default` pre-fills it.
    */
    config?: StandardSchemaV1
}
