import { reactive } from '@abide/abide'

/** The deal picked in the pipeline, shared by its picker, its rows and its detail panel with no prop between them. */
export const selectedDeal = reactive.shared(() => '')
