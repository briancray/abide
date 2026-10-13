import { GET } from '@abide/abide/server'
import { harnessCatalog } from './server/harnessRows.ts'
import { localOnly } from './server/localOnly.ts'

export default GET(() => harnessCatalog('benchRows.ts'), localOnly())
