// A minimal lifecycle fixture: onStart/onStop are WRAPPERS around the real boot/teardown. They
// record their invocation into process.env so a discovery-mode test can assert whether
// createTestApp ran them (default) or skipped them (`lifecycle: false`).

export async function onStart(start: () => Promise<void>): Promise<void> {
    process.env.__ABIDE_LC_START = '1'
    await start()
}

export async function onStop(stop: () => Promise<void>): Promise<void> {
    process.env.__ABIDE_LC_STOP = '1'
    await stop()
}
