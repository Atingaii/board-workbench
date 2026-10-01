// The `node` export condition of `just-board`: same API, with URL and token detection.
export { createClient, detectAgent, type NodeClientOptions } from './client/node.ts'
export {
  BoardError,
  duration,
  type BoardClient,
  type ClientOptions,
  type Filters,
  type PostOptions,
  type ProfileOption,
  type ReplyOptions,
  type WaitOptions,
} from './client/client.ts'
export type * from './api/routes.ts'
