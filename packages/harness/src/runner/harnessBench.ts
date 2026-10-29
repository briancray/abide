#!/usr/bin/env bun
// `harness-bench [word]`: every bench under `src/` of the directory it runs in (`runBenches`), one
// block each, and exit 1 after listing every arm over its ceiling and every ceiling naming no arm.

import { runBenches } from './runBenches.ts'

const over: string[] = []
for (const bench of await runBenches(process.cwd(), process.argv[2])) {
    let times = ''
    for (const [arm, nanoseconds] of Object.entries(bench.arms))
        times += `${times === '' ? '' : ' · '}${arm} ${(nanoseconds / 1e6).toFixed(3)} ms`
    console.log(
        `${bench.file} ${bench.name}: ${bench.case}\n    ${times}\n    ${bench.claim}`,
    )
    for (const line of bench.over)
        over.push(`${bench.file} ${bench.name}: ${line}`)
}
if (over.length > 0) {
    console.error(`\nOver the ceiling:\n    ${over.join('\n    ')}`)
    process.exit(1)
}
