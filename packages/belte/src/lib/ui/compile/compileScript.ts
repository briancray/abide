import { hoistCells } from './hoistCells.ts'
import { lowerDocAccess } from './lowerDocAccess.ts'

/*
The component script pipeline: lower idiomatic data access on `docName` to the
patch/read API, then hoist its static paths to cells. Author code in →
fast, cell-based code out:

  model.note = 'x'    →  _cell0.set('x')       (+ const _cell0 = model.cell("note"))
  model.count + 1     →  _cell1.get() + 1      (+ const _cell1 = model.cell("count"))

This is what the single-file component compiler runs over a `<script>`/template
expression so a real component hits the `cell` speed the bench measured, not the
runtime path-string floor.
*/
export function compileScript(code: string, docName: string): string {
    return hoistCells(lowerDocAccess(code, docName), docName)
}
