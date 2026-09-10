---
title: Configure the app
nav: Config
intent: Read settings that are typed, validated at start, and the same name on both sides.
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
---

An environment variable is a string or it is missing. What an app wants is a number that is
definitely a number, a URL that is definitely a URL, and to find out at **start** rather than at
the first request that reads one.

```ts #server/app.ts — excerpt
import { onConfig } from 'abide'

onConfig((env) => ({
    STRIPE_KEY: env.STRIPE_KEY,
    INVOICE_PREFIX: env.INVOICE_PREFIX ?? 'INV-',
    RETRIES: Number(env.RETRIES ?? 3),
}))
```

Everything after that is `config().RETRIES`, typed as a number.

## The precedence is derived, then the app, then the environment

| | Wins over | Because |
| --- | --- | --- |
| a **derived** value | everything | `APP_NAME`, `APP_VERSION` and `APP_DATA_DIR` are facts about this app, not choices |
| the app's `onConfig` | the environment | it is the app saying what its own defaults are |
| `Env` | nothing | it is the deployment overriding a default that exists |

Read the other way round: a deployment can override what an app defaulted, and cannot override
what abide derived. `APP_NAME`, `APP_VERSION` and `APP_DATA_DIR` are derived where the config
does not carry them — from the package, and from the platform's per-user data directory.

`NODE_ENV` is the environment name **verbatim**. Not a boolean and not a three-way enum: an app
comparing it against `'production'` is comparing against the string it was started with.

## `Env` is what was read, `Config` is what resolved

`Env` is `Record<string, string | undefined>` — the process environment, before anything was
coerced. `Config` is every field of `Env` plus what `onConfig` defaulted and the schema
normalised, and it is what `config()` hands back.

A value out of `Env` is **coerced to the type of the default it overrides**, so a default of `3`
makes `RETRIES=5` a number without anybody writing `Number()` at the read site. A value that
cannot be coerced is a start-time failure rather than a `NaN` that reaches arithmetic.

`ConfigDefaults` is **synchronous by contract**. Configuration that needs a network call is not
configuration; it is a value, and a value has a `memo`.

Read on: [Derived values](../values/derive-a-value-from-other-values.md)

## The schema is checked last, over the whole document

`config`'s `schema` gates the resolved document rather than one field, which is what lets it
express a relationship: a webhook secret required only when webhooks are on, two ports that
must differ.

```ts #server/app.ts — excerpt
onConfig(defaults, {
    schema: z.object({
        RETRIES: z.number().int().min(0).max(10),
        STRIPE_KEY: z.string().min(1),
    }),
})
```

A second `onConfig` **replaces** the first, its schema included, and warns on `abide:config`.
One app, one configuration — the warning is there because two calls is almost always two
modules each believing they own it.

Read on: [Schemas](../server/check-what-callers-send-you.md) ·
[Logging](record-what-happened.md)

## `config` is a value, and is read like any other

`config` is an unkeyed `global` memo, which is why it is `config()` rather than an object you
import: it is one entry for the process, and reading it in a template subscribes.

`config.invalidate()` re-reads the environment and re-runs `onConfig`. That is for a process
whose environment genuinely changed under it — a rotated secret, a re-issued key — and it is a
trigger rather than a poll, so nothing pays for the possibility.

`config()` **throws what `onConfig` threw**. A configuration that cannot resolve is not a
degraded app, and the throw is what stops one starting.

Read on: [Reloading](../values/decide-when-a-value-reloads.md) ·
[Configuration](../reference/configuration.md)

## The browser reads the same name

`config()` is ambient, and the same name on both sides. On a server it reads the process
environment merged over
the app's defaults; in a browser it reads what the document was served with, which is the
subset the app marked as public.

A secret is absent from that subset because of the declaration, not because of a naming
convention — so the thing stopping `STRIPE_KEY` reaching a bundle is a rule rather than a habit.

Read on: [Sub-path mounting](../pages/serve-the-app-under-a-sub-path.md)

## Next

* [Lifecycle](run-code-at-start-and-stop.md) — where `onConfig` is registered
* [Configuration](../reference/configuration.md) — every variable, file and hook
* [Schemas](../server/check-what-callers-send-you.md) — the `Schema<T>` the gate takes
