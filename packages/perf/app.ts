// The benchmark app: pages/ is what it serves, app.html is what it is served in, client.ts is the
// lane the browser gets. Nothing else is this app's own.

export async function onStart(start: () => Promise<void>): Promise<void> {
    await start()
}
