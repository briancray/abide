---
title: Put a Claude assistant on your site
nav: Assistant
intent: A handler that pipes a conversation to Claude, with your own handlers as its tools.
covers:
  - `assistant`
  - `AssistantMessage`
  - `AssistantEvent`
  - `AssistantOptions`
  - `Provider`
  - `Toolbox`
  - `ToolDefinition`
  - `claudeApi`
  - `ClaudeApiConfig`
  - `claudeCode`
  - `ClaudeCodeConfig`
  - `claudeCode.bridgeCommand`
  - `claudeCode.bridge`
  - `BridgeStatus`
  - `/__abide/bridge`
  - `ABIDE_BRIDGE`
examples:
  - packages/dogfood/examples/assistant-tools.json
  - packages/dogfood/examples/claude-api.json
  - packages/dogfood/examples/claude-code.json
---

`assistant` streams a conversation with Claude out of a handler you write, with your own handlers as
its tools. A provider runs it: `claudeApi` on your API key, or `claudeCode` on the Claude Code of the
person asking, running on their own machine. Either way the page receives the same events.

## `assistant`: the call and its providers

```ts server
yield* assistant(messages, provider, { mcp, maxTurns })
```

| Argument | What it is |
| --- | --- |
| `messages` | the transcript, an array of `AssistantMessage` — `{ role, content }` — ending on the user's turn |
| `provider` | `claudeApi(config)` or `claudeCode(config)`, each configured the way its own product documents |
| `mcp` | `true` to offer your MCP tools |
| `maxTurns` | the most model turns one call runs, 10 by default |

A `Provider` is one method, `run`, handed the transcript and a `Toolbox` of your tools. Write one
for another model and `assistant` treats it the same.

## A handler you write

`assistant` has no address of its own. You yield it from a streaming handler, so the address, the
middleware and the surfaces are yours to set, as they are for any other handler.

```ts #server/rpc/support.ts — excerpt
import {
    assistant,
    type AssistantMessage,
    claudeApi,
    config,
    POST,
} from '@abide/abide/server'
import { onlyStaff } from '#server/onlyStaff'

export const ask = POST(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        yield* assistant(
            messages,
            claudeApi({
                apiKey: config().ANTHROPIC_API_KEY,
                model: 'claude-opus-5',
                max_tokens: 16000,
                system: 'Answer questions about invoices.',
            }),
            { mcp: true },
        )
    },
    { middleware: [onlyStaff], clients: { mcp: false } },
)
```

`clients: { mcp: false }` keeps the assistant out of its own tool list. The page reads `ask` like
any stream: each event arrives as a production of the value it hands back.

Read on: [Streaming data](../server/send-data-as-it-arrives.md) ·
[Authorization](../server/decide-who-may-call-what.md)

## One event stream from every provider

| `type` | Carries |
| --- | --- |
| `text` | `text`, the next piece of the reply |
| `tool` | `id`, `name` and `input` of a tool the model called |
| `result` | `id`, the `text` the tool answered, and whether it `failed` |
| `done` | `stop` — `end_turn`, `max_tokens`, `max_turns`, `refusal` — and `usage` in tokens |

Changing the provider changes nothing downstream of the handler. A page written against the API
renders a visitor's Claude Code unchanged.

## The tools are your MCP surface

{% example assistant-tools %}

*1 option, 0 tool definitions* — against the arm's tool table, which spells each tool's name,
description and input schema a second time and dispatches the call by name.

`mcp: true` offers the model the tools `/__abide/mcp` lists, so which handlers it may call is
decided where it already is — `clients: { mcp: false }` withholds one from the assistant as it does
from every other model. `ABIDE_MCP` has to be open; asking for tools over a closed surface throws
and says so.

Every tool call is a request through your middleware carrying the asking request's `cookie` and
`authorization` headers. A tool does what the person asking could do, and a rung that refuses them
refuses the model on their behalf.

Read on: [MCP](let-a-model-call-your-handlers.md) ·
[Withholding a surface](keep-a-handler-off-a-surface.md)

## The transcript travels with every call

`assistant` keeps nothing between calls. The page holds the conversation and sends all of it each
time, so a reload, a second tab or a second server answers the next turn the same way.

The cost is the resend: every call carries the whole transcript, and the API bills its input
tokens again. Claude Code takes it as one message, the earlier turns folded above the last.

## `claudeApi` takes the Messages API's own fields

{% example claude-api %}

`claudeApi` takes a Messages API request body as Anthropic documents it, snake_case, with the
client's `apiKey` and `baseURL` beside it. abide writes `messages` and `stream`; every other field
goes on the body as you wrote it, and the `tools` you list — a server tool like web search — are
sent beside your own.

`baseURL` is the client's own option, and pointing it at a stand-in is how the card above shows the
request without a key. Point it nowhere and the request goes to `https://api.anthropic.com`.

It reads no key from the environment. Pass `apiKey` from wherever your app keeps secrets.

Read on: [Config](../app/configure-the-app.md)

## `claudeCode` runs on the visitor's own Claude Code

{% example claude-code %}

`claudeCode` sends the conversation to Claude Code on the machine of the person asking, on their
own sign-in and their own plan. Its config is Claude Code's own option names — `model`,
`fallbackModel`, `systemPrompt`, `appendSystemPrompt`, `effort` — and only those: its tools, its
permissions and its directory are not the site's to set.

The visitor connects their Claude Code once per visit by running a command in a terminal. It dials
out to your site — a page cannot reach a program on its own machine from https — and Claude Code
runs there with its own tools off, no settings read, and no MCP server but yours.

`ABIDE_BRIDGE` opens the relay at `/__abide/bridge`, and until it does `claudeCode` throws.

## `claudeCode.bridge`: showing the command until it connects

`claudeCode.bridge()` streams this browser's pairing: unpaired with the command to run, then paired
the moment the visitor's bridge connects.

{% snippet claude-code src/server/rpc/claudeCodeSupport.ts export const bridge %}

The card above reads it as `pairing`, which holds every status the stream has sent, and the last
is the one that stands.

The command reads `bunx @abide/bridge@<version> <your site> <code>`. The code pairs once, with this
browser, and expires unused after ten minutes; `claudeCode.bridgeCommand()` mints one on its own
where a page wants the line alone. Asking with nothing paired refuses 409.

The bridge ends itself 30 seconds after the last page watching it closes. The pairing lives in the
server process it dialled, so an app spread over several needs a visitor's requests to reach that
one.

## Next

* [MCP](let-a-model-call-your-handlers.md) — the tools the assistant is offered
* [Streaming data](../server/send-data-as-it-arrives.md) — reading the events on the page
* [Authorization](../server/decide-who-may-call-what.md) — deciding who may ask
