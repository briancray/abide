#!/usr/bin/env bun
// The `abide` executable entry — thin shell over `main`. Kept minimal so all logic (and its tests)
// live in `main.ts`. `dev`/`start` keep the process alive via Bun.serve's open handles.

import { main } from './main.ts'

await main(process.argv.slice(2))
