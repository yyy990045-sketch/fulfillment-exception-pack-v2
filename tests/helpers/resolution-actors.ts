import type { ResolutionActorContext } from "../../src/domain/v2/index.js";

export function resolutionActor(
  displayName: string,
  roles: string[] = [displayName],
  subjectId = displayName,
): ResolutionActorContext {
  return { subjectId, displayName, roles };
}
