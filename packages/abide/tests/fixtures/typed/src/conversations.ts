// A MODULE A PAGE IMPORTS ITS `Reactive`s FROM (31.1): named, default and plain, so a test can ask
// which of them an importing page reads by name.
import { reactive } from '@abide/abide'

export const onboarding = reactive({ text: 'hello' })
export const plain = { text: 'plain' }
export default reactive(3)
