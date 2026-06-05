import { verbRegistry } from '../server/rpc/verbRegistry.ts'

/*
Empties the process-wide verb registry. defineVerb registers on construction
and never removes, so verbs declared in one test stay discoverable by name in
the next. Call in beforeEach to isolate a suite that defines verbs inline,
keeping createTestClient's name lookup unambiguous across tests.
*/
export function clearVerbRegistry(): void {
    verbRegistry.clear()
}
