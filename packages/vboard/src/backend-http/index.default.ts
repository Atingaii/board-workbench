// `vboard/backend-http` outside Node: the board at `url`, with the `token` you give it.
import { createHttp, type HttpBackend, type HttpOptions } from '../server/backend-http.ts'

/** The board at `url`, which keeps the log. Outside Node there's no environment, so pass a `token`. */
export function http(url?: string, options: HttpOptions = {}): HttpBackend {
  return createHttp(url, options, null)
}

export type { HttpBackend, HttpOptions }
