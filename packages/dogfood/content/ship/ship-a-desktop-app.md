---
title: Ship a desktop app
nav: Desktop
intent: The app in a window of its own, started here or connected to one running elsewhere.
covers:
  - `abide bundle [--out]`
  - `menu`
  - `MenuItem`
  - `MenuRole`
  - `menuItem`
  - `MenuEntry`
  - `MenuEntry.on`
  - `src/bundle/icon.png` · `src/bundle/icon.icns`
  - `src/bundle/launch.abide`
  - `src/bundle/launch.html`
  - `src/bundle/launcher.json`
  - `Launch`
  - `ConfigField`
---

```
abide bundle                    # ./ledger.app
abide bundle --out ~/Applications/Ledger.app
```

The same executable `abide compile` writes, inside a macOS `.app`. Opened, it shows the app in a
window of its own. Every command still answers from a terminal:
`ledger.app/Contents/MacOS/ledger start` serves it as the compiled executable does.

The icon is `src/bundle/icon.png`, a square image at 1024 pixels, drawn at every size the Dock and
Finder ask for. An `icon.icns` beside it is used as it is instead.

Read on: [Compile](ship-a-single-binary.md)

## The first launch asks where the app is

The window opens on a page with two forms. **Start** runs the app in this process, served on
loopback for the window alone. **Connect** opens one already running at a URL, the same app
deployed somewhere a team shares.

The start form asks for each field your `onConfig` schema declares. Its title is the label, its
`description` is the hint, and its type picks the input: a checkbox for a boolean, a number for a
number, a menu for an `enum`. A schema with no JSON Schema to read gets one field per default
`onConfig` returns instead. What you type is the environment the app boots under, so it is coerced
and checked exactly as a deployment's variables are, and a value the schema refuses comes back
under its field.

Read on: [Config](../app/configure-the-app.md)

## The next launch does what the last one did

The launch remembers the choice in `APP_DATA_DIR`. If you started the app with these values, the
next launch starts it with them without asking. If you connected, it connects to the same URL. The
local app gets the same port each time where that port is free, so cookies and storage survive a
restart.

**Disconnect** in the File menu stops the app served here and goes back to the forms, and the next
launch opens there too. **Connect…** opens the forms without stopping anything until you choose.

## `launcher.json` sets the window and the forms

```json server
{ "name": "Ledger", "width": 960, "height": 640, "connect": false }
```

`src/bundle/launcher.json` is read when you bundle, and a key it does not know fails the bundle
rather than the launch. `name` is what the Dock, the menu bar and the launch page call the app.
`width` and `height` are the first window's size, and `minWidth` and `minHeight` its floor. After
the first launch, the window opens where it was last left.

`start` and `connect` turn a form off. An app that only ever talks to its server turns `start`
off. An app that only runs locally turns `connect` off, and Connect… leaves the File menu with it.
Turning both off fails the bundle, because the launcher would have nothing to offer.

## `launch.abide` is the launch page, in your own markup

```abide abide
<script>
import { props } from '@abide/abide'
import type { Launch } from '@abide/abide/server'

const { name, start, fields, failure } = props<Launch>()
</script>

<h1>Welcome to {name}</h1>
{#if failure}<p>{failure.message}</p>{/if}
{#if start}
    <form method="post" action={start}>
        {#for field of fields by field.name}
            <label>
                {field.label}
                <input name={field.name} value={field.value}>
            </label>
        {/for}
        <button>Open {name}</button>
    </form>
{/if}
```

`src/bundle/launch.abide` replaces the built-in page and receives the same `Launch` the built-in
page is drawn from. `start` and `connect` are the addresses the two forms post to, and each is
`undefined` where `launcher.json` turned that form off. `fields` is one `ConfigField` per input
the start form asks for, prefilled. `failure` is what the last attempt was refused with.

It is rendered by `render` before the app it belongs to is running, so it is a document rather
than a live page: its forms post and its `<style>` applies, but an `onclick` does nothing.
`src/bundle/launch.html` is the document it renders into, where you want one. A launch page that
fails to render reaches `onError`, and the built-in page shows in its place.

Read on: [Manual rendering](../pages/render-a-document-yourself.md)

## A page adds to the menu bar by exporting `menu`

```abide abide
<script module>
import { menuItem } from '@abide/abide'

export const exportInvoices = menuItem({ label: 'Export…', key: 'cmd+e' })
export const menu = [
    { label: 'File', items: ['separator', exportInvoices] },
    {
        label: 'Invoices',
        items: [{ label: 'Overdue', href: '/invoices/overdue' }],
    },
]
</script>

<script>
import { watch } from '@abide/abide'

watch(() => exportInvoices.on(() => download()))
</script>
```

The menu bar is the route's. Every desktop app has the app's own menu, File, Edit, View and
Window, and each layout around the page and then the page itself adds what its
`<script module>` exports as `menu`. A layout's menus are there on every page under it, and a
page's are there only while it is showing. Navigate away and they go.

A menu with the same `label` as one already there adds its items to the end of it, so Export…
lands in File. Any other menu stands before Window, where macOS puts an app's own.

| An item | When picked |
| --- | --- |
| made by `menuItem` | runs every function its `on` filed, in the page that exported it |
| with an `href` | navigates there, as a link in the page would |
| with a `role` | does what the platform does: `copy` copies, `quit` stops the app and quits |
| with `items` | is a menu of its own |

`'separator'` is a line between two items, and `key` is the shortcut, modifiers first.

`on` hands back what stops it, which is what `watch` takes, so the answer goes when the page
does. The page answers whether the app is served here or connected to: a remote app's pages
bring their own menus. Outside a desktop app nothing picks an item, and the same page runs in a
browser unchanged.

Read on: [Layouts](../pages/give-pages-the-same-chrome.md)

## Next

* [Compile](ship-a-single-binary.md) — the executable inside the bundle
* [Config](../app/configure-the-app.md) — the schema the start form reads
* [CLI](../reference/cli.md) — every command and flag
