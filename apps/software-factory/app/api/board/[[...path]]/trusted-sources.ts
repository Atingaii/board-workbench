import { z } from "zod";
import { vercel } from "vboard";

const sourcesSchema = z.array(z.strictObject({
  projectId: z.string().regex(/^prj_[A-Za-z0-9]+$/),
  teamId: z.string().regex(/^team_[A-Za-z0-9]+$/),
  environments: z.array(z.enum(["production", "preview", "development"]))
    .min(1).max(3).default(["production"]),
})).max(50);

/** Explicit project/team grants for this board; missing configuration trusts no external project. */
export function vercelTrustedSources(value: string | undefined) {
  if (value === undefined || value.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid VBOARD_TRUSTED_SOURCES: expected valid JSON");
  }
  const result = sourcesSchema.safeParse(parsed);
  if (!result.success) throw new Error("Invalid VBOARD_TRUSTED_SOURCES: expected projectId, teamId and optional environments");
  return result.data.map(({ projectId, teamId, environments }) => {
    const source = vercel({ project: projectId, team: teamId, environments, can: ["post"] });
    return {
      ...source,
      matches: (claims, context) => claims.owner_id === teamId && source.matches(claims, context),
    } satisfies typeof source;
  });
}
