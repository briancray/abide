---
title: Build and serve the app
nav: Build & start
intent: What a build produces and what serves it.
covers:
  - `abide build`
  - `abide start [--port <n>]`
  - `abide bundle`
  - `src/ui/public/**`
  - `src/ui/public/favicon.ico`
  - `src/ui/public/robots.txt`
  - `cache-control: public, max-age=0, must-revalidate`
  - `etag`
---

```
abide build
abide start
```

`build` compiles the client into content-hashed chunks and a manifest. `start` boots the built
app. Between them there is no deploy-time configuration step, because the artifact holds no
absolute addresses to configure.

## What a build produces

Content-hashed chunks and a manifest naming them. A chunk is addressed by its own content, so
it cannot go stale — which is why the bundle answers `cache-control: public, max-age=31536000,
immutable` and why a deploy does not have to invalidate anything.

Every address in the artifact is **mount-relative**. The absolute form is produced at read time,
against `<meta name="abide-mount">` in a browser and `config().APP_URL` on a server. That is what
lets the same build serve at the root and under `/docs`: the mount is chosen after the build,
which is when a deployment actually knows it.

Read on: [Sub-path mounting](../pages/serve-the-app-under-a-sub-path.md)

## `src/ui/public` is served as it stands

```
src/ui/public/favicon.ico  ->  /favicon.ico
src/ui/public/robots.txt   ->  /robots.txt
```

A file under `src/ui/public/**` is answered at its path below that directory, with the bytes as
authored and a `content-type` off the extension. There is no route to write and no build step over
the file. `abide build` copies the directory into the artifact and lists it in the same manifest
the chunks are in; `abide dev` answers straight off the source tree, so a replaced icon is a
refresh rather than a restart.

The path is rooted at the **mount**, like every other address. Under `/docs`,
`src/ui/public/robots.txt` is `/docs/robots.txt` — an app at a sub-path does not own the origin's
root, and the crawler asking there is asking whatever put the app there.

A public path landing on a page route's address is a build error naming both, the same way two
handlers at one address are.

Read on: [Sub-path mounting](../pages/serve-the-app-under-a-sub-path.md) ·
[Dev server](run-the-app-while-you-work.md)

## A public file revalidates where a chunk does not

| Answered | On |
| --- | --- |
| `cache-control: public, max-age=31536000, immutable` | the built bundle |
| `cache-control: public, max-age=0, must-revalidate`, with an `etag` | a file under `src/ui/public` |

The hash is the whole difference. A chunk can be kept for a year because changing it changes its
address; `/favicon.ico` keeps its address across every deploy, so a year is a stale icon in every
cache that believed it and no way to reach in.

So a warm browser asks about `/favicon.ico` and is told 304 — the `etag` is over the file's bytes,
and a matching `if-none-match` costs one round trip of headers instead of the file. Anything large
enough to want the year belongs in the bundle, where the hash is what makes the year safe.

Read on: [Response types](../server/answer-with-something-other-than-json.md)

## The errors a build finds

A build sees the whole route table, so it catches what a per-file check cannot: two files
mounting at one address, and a memo handed to two handlers. Both name the files involved rather
than picking a winner at the first request.

Read on: [Checks](catch-mistakes-before-you-ship.md) ·
[Mutations](../server/change-something-on-the-server.md)

## `abide start` boots what was built

One process serves the pages, the handlers and the sockets. `--port` overrides `PORT`, and
everything else is `config()` — validated at start, so a misconfigured deployment fails to come
up rather than failing at the first request that reads a setting.

`onStart` hooks wrap the boot, so work that must happen before the first request happens before
`await start()` and the server does not accept anything until it has.

Read on: [Lifecycle](../app/run-code-at-start-and-stop.md) ·
[Config](../app/configure-the-app.md)

## `abide bundle` is a desktop launcher

```
abide bundle
```

A launcher for the host platform, around the same built app. It is the shape for an app that
happens to be local — a tool somebody runs on their own machine, where a browser tab and a URL
to remember are the friction rather than the point.

`APP_DATA_DIR` is the platform's per-user data directory, derived rather than configured, which
is where a local app's store belongs.

Read on: [Compile](ship-a-single-binary.md) ·
[Persistence](../values/keep-a-value-outside-the-process.md)

## Next

* [Compile](ship-a-single-binary.md) — the same app as one executable
* [Lifecycle](../app/run-code-at-start-and-stop.md) — what runs around the boot
* [CLI](../reference/cli.md) — every command and flag
