// The hand-written arms, in one specifier because a case that needs a row usually
// needs a signal too. Nothing here imports abide — that is the lane's whole
// constraint (44.1), and `lanes.test.ts` walks resolution to hold it.
export {
    buildRows,
    makeRows,
    moveRow,
    orderOf,
    reconcile,
    removeLast,
    type Row,
    setLabel,
    setSelected,
} from './rows.ts'
export { signal } from './signal.ts'
