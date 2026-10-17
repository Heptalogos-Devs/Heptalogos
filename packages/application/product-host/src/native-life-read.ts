// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reads canonical life/claims for the actual bound native caller without recording new observations.
 * @module native-life-read
 */
import { decodeProjection, encodeProjection } from "@nous-wave/client/host-bridge";
import type { createWorldLifeService } from "@heptalogos/subject";
import type { MessagingService } from "@heptalogos/messaging";
import type { NarrativeHttpOptions } from "./narrative-http.js";
import { managementProblem } from "@heptalogos/management";
import type {
  NativeLifeReadAction,
  NativeLifeReadResponse,
  NativeLifeRequest,
} from "./native-life-contracts.js";
/** Constructed only from a real guarded run, current Activity scope and admitted contact. */
export interface BoundLifeReadBinding {
  readonly subjectId: string;
  readonly activityId: string;
  readonly nativeRunId: string;
  readonly role: string;
  readonly audienceConversationRef?: string;
  readonly sourceRefs: readonly string[];
  readonly world: { timeDomainRef: string; at: string };
  readonly admittedProjection?: Parameters<typeof decodeProjection>[0];
}
/** This is a finite addition to the existing Life tool, not a model-selected source router. */
export function isNativeLifeReadAction(
  request: NativeLifeRequest["request"],
): request is NativeLifeReadAction {
  return ["lifeAt", "claimsTo", "explainStatement", "epistemic"].includes(
    request.action,
  );
}
function denied(detail: string): never {
  throw managementProblem(
    "life.scope_denied",
    "Native Life read is outside its actual binding",
    detail,
    "authorization",
  );
}
/** Owner reads run before the Host's mutation transaction; the bridge rechecks the same contact and scope before publishing. */
export function createBoundLifeReader(options: {
  readonly worlds: Pick<
    ReturnType<typeof createWorldLifeService>,
    "query" | "resolveSourceRefs" | "releasedEventIds"
  >;
  readonly narrative: NarrativeHttpOptions["narrative"];
  readonly messaging: Pick<MessagingService, "messageSources" | "prepareRead">;
}) {
  return async function readLife(
    binding: BoundLifeReadBinding,
    request: NativeLifeReadAction,
  ): Promise<NativeLifeReadResponse> {
    const result = (
      data: Record<string, unknown>,
      sourceRefs: string[] = [],
    ): NativeLifeReadResponse => ({
      action: request.action,
      retrievalOnly: true,
      sourceRefs: [...new Set(sourceRefs)],
      data,
    });
    if (request.action === "lifeAt") {
      const root = `world:${request.worldId}`;
      const allowed = await options.worlds.resolveSourceRefs({
        subjectId: binding.subjectId,
        sourceRefs: binding.sourceRefs,
      });
      const entireWorld = allowed.includes(root);
      const prefix = `world-event:${request.worldId}:`;
      const eventRefs = new Set(allowed.filter((ref) => ref.startsWith(prefix)));
      if (!entireWorld && !eventRefs.size)
        denied("The actual Activity/run has no adopted source scope for this world");
      const cutoff =
        request.knowledgeCutoff ??
        (binding.world.timeDomainRef === request.interval.timeDomainRef
          ? binding.world
          : undefined);
      const read = await options.worlds.query({
        subjectId: binding.subjectId,
        worldId: request.worldId,
        interval: request.interval,
        view: "subject",
        limit: request.limit ?? 32,
        ...(cutoff ? { knowledgeAtWorldTime: cutoff } : {}),
        ...(request.afterEventId ? { afterEventId: request.afterEventId } : {}),
      });
      if (read.view !== "subject")
        denied("WorldLife must return the actual Subject view");
      const visible = read.events.filter((event) => "eventRevision" in event);
      const released = new Set(
        await options.worlds.releasedEventIds(binding.subjectId, request.worldId, [
          ...new Set(visible.map((event) => event.eventId)),
        ]),
      );
      const events = visible.filter((event) => {
        const ref = `world-event:${request.worldId}:${event.eventId}:${event.eventRevision}`;
        return eventRefs.has(ref) || (entireWorld && released.has(event.eventId));
      });
      const refs = events.map(
        (event) =>
          `world-event:${request.worldId}:${event.eventId}:${event.eventRevision}`,
      );
      return result({ ...read, events }, refs);
    }
    if (request.action === "epistemic") {
      if (!binding.admittedProjection)
        return result({
          available: false,
          reason: "No projection has actually been admitted for this bound caller",
        });
      const projection = decodeProjection(binding.admittedProjection);
      if (projection.subjectId !== binding.subjectId || !projection.projectionId)
        denied("The admitted projection must belong to this actual Subject");
      const wire = encodeProjection(projection);
      const view = wire.epistemicView;
      return result({
        available: view !== undefined,
        projectionRef: projection.projectionId,
        epistemicView: view ?? null,
      });
    }
    const audience = binding.audienceConversationRef;
    if (!audience)
      denied("This internal run has no actual communication audience to query");
    if (request.action === "claimsTo") {
      const read = await options.narrative.claimsTo({
        subjectId: binding.subjectId,
        conversationRef: audience,
        limit: request.limit ?? 32,
        ...(request.aboutInterval ? { about: request.aboutInterval } : {}),
        ...(request.afterClaimId ? { afterClaimId: request.afterClaimId } : {}),
      });
      const claims = read.claims.filter((claim) => claim.conversationRef === audience);
      return result(
        { ...read, claims },
        claims.map((claim) => `claim:${claim.claimId}`),
      );
    }
    let platformMessageId = request.messageRef;
    if (request.messageRef.startsWith("message:")) {
      const canonical =
        /^message:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
          request.messageRef,
        );
      const conversation =
        /^conversation:heptalogos:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
          audience,
        );
      if (!canonical || !conversation)
        denied("Use an exact canonical message and the bound actual conversation");
      const metadata = await options.messaging.messageSources({
        messageRefs: [canonical[1]!],
        conversationIds: [conversation[1]!],
      });
      if (metadata.sources.length !== 1)
        denied("The message does not belong to this actual audience");
      const material = await options.messaging.prepareRead({
        messageRefs: [canonical[1]!],
        audience: { subjectId: binding.subjectId, conversationIds: [conversation[1]!] },
        budget: { maxMessages: 1, maxBytes: 65536 },
      });
      const exact = material.materials.find(
        (message) =>
          message.messageId === canonical[1] &&
          message.conversationId === conversation[1],
      );
      if (!exact)
        denied(
          "The exact message identity is not available in the current source scope",
        );
      platformMessageId = exact.nativeMessageId;
    }
    const read = await options.narrative.explainStatement(
      binding.subjectId,
      platformMessageId,
    );
    const claims = read.claims.filter((claim) => claim.conversationRef === audience);
    return result(
      { messageRef: request.messageRef, claims },
      claims.map((claim) => `claim:${claim.claimId}`),
    );
  };
}
