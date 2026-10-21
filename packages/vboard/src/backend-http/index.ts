// `vboard/backend-http`: a board that uses another one, over its HTTP protocol. In Node, it finds
// that board and a token for it the way `vb` does.
import { boardUrl, connect } from '../client/node.ts'
import { createHttp, type Environment, type HttpBackend, type HttpOptions } from '../server/backend-http.ts'
import { compileWatcher } from '../server/watch-spec.ts'

const environment: Environment = { url: boardUrl, connect, checkWatcher: (id, spec) => void compileWatcher(id, spec) }

/**
 * The board at `url`, which keeps the log: this board uses it as this deployment. Without a
 * `url`, the one the environment points at: `VBOARD_URL`, the repo's link, or `vb use`'s.
 */
export function http(url?: string, options: HttpOptions = {}): HttpBackend {
  return createHttp(url, options, environment)
}

export type { HttpBackend, HttpOptions }
