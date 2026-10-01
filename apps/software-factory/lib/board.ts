import 'server-only'
import { board } from 'just-board/server'
import { slack } from 'just-board/slack'
import { github } from 'just-board/github'
import { createSlackAdapter } from '@chat-adapter/slack'
import { createGitHubAdapter } from '@chat-adapter/github'
import { connectGitHubAdapter, connectSlackAdapter } from '@vercel/connect/chat'
import { redisHttp } from 'experimental-a2/store-redis-http'
import { vercelQueues } from 'experimental-a2/scheduler-vercel'

// The software factory: just-board running on its own repo and BaseHub's Slack.
// Wiring is code. Connector UIDs come from env so the app deploys before they exist.

/** Slack channel → board channel. */
const SLACK_CHANNELS = {
  '#sf-prs': 'prs',
  // #sf-firehose is private, and the app can't look up private channels by name.
  C0C5WV6FZGD: 'firehose',
}

/** GitHub repo → board channels for its PRs and its issues. */
const GITHUB_REPOS = {
  'basehub-ai/just-board': { pulls: 'prs', issues: 'firehose' },
}

const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

// Locally, with no Redis configured, A2 uses SQLite at .a2/dev.db and handlers drain inline.
export const scheduler = process.env.VERCEL ? vercelQueues({ topic: 'just-board' }) : undefined

const sync: NonNullable<Parameters<typeof board>[0]>['sync'] = {}
if (process.env.SLACK_CONNECTOR)
  sync.slack = slack({
    adapter: createSlackAdapter({ ...connectSlackAdapter(process.env.SLACK_CONNECTOR) }),
    channels: SLACK_CHANNELS,
  })
if (process.env.GITHUB_CONNECTOR)
  sync.github = github({
    adapter: createGitHubAdapter({
      ...connectGitHubAdapter(process.env.GITHUB_CONNECTOR),
      // Without it the adapter doesn't recognize its own comments and replies to itself.
      ...(process.env.GITHUB_BOT_USER_ID ? { botUserId: Number(process.env.GITHUB_BOT_USER_ID) } : {}),
    }),
    repos: GITHUB_REPOS,
  })

// One Redis serves every environment, so each gets its own keys: a preview never
// touches production's log.
const keyPrefix = process.env.VERCEL_ENV === 'production' ? 'just-board' : `just-board:${process.env.VERCEL_ENV ?? 'local'}`

export const boardApp = board({
  ...(redisUrl && redisToken ? { store: redisHttp({ url: redisUrl, token: redisToken, keyPrefix }) } : {}),
  ...(scheduler ? { scheduler } : {}),
  sync,
})
