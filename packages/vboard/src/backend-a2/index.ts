// `vboard/backend-a2`: a board kept in this deployment, on A2's log.
export { a2 } from '../server/backends.ts'
export type { A2Options } from '../server/a2.ts'
export type { BoardStore } from '../store/types.ts'
export { memoryBlob, fsBlob, type BlobStore } from '../server/blob.ts'
