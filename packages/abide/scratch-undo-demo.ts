import { doc } from './src/lib/ui/doc.ts'
import { history } from './src/lib/ui/history.ts'

/* A throwaway demo of the patch bus + history(). Run: bun run scratch-undo-demo.ts */

const board = doc({ title: 'untitled', items: [] as { text: string; done: boolean }[] })
const past = history(board)

const show = (label: string): void =>
    console.log(label.padEnd(30), JSON.stringify(board.snapshot()))

show('initial')
board.replace('title', 'Groceries')
show('rename title')
board.add('items/-', { text: 'milk', done: false })
show('add milk')
board.add('items/-', { text: 'eggs', done: false })
show('add eggs')
board.replace('items/0/done', true)
show('check milk (deep field)')

console.log('\n-- undo x4 (every edit reverses, deepest first) --')
past.undo()
show('undo')
past.undo()
show('undo')
past.undo()
show('undo')
past.undo()
show('undo')
console.log('canUndo:', past.canUndo(), ' canRedo:', past.canRedo())

console.log('\n-- redo x2 --')
past.redo()
show('redo')
past.redo()
show('redo')

console.log('\n-- transaction: title change + add item = ONE undo step --')
past.transaction(() => {
    board.replace('title', 'Party')
    board.add('items/-', { text: 'cups', done: false })
})
show('after transaction')
past.undo()
show('one undo reverts BOTH')
