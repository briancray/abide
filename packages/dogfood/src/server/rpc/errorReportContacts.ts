import { GET, POST } from '@abide/abide/server'
import { errorReportDatabase } from '#server/errorReportDatabase'
import { errorReportTracker } from '#server/errorReportTracker'

export const exportContacts = POST(
    () => errorReportDatabase.contacts.export(),
    { description: 'Exports every contact.' },
)

/** What the tracker was sent, which the caller of the export never is. */
export const capturedErrors = GET(() => errorReportTracker.captured, {
    description: 'The errors the tracker was sent.',
})
