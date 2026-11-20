import { registryRows } from '#src/lib/registryRows.ts'

import REGISTRY from '../../../../docs/REGISTRY.md' with { type: 'text' }

/** Every REGISTRY row, read once for every server reader. */
export const REGISTRY_ROWS = registryRows(REGISTRY)
