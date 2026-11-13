import { principal } from '@abide/abide'
import { POST } from '@abide/abide/server'

export default POST(() => principal.clear(), { description: 'Signs out.' })
