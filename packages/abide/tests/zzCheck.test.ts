import { test } from 'bun:test'
import { checkApp } from '#compiler/checkApp.ts'
import { appFixture } from './builtApp.ts'
const CARD = `<script>
import { props } from 'abide'
const { title } = props<{ title: string }>()
</script>
<h2>{title}</h2>`
test('x', async () => {
  const app = appFixture({
    'package.json': JSON.stringify({ name: 'c', type: 'module', imports: { '#ui/*': './ui/*' } }),
    'ui/components/Card.abide': CARD,
    'ui/pages/d/page.abide': `<script>
import { reactive } from 'abide'
import Card from '#ui/components/Card.abide'
let Shown = reactive(() => Card)
</script>
<Shown title="x"/>`,
  })
  for (const d of await checkApp(app)) console.log(d.path.split('/pages/')[1], d.line, d.column, d.code, d.message)
}, 60000)
