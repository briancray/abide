/**
 * The channel a desktop app's window opens to the page for its menu, or `undefined` in a browser.
 *
 * ITS OWN MODULE, so `onMenu` asks without importing the reporter: `reportMenu` is a chunk only a
 * page inside a desktop app loads. 38.88.
 */
export function menuBridge():
    | { postMessage(message: string): void }
    | undefined {
    return (
        globalThis as {
            webkit?: {
                messageHandlers?: {
                    abideMenu?: { postMessage(message: string): void }
                }
            }
        }
    ).webkit?.messageHandlers?.abideMenu
}
