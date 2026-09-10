---
title: Configuration
nav: Configuration
intent: Environment variables, files and lifecycle hooks.
enumerates:
  - Environment variables
  - Files
  - Lifecycle hooks
---

An abide app is configured by three things: the **environment** it starts in, the **files** it
finds under `src/`, and the **hooks** `src/server/app.ts` registers. There is no config file
format, because a typed `config()` read is what an app actually wants and an environment
variable is what a deployment actually has.

## Environment variables

| Name | Type | Meaning |
| --- | --- | --- |
| `PORT` | `number` | The listen port. |
| `APP_URL` | `string \| null` | The app's public URL. |
| `NODE_ENV` | `string` | The environment name, verbatim. |
| `APP_NAME` | `string` | The app's name, and `log`'s default channel. |
| `APP_VERSION` | `string` | The version beside that name. |
| `APP_DATA_DIR` | `string` | The platform's per-user data directory. |
| `ABIDE_PRINCIPAL_SECRET` | `string \| null` | What seals the principal cookie. |
| `ABIDE_PRINCIPAL_TTL` | `number` | The principal cookie's life, in ms. |
| `ABIDE_APP_TOKEN` | `string \| null` | The bearer the remote CLI sends. |
| `ABIDE_APP_URL` | `string \| null` | Names an app somewhere else, for the remote CLI. |
| `ABIDE_RPC_TIMEOUT` | `number` | The default ms a call may go without progress. |
| `ABIDE_MAX_REQUEST_BODY_SIZE` | `number` | The default ceiling on a mutation's body. |
| `ABIDE_MAX_STREAM_BUFFER_SIZE` | `number` | The cap on a stream transcript held in memory. |
| `ABIDE_LOGS` | `boolean` | Opts in to declaring the `GET` over `log.records`. |
| `ABIDE_OPENAPI` | `boolean` | Opts in to declaring the OpenAPI address. |
| `ABIDE_MCP` | `boolean` | Opts in to declaring the MCP address. |
| `ABIDE_MAX_LOG_BUFFER_COUNT` | `number` | The `tail` of `log.records`. |
| `ABIDE_LOG_FORMAT` | `'tsv' \| 'json' \| null` | The machine log format. |
| `DEBUG` | `string \| null` | Log-channel gating. |
| `NO_COLOR` | `string \| null` | Refuses ansi anywhere. |
| `FORCE_COLOR` | `string \| null` | Asks for the readable form off a pipe. |

Every one is read through `config()`, which validates at start rather than at first use. A
variable an app declares in `onConfig` joins these; a variable nothing declares is not
reachable through `config()` at all, which is what keeps a typo from reading as `undefined`.

The `ABIDE_`-prefixed ceilings default to no ceiling. That is the honest default — abide cannot
know that your slowest report is legitimate — and the handler's own option is the real knob,
being the one that knows what the work costs.

## Files

| Path | Meaning |
| --- | --- |
| `src/**` | The app's source. |
| `src/server/**` | Server-related source. |
| `src/ui/**` | Browser-related source. |
| `src/shared/**` | Source shared by both. |
| `src/server/app.ts` | The lifecycle hooks. |
| `src/ui/app.html` | The document its pages are served in. |
| `src/ui/public/**` | The files answered as authored, at their path below that directory. |
| `src/ui/public/favicon.ico` | The file answered at `/favicon.ico`. |
| `src/ui/public/robots.txt` | The file answered at `/robots.txt`. |
| `src/ui/pages/**/page.abide` | A route. |
| `src/ui/pages/**/layout.abide` | A layout, rendering its child page through a slot. |
| `src/ui/pages/**/error.abide` | The page a refusal renders in. |
| `src/server/rpc/**/*.ts` | The rpc handlers. |
| `src/server/sockets/**/*.ts` | The socket handlers. |

The three seams are `#server`, `#ui` and `#shared`, and an import across one uses the specifier
rather than a relative path. `src/ui/pages/**` is the route tree; `src/server/rpc/**` and
`src/server/sockets/**` are the two address trees.

`page.abide`, `layout.abide`, `error.abide` and `app.ts` are **addresses rather than names** —
the framework's own conventions, where every other file in an app is named after what it
exports.

## Lifecycle hooks

| Name | Signature | Meaning |
| --- | --- | --- |
| `default` | `(request, server) => Response \| undefined \| Promise<…>`, or `{ fetch }` | The app's own route. |
| `middleware` | `(...rungs: Middleware<{ request: Request }, Response>[]) => () => void` | The per-request app lane. |
| `onStart` | `(fn: (start: () => Promise<void>) => void \| Promise<void>) => () => void` | Wraps the boot. |
| `onStop` | `(fn: (stop: () => Promise<void>) => void \| Promise<void>) => () => void` | Mirrors it for teardown. |
| `onError` | `(fn: (error: unknown) => unknown) => () => void` | Runs on an unexpected error in this scope. |
| `onConfig` | `(fn: ConfigDefaults \| null, options?: ConfigOptions) => () => void` | The app's config defaults. |
| `onHealth` | `(report: () => unknown \| Promise<unknown>) => () => void` | The app's health reporter. |
| `onPrincipal` | `(resolve: (claims: unknown) => unknown \| Promise<unknown>) => () => void` | Turns claims into the app's half of a principal. |

Each is a hook you **call** rather than an export the framework looks for, so it can be
registered from whatever module owns the thing it is about. `app.ts` is the right place for the
app-wide ones only because that file always runs at startup.

Every one hands back the way off again, so a module that is torn down can remove its own.

### Wrapping, not listening

`onStart` and `onStop` take the next step as an argument rather than being notified. That is
what lets a hook run something **around** the boot — open a pool, `await start()`, and know the
app is up — instead of racing it. A wrap that throws fails hard and the server does not come
up, which is the only useful answer to a failed migration.

## Description

### Where a value is read

`config()` is ambient, and the same name on both sides. On a server it reads the process
environment merged over
the app's declared defaults; in a browser it reads what the document was served with, which is
the subset an app marked as public. A secret is not in that subset, and that is a property of
the declaration rather than of a naming convention.

### `NODE_ENV` is verbatim

It is the environment name as given, not a boolean and not a three-way enum. An app comparing
it against `'production'` is comparing against the string it was started with.

## Examples

### Declaring the app's own config

```ts #server/app.ts — excerpt
import { onConfig } from 'abide'

onConfig({
    STRIPE_KEY: { type: 'string' },
    INVOICE_PREFIX: { type: 'string', default: 'INV-' },
})
```

### Running work around the boot

```ts #server/app.ts — excerpt
import { onStart, onStop } from 'abide'

onStart(async (start) => {
    await database.connect()
    await start()
})

onStop(async (stop) => {
    await stop()
    await database.close()
})
```

## See also

* [Config](../app/configure-the-app.md) — the guide to `config()`
* [Lifecycle](../app/run-code-at-start-and-stop.md) — the guide to these hooks
* [Sub-path mounting](../pages/serve-the-app-under-a-sub-path.md) — what `APP_URL` decides
