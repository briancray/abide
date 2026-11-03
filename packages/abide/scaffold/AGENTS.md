# Working on this app

This is an abide app. Before writing code, read `node_modules/@abide/abide/AGENTS.md`: how an abide
app is laid out, checked and tested, and where the documentation that installs with it lives. It
ships with abide and updates with it.

This file is the app's own, and holds its instructions only — commands, conventions, where things
live. Keep it short. What the product does and how a feature behaves goes in `docs/`.

## This app

- `src/getGreeting.handler.ts` and its test are the pattern for a handler and the test that calls
  it; `src/index.test.ts` is the pattern for a page test that counts the work a click did.
