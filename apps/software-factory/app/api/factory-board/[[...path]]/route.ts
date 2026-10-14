import { board, fsBlob } from "vboard";
import { redisHttp } from "experimental-a2/store-redis-http";
import { sqlite } from "experimental-a2/store-sqlite";
import { factoryBoardStorePrefix, factoryBoardTrustedSources } from "./config";

export const maxDuration = 300;

const env = process.env.VERCEL_ENV;

// This board has no Pi watchers, external sync or background scheduler.
export const { GET, POST } = board({
  basePath: "/api/factory-board",
  trustedSources: factoryBoardTrustedSources(process.env.FACTORY_BOARD_TRUSTED_SOURCES),
  store: env
    ? redisHttp({
        url: process.env.KV_REST_API_URL!,
        token: process.env.KV_REST_API_TOKEN!,
        keyPrefix: factoryBoardStorePrefix(env, process.env.VERCEL_GIT_COMMIT_REF),
      })
    : sqlite({ path: ".a2/factory-board/dev.db" }),
  ...(env ? {} : { blob: fsBlob(".a2/factory-board/attachments") }),
});
