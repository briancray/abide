import { POST, reachable, refuse } from '@abide/abide/server'
import { reachableHostBilling } from '#server/reachableHostBilling'

export const syncInvoice = POST(
    async ({ id }: { id: string }) => {
        const billing = reachableHostBilling()
        const asked = performance.now()
        if (!(await reachable(billing))) {
            const waited = Math.round(performance.now() - asked)
            return refuse(
                503,
                `Billing is unreachable — refused in ${waited} ms.`,
            )
        }
        return fetch(`${billing}/invoices/${id}`, { method: 'POST' })
    },
    { description: 'Sends an invoice to billing, where billing is reachable.' },
)
