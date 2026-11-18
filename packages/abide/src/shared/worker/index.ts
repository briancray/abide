// What a worker file's emitted modules import (55.1): `WorkerModule` behind its stand-ins and the
// defaults each declares (55.14), and `serveWorker` in the thread running it. Emitted code's alone,
// and so no REGISTRY row.
export { declareDefaults } from '../reactive/parameterDefaults.ts'
export { serveWorker } from './serveWorker.ts'
export { WorkerModule } from './WorkerModule.ts'
