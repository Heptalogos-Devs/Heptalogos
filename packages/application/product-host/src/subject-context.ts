// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Supplies the same real audience history and known world view to current subjective calls.
 * @module subject-context
 */
import type {
  createWorldLifeService,
  createNarrativeService,
  createLifeService,
} from "@heptalogos/subject";
import { decodeCognitionUsage } from "@nous-wave/client/host-bridge";
import type { RoleInvocation } from "./subject-roles.js";
/** Current records are direct owner projections, not guessed from a future reflection. */
export async function currentSubjectContext(
  options: {
    worlds: ReturnType<typeof createWorldLifeService>;
    narrative: Pick<
      ReturnType<typeof createNarrativeService>,
      "claimsTo" | "pendingCommitments"
    >;
    life: Pick<ReturnType<typeof createLifeService>, "worldNow">;
  },
  input: RoleInvocation,
  sourceRefs: readonly string[],
) {
  const usage = decodeCognitionUsage(input.usage),
    audience = usage.audience?.conversationRef;
  const claims = audience
    ? await options.narrative.claimsTo({
        subjectId: input.subjectId,
        conversationRef: audience,
        limit: 64,
        order: "newest",
      })
    : { claims: [], more: false };
  const world = await options.life.worldNow(input.subjectId);
  const roots = (
    await options.worlds.resolveSourceRefs({ subjectId: input.subjectId, sourceRefs })
  ).flatMap((ref) => /^world:([0-9a-f-]{36})$/i.exec(ref)?.[1] ?? []);
  const worldViews = [];
  for (const worldId of [...new Set(roots)].slice(0, 8)) {
    const state = await options.worlds.read(input.subjectId, worldId);
    if (!state || state.definition.timeDomainRef !== world.timeDomainRef) continue;
    const view = await options.worlds.query({
      subjectId: input.subjectId,
      worldId,
      interval: {
        timeDomainRef: world.timeDomainRef,
        start: new Date(Date.parse(world.at) - 2 * 3600000).toISOString(),
        end: world.at,
      },
      knowledgeAtWorldTime: world,
      view: "subject",
      limit: 64,
    });
    const released = new Set(
      await options.worlds.releasedEventIds(input.subjectId, worldId, [
        ...new Set(view.events.map((event) => event.eventId)),
      ]),
    );
    worldViews.push({
      ...view,
      worldId,
      events: view.events.filter(
        (event) =>
          released.has(event.eventId) ||
          sourceRefs.includes(
            `world-event:${worldId}:${event.eventId}:${"eventRevision" in event ? event.eventRevision : 0}`,
          ),
      ),
    });
  }
  const pendingCommitments = await options.narrative.pendingCommitments(
    input.subjectId,
    input.activityId,
  );
  return {
    world,
    currentClaims: claims,
    knownWorldViews: worldViews,
    pendingCommitments,
  };
}
