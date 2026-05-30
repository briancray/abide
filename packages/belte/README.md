# @briancray/belte

Isomorphic multimodal HTTP framework built for humans and machines in a single [Bun](https://bun.sh) runtime.

Declare a backend once and it answers on every surface. Humans reach it through the web
(server-rendered Svelte) and the command line; machines reach it through MCP and the command line.
The bundler swaps the runtime per target — the call site, name, and behaviour stay identical.

> **Requires Bun ≥ 1.3.** Modules are shipped as TypeScript and consumed directly by Bun.

## Install

```sh
bun add @briancray/belte
```

`svelte` is a peer dependency; `tailwindcss` and `bun-plugin-tailwind` are optional peers.

## At a glance

Declare a remote function once:

```ts
// src/server/rpc/getOrder.ts
import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'

export const getOrder = GET<{ id: string }>(async ({ id }) => json(await db.getOrder(id)))
```

Consume the same `getOrder` from each client:

| Surface | How it is exposed | Call |
| --- | --- | --- |
| Browser / HTTP | function + `GET /rpc/getOrder?id=…` | `await getOrder({ id })` |
| MCP | tool `getOrder` (with a schema) | `tools/call { name: "getOrder", arguments: { id } }` |
| CLI | subcommand `getOrder` (with a schema) | `app getOrder --id 7` |

Browser exposure is always on; MCP and CLI flip on automatically when a declaration carries a
validation schema.

## Documentation

Full docs, the API reference, and runnable examples live in the
[repository README](https://github.com/briancray/belte#readme).

## License

[MIT](./LICENSE) © Brian Cray
