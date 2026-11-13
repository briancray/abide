// The CRM's tests as rows, one line per file as it finishes: `bun scripts/testRows.ts --list`.
import { testRows } from '@abide/harness/runner'

await testRows(
    [{ section: 'tests', root: 'src', runner: 'bun' }],
    Bun.fileURLToPath(new URL('..', import.meta.url)),
)
