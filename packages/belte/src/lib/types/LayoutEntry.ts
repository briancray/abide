import type { LayoutDataModule } from './LayoutDataModule.ts'
import type { LayoutViewModule } from './LayoutViewModule.ts'

export type LayoutEntry = {
    view?: () => Promise<LayoutViewModule>
    resolve?: () => Promise<LayoutDataModule>
}
