import { GET, refuse } from '@abide/abide/server'

import { exampleDirectory } from '#src/lib/exampleDirectory.server.ts'

// A file of the CRM, by its path below the CRM's root — never a path out of it.
const CRM_FILE = /^src\/(?:[\w-]+\/)*[\w.-]+\.(?:ts|abide|css|json)$/

export default GET(
    async ({ path }: { path: string }) => {
        const crm = await exampleDirectory('crm')
        const file = crm && CRM_FILE.test(path) && Bun.file(`${crm}/${path}`)
        if (!file || !(await file.exists())) throw refuse.notFound({ path, method: 'GET' })
        return file.text()
    },
    {
        description:
            'The text of one file of the CRM every abide docs example is drawn from, by its path below the CRM, e.g. src/activity/lib/QuickLog.abide. Use it for <show code="path"/>.',
    },
)
