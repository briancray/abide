import { baseResolver } from './baseResolver.ts'

// Registers the runtime's mount-base resolver. Called once per side at boot.
export const setBaseResolver = baseResolver.set
