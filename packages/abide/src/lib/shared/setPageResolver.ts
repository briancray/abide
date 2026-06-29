import { pageResolver } from './pageResolver.ts'

// Registers the runtime's page resolver. Called once per side at boot.
export const setPageResolver = pageResolver.set
