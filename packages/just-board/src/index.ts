import { createBoardClient, type ClientOptions } from './client/client.ts'

/**
 * A just-board client. Outside Node there is no detection: pass the board's
 * `url` and a `token` whose audience is that URL.
 */
export const createClient = (options: ClientOptions) => createBoardClient(options)

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
