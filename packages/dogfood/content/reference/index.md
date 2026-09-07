---
title: Reference
nav: Overview
intent: Every name, every option, every flag — for when you already know what you want.
---

A guide answers *how do I solve this*. Reference answers *what exactly does this take, and
what does it hand back* — every name, every option, every flag, gathered by area rather than
by problem.

Arrive here knowing which thing you want. Nothing on these pages teaches why you would reach
for it; each one links back to the guide that does.

One page per primitive, each in the same order: syntax, parameters, return value, then
description and examples. A page you have read is a page you can navigate.

## What each page holds

| Page | Holds |
| --- | --- |
| [Reactive](reactive.md) | The one type every producer hands back — every read, probe, trigger and option on it |
| [`state`](state.md) | The factory for a value a scope owns, and `state.share` |
| [`memo`](memo.md) | The factory for a computed value: tracked without arguments, cached with them |
| [`channel`](channel.md) | The factory for a room, and what a publish does |
| [`watch`](watch.md) | The effect, its disposer, and what a server does with one |
| [Selections](selections.md) | `pending`, `refreshing`, `refresh` and `invalidate` over many entries |
| [Refusals](refusals.md) | `refuse.typed`, `Failed`, and the two abide declares |
| [Transports](transports.md) | `rpc`, `socket`, response helpers, and the headers abide sends |
| [Ambient values](ambient-values.md) | `request`, `route`, `cookies`, `principal`, `config`, `trace`, `health` |
| [Helpers](helpers.md) | `log`, `csp`, `url`, `navigate` |
| [`.abide` files](abide-files.md) | The template grammar, and the rules that let a reactive value be read and written by name |
| [Routing](routing.md) | File patterns, precedence, head merging, and `render` |
| [Configuration](configuration.md) | Environment variables, files, and the lifecycle hooks in `app.ts` |
| [CLI](cli.md) | Every command, every flag, every exit code |
