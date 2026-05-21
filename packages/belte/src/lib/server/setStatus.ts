import { requireStore } from './requireStore.ts'

/*
Overrides the final Response status. Useful for surfacing a 401/403 from
within a resolve hook without throwing.
*/
export function setStatus(status: number): void {
    requireStore('setStatus').response.status = status
}
