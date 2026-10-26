import { createServer, type ServerResponse } from 'node:http'
import { Redis } from 'ioredis'

/**
 * Upstash's rules for a Lua script that sets `allow-key-locking`, applied in front of a stock
 * `redis-server`, which rejects the flag: A2's own test shim (`test/helpers/upstash-scripts.ts`,
 * vercel-labs/a2#261), ported. The script locks the hash tags of its KEYS, so every key it
 * touches must share one of them; Upstash rejects any other key mid-script. A `no-writes` script
 * may not write. Upstash also refuses to RENAME a stream, in a script or not, and no script may
 * PUBLISH, since a script keeps its lock while PUBLISH waits on subscribers.
 */
const GUARD = `
local upstream = redis
local declared = {}
local function tag(key)
  local open = string.find(key, '{', 1, true)
  if open then
    local close = string.find(key, '}', open + 1, true)
    if close and close > open + 1 then return string.sub(key, open + 1, close - 1) end
  end
  return key
end
for _, key in ipairs(KEYS) do declared[tag(key)] = true end
local writes = {
  SET = true, MSET = true, DEL = true, UNLINK = true, RENAME = true,
  PEXPIRE = true, HSET = true, HDEL = true, HINCRBY = true, ZADD = true,
  ZREM = true, ZREMRANGEBYSCORE = true, XADD = true, XDEL = true,
  SADD = true, SREM = true,
}
local function check(command, ...)
  local name = string.upper(command)
  if name == 'PUBLISH' then error('scripts must not PUBLISH') end
  local args, keys = { ... }, nil
  if name == 'RENAME' and upstream.call('TYPE', args[1])['ok'] == 'stream' then
    error('ERR renaming a "stream" type key is not supported')
  end
  if NO_WRITES and writes[name] then
    error('ERR Write commands are not allowed from read-only scripts')
  end
  if name == 'MGET' or name == 'DEL' or name == 'UNLINK' then keys = args
  elseif name == 'MSET' then
    keys = {}
    for i = 1, #args, 2 do keys[#keys + 1] = args[i] end
  elseif name == 'RENAME' then keys = { args[1], args[2] }
  else keys = { args[1] } end
  for _, key in ipairs(keys) do
    if not declared[tag(key)] then
      error("ERR Dynamic keys are not allowed in Lua scripts when 'allow-key-locking' flag is set. Key was: " .. tostring(key))
    end
  end
end
local redis = setmetatable({
  call = function(command, ...) check(command, ...) return upstream.call(command, ...) end,
  pcall = function(command, ...) check(command, ...) return upstream.pcall(command, ...) end,
}, { __index = upstream })
`

/** The script stock Redis should run for `script`, or null to pass it as is. */
export function upstashScript(script: string): string | null {
  const match = /^#!lua flags=([^\n]*)\n/.exec(script)
  if (!match) return null
  const flags = match[1]!.split(',')
  if (!flags.includes('allow-key-locking')) return null
  return `local NO_WRITES = ${flags.includes('no-writes')}\n${GUARD}\n${script.slice(match[0].length)}`
}

/**
 * Upstash's REST API in front of the Redis at `redisUrl`, under its rules for scripts: what
 * `redisHttp()` speaks, commands and `/subscribe/<channel>`. `commands` records each command.
 */
export async function upstashRest(redisUrl: string) {
  const client = new Redis(redisUrl)
  const commands: string[][] = []
  const subscribers = new Set<{ response: ServerResponse; redis: Redis }>()
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/subscribe/')) {
      const channel = decodeURIComponent(request.url.slice('/subscribe/'.length))
      const subscriber = { response, redis: new Redis(redisUrl) }
      subscribers.add(subscriber)
      response.on('close', () => {
        subscribers.delete(subscriber)
        subscriber.redis.disconnect()
      })
      response.writeHead(200, { 'content-type': 'text/event-stream' }).write(': connected\r\n\r\n')
      subscriber.redis.on('message', (name: string, message: string) => response.write(`data: message,${name},${message}\r\n\r\n`))
      void subscriber.redis.subscribe(channel).then(() => response.write(`data: subscribe,${channel},1\r\n\r\n`))
      return
    }
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => (body += chunk))
    request.on('end', async () => {
      const [command, ...args] = JSON.parse(body) as [string, ...string[]]
      commands.push([command, ...args])
      const reply = await (async () => {
        if (command.toUpperCase() === 'RENAME' && (await client.call('TYPE', args[0]!)) === 'stream')
          throw new Error(`renaming a "stream" type key "${args[0]}" is not supported`)
        const guarded = command.toUpperCase() === 'EVAL' ? upstashScript(args[0]!) : null
        return client.call(command, ...(guarded === null ? args : [guarded, ...args.slice(1)]))
      })().then(
        (result) => ({ result: result ?? null }),
        (error: Error) => ({ error: error.message }),
      )
      response.writeHead('error' in reply ? 400 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(reply))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
    commands,
    async close() {
      for (const { response } of subscribers) response.destroy()
      server.closeAllConnections()
      await new Promise((done) => server.close(done))
      client.disconnect()
    },
  }
}
