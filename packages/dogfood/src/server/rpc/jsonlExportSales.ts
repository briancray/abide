import { GET, jsonl } from '@abide/abide/server'
import { jsonlExportDatabase } from '#server/jsonlExportDatabase'

export const salesForWarehouse = GET(
    async ({ day }: { day: string }) =>
        jsonl(await jsonlExportDatabase.sales.on(day)),
    { description: 'Sales for a day, as JSON lines.' },
)
