/**
 * The channel a native app's window opens to the page under `name`, or `undefined` in a browser and
 * on a server: `abideMenu` for its menu (38.88), `abideUpdate` for its updates (38.148).
 *
 * ITS OWN MODULE, so `onMenu` asks without importing the reporter: `reportMenu` is a chunk only a
 * page inside a native app loads.
 */
export function windowHandler(
    name: 'abideMenu' | 'abideUpdate',
): { postMessage(message: string): void } | undefined {
    return (
        globalThis as {
            webkit?:
                | {
                      messageHandlers?:
                          | Record<
                                string,
                                | { postMessage(message: string): void }
                                | undefined
                            >
                          | undefined
                  }
                | undefined
        }
    ).webkit?.messageHandlers?.[name]
}
