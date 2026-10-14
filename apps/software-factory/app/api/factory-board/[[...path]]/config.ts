import { createHash } from "node:crypto";
import { z } from "zod";
import { vercel } from "vboard";

const sourcesSchema = z.array(z.strictObject({
  projectId: z.string().regex(/^prj_[A-Za-z0-9]+$/),
  teamId: z.string().regex(/^team_[A-Za-z0-9]+$/),
  environments: z.array(z.enum(["production", "preview", "development"]))
    .min(1).max(3).default(["production"]),
})).max(50);

/** Explicit project/team grants for this board; missing configuration trusts no external project. */
export function factoryBoardTrustedSources(value: string | undefined) {
  if (value === undefined || value.trim() === "") return [];
  const result = sourcesSchema.safeParse(JSON.parse(value));
  if (!result.success) throw new Error("Invalid FACTORY_BOARD_TRUSTED_SOURCES: expected projectId, teamId and optional environments");
  return result.data.map(({ projectId, teamId, environments }) =>
    vercel({ project: projectId, team: teamId, environments, can: ["post"] }),
  );
}

/** Separate the collaboration log from the software factory and each preview branch. */
export function factoryBoardStorePrefix(environment: string, branch?: string) {
  if (!["production", "preview", "development"].includes(environment))
    throw new Error("Invalid VERCEL_ENV for the Factory board");
  if (environment === "preview" && !branch)
    throw new Error("Factory board previews require VERCEL_GIT_COMMIT_REF");
  const suffix = environment === "preview"
    ? `:${createHash("sha256").update(branch!).digest("hex").slice(0, 16)}`
    : "";
  return `agent-factory-board-1:${environment}${suffix}`;
}
