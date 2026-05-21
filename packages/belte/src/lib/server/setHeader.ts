import { requireStore } from './requireStore.ts'

/*
Buffers a response header from anywhere inside the request (resolve hook,
api handler, component) so the server can merge it onto the final Response.
Last write wins.
*/
export function setHeader(name: string, value: string): void {
    requireStore('setHeader').response.headers.set(name, value)
}
