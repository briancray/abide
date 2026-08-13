import { mount } from 'abide/ui'
import { container, sleep } from 'abide-kit'
import Example from './demos/fixtures/verbs.abide'
const host = container()
mount(host, () => Example({}))
console.log('at mount  :', JSON.stringify(host.innerHTML))
await sleep(60)
console.log('after 60ms:', JSON.stringify(host.innerHTML))
