import { GET, POST } from 'abide/server'
import { identityStructuralDatabase } from '#server/identityStructuralDatabase'

export const getSales = GET(() => identityStructuralDatabase.sales.read(), {
    description: 'Sales by region.',
})

export const recordSale = POST(
    () => identityStructuralDatabase.sales.record('north'),
    { description: 'Records a sale in the north.' },
)
