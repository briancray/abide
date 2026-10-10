---
title: Configure the app
nav: Config
intent: Read settings that are typed, validated at start, and kept on the server.
covers:
  - `config`
  - config › `schema`
  - `Config`
  - `Env`
  - `config.invalidate`
  - `onConfig`
  - `ConfigDefaults`
  - `NODE_ENV`
  - `APP_NAME`
  - `APP_VERSION`
  - `APP_DATA_DIR`
  - `PORT`
examples:
  - packages/dogfood/examples/config-coerced.json
---

An environment variable is a string or it is missing. What an app wants is a number that is
definitely a number, a URL that is definitely a URL, and to find out at **start** rather than at
the first request that reads one.

## `onConfig` declares the defaults, and `Config` their types

{% example config-coerced %}

The default is a value, and the `declare module` block is its type: it merges `RETRIES` into
`Config`, and that merge makes `config().RETRIES` a `number` to the checker. Without it the field
is `unknown`, because `Config` admits whatever an app declares and knows nothing it was not told.

`RETRIES=5` arrives from `.env` as text. abide **coerces it to the type of the default it
overrides**, so the handler hands the page a number and `retries + 1` is 6. Nobody wrote `Number()`
at the read site.

## The precedence is derived, then the app, then the environment

Each layer is laid over the one before it, so the last one to name a field wins:

| | Wins over | Because |
| --- | --- | --- |
| `Env` | everything | it is the deployment overriding a default that exists |
| the app's `onConfig` | what abide derived | it is the app saying what its own defaults are |
| a **derived** value | nothing | it is the fallback for a field nobody else names |

`APP_NAME`, `APP_VERSION` and `APP_DATA_DIR` are derived where nothing carries them — from the
package, and from the platform's per-user data directory. A deployment that sets `APP_NAME` is
naming the app for that deployment, and the card above is the same rule one layer up: `.env` beat
`app.ts`.

`NODE_ENV` is the environment name **verbatim**. Not a boolean and not a three-way enum: an app
comparing it against `'production'` is comparing against the string it was started with.

## `Env` is what was read, `Config` is what resolved

`Env` is `Record<string, string | undefined>` — the process environment, before anything was
coerced. `Config` is every field of `Env` plus what `onConfig` defaulted and the schema
normalised, and it is what `config()` hands back.

A value out of `Env` is **coerced to the type of the default it overrides**: a number for a
number, `true` or `false` for a boolean. A value that will not coerce — `RETRIES=lots` — leaves the
default standing rather than handing arithmetic a `NaN`, and the schema is where a value that has
to be right is refused outright.

`ConfigDefaults` is **synchronous by contract**. Configuration that needs a network call is not
configuration; it is a value, and a value can have a body.

Read on: [Derived values](../values/derive-a-value-from-other-values.md)

## The schema is checked last, over the whole document

`config`'s `schema` gates the resolved document rather than one field, which is what lets it
express a relationship: a webhook secret required only when webhooks are on, two ports that
must differ.

```ts server
onConfig(defaults, {
    schema: z.looseObject({
        RETRIES: z.number().int().min(0).max(10),
        STRIPE_KEY: z.string().min(1),
    }),
})
```

The object is **loose** because the document is the whole configuration, the environment
included. A strict object hands back only the fields it names, and every other field — `APP_NAME`
among them — is gone from `config()` after it.

A second `onConfig` **replaces** the first, its schema included, and warns on `abide:config`.
One app, one configuration — the warning is there because two calls is almost always two
modules each believing they own it.

Read on: [Schemas](../server/check-what-callers-send-you.md) ·
[Logging](record-what-happened.md)

## `config` is a value, and is read like any other

`config` is an unkeyed `global` reactive value, which is why it is `config()` rather than an
object you import: it is one entry for the process, and reading it in a template subscribes.

`config.invalidate()` has the next read re-read the environment and re-run `onConfig`, and runs
nothing itself. That is for a process whose environment genuinely changed under it — a rotated
secret, a re-issued key — and it is a trigger rather than a poll, so nothing pays for the
possibility.

`config()` **throws what `onConfig` threw**. A configuration that cannot resolve is not a
degraded app, and the throw is what stops one starting.

Read on: [Reloading](../values/decide-when-a-value-reloads.md) ·
[Configuration](../reference/configuration.md)

## A page reads a setting through a handler

`config` is imported from `@abide/abide/server`, so it is a server name and never reaches a bundle. A
page that needs a setting asks a handler for it — `retryPolicy` in the card above — and the
handler decides which fields leave the process.

That is what keeps `STRIPE_KEY` out of a browser: no handler hands it back. The boundary is the
seam rather than a naming convention, so forgetting a prefix cannot publish a secret.

Read on: [Reading data](../server/read-data-without-writing-an-api.md)

## Next

* [Lifecycle](run-code-at-start-and-stop.md) — where `onConfig` is registered
* [Configuration](../reference/configuration.md) — every variable, file and hook
* [Schemas](../server/check-what-callers-send-you.md) — the `Schema<T>` the gate takes
