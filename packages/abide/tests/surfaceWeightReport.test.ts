import { expect, test } from 'bun:test'

/* Runs the real inventory script and asserts the weight/band annotations land on
   the two slugs whose banding the design pins down. */
test('readmeSurfaces emits weight + band per slug', async () => {
    const proc = Bun.spawn(['bun', 'run', 'scripts/readmeSurfaces.ts'], {
        cwd: new URL('../', import.meta.url).pathname,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited

    expect(proc.exitCode).toBe(0)
    // templating owns the whole grammar → heavy, split into its three seams
    expect(out).toMatch(/templating:.*weight \d+ HEAVY → section: control-flow, bindings, snippets/)
    // reactive-state: 3 exports (`state`/`watch`/`props`) + the 6-member `ReactivePrimitive`
    // recognizer vocabulary (primitives bucket) = 9 → heavy, own section
    expect(out).toMatch(/reactive-state:.*weight 9 HEAVY → section: primitives/)
})
