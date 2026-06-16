/*
Holds the AbortController for the current page's resolution stream so a
client-side navigation can cancel it — freeing the connection and stopping the
server drain — instead of letting it run to completion for a page that's gone.
Setting a new controller aborts any prior one.
*/
let current: AbortController | undefined

export function setPageStreamController(controller: AbortController): void {
    current?.abort()
    current = controller
}

export function abortPageStream(): void {
    current?.abort()
    current = undefined
}
