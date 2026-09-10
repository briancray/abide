---
title: Catch mistakes before you ship
nav: Checks
intent: Type-check the templates as well as the TypeScript, in CI and in your editor.
covers:
  - `abide check [dir…]`
  - `abide lsp`
---

`tsc` does not read a `.abide` file. `abide check` does, and it reports **on the `.abide` line**
rather than on a line of generated code nobody wrote.

```
abide check
abide check src/ui src/shared
```

## The errors it finds that `tsc` cannot

Every one of these is detectable in syntax, which is why the ergonomic spelling does not have
to be given up to make the strict one safe:

| | |
| --- | --- |
| assigning a `Reactive` to a name that holds one | names both repairs |
| a read spelled `foo()` with an argument | `foo` is not a function you call |
| `props()` from a `<script module>` block | there is no instance to read props of |
| a prop passed to a component that never calls `props()` | it accepts none |
| a `Failed` built and discarded | the refusal did not happen |
| a memo handed to two handlers | names both |
| a nested object argument on a `GET` or `DELETE` | names the method, and says a `POST` is the fix |
| two files mounting at one address | names both files |

The last three are build errors rather than type errors, and they are here for the same reason:
each is a mistake that otherwise fails at the first request, or worse, quietly succeeds.

Read on: [`.abide` files](../reference/abide-files.md) ·
[Failures](../server/refuse-a-request-and-say-why.md)

## The line number is the point

A framework that compiles templates to code and hands the errors to `tsc` reports on the code
it generated. That is a position in a file you did not write, about a construct you did not
spell, and mapping it back is a job the reader does every time.

`abide check` reports where you typed it. That is the whole of the feature and it is worth a
command of its own.

## `abide lsp` is the same check, in the editor

```
abide lsp
```

The `.abide` language server, over stdio. It is the same analysis `abide check` runs, so the
squiggle in your editor and the failure in CI are the same finding rather than two
implementations that agree most of the time.

Read on: [CLI](../reference/cli.md)

## In CI

```
abide check && abide build && bun test
```

`check` first, because a type error is the cheapest failure to report and the fastest to get.
`build` next, because it catches the mount collisions and the memo-shared-between-handlers
errors that only a whole route table can see.

Read on: [Build & start](build-and-serve-the-app.md)

## Next

* [Build & start](build-and-serve-the-app.md) — the errors a build finds
* [`.abide` files](../reference/abide-files.md) — the grammar being checked
* [CLI](../reference/cli.md) — every command and flag
