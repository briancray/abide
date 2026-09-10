---
title: Serve the app under a sub-path
nav: Sub-path mounting
intent: Run the whole app under /docs without rewriting a link or rebuilding the bundle.
covers:
  - `APP_URL`
  - `/__abide/**`
---

Set `APP_URL` to `https://example.com/docs` and every page, endpoint and asset serves under
`/docs`. Nothing is rebuilt, because nothing in the build ever held an absolute address.

## The mount is read, never baked

| Where | Resolved against |
| --- | --- |
| a browser | `<meta name="abide-mount">` in the document |
| a server | `config().APP_URL` |

A build artifact holds **mount-relative** addresses, and the absolute form is produced at read
time. That is the whole of why the same bundle deploys at the root and under a sub-path: the
choice is made after the build, which is when a deployment actually knows it.

`rpc.url`, `url` and every asset reference go through that resolution. An address you assemble
yourself does not, which is the reason to reach for those rather than build the string.

Read on: [Handler URLs](../server/find-the-url-a-handler-answers-on.md) ·
[Links & navigation](link-to-another-page.md)

## `/__abide/**` is every endpoint abide controls

Everything the framework serves is under one prefix — the rpc addresses, the socket mux, the
health check, the principal endpoint, the OpenAPI document and the MCP endpoint. One prefix,
and it moves with the mount like everything else.

That is a routing fact worth knowing for two reasons. A reverse proxy in front of the app has
exactly one path family to forward, and an app route of your own cannot collide with a
framework one by accident.

Read on: [Health](../app/tell-a-load-balancer-you-are-healthy.md) ·
[OpenAPI](../machines/describe-your-api-without-writing-a-spec.md)

## What a sub-path does not change

Nothing about a handler, a page or a component. There is no base-path option to thread through
a component, no `<base>` tag to remember, and no build flag — an app that has never thought
about mounting is already an app that mounts.

Read on: [Config](../app/configure-the-app.md)

## Next

* [Config](../app/configure-the-app.md) — where `APP_URL` is read from
* [Handler URLs](../server/find-the-url-a-handler-answers-on.md) — the addresses that resolve against it
* [Build & start](../ship/build-and-serve-the-app.md) — the artifact this leaves alone
