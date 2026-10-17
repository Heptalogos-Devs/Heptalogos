// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Exact selected source contacts and retired-before-prepare recovery.
 * @module subject-source-contact
 */
import { v5 as uuidv5 } from "uuid";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import { managementProblem } from "@heptalogos/management";
import type { SubjectReaction, SituationObject } from "@heptalogos/subject";
import {
  encodeObservationInput,
  timestampFromDate,
  decodeAcceptedObservation,
  type HostPrepareResponse,
} from "@nous-wave/client/host-bridge";
import type { SubjectSituationOptions } from "./subject-situation.js";
import { readInitialSettingSource } from "./native-profile-source.js";
const ns = "e51d00a4-cd3f-47ef-9fde-bdbb52d51099";
function denied(detail: string): never {
  throw managementProblem(
    "reactor.source_denied",
    "Current source is unavailable",
    detail,
    "conflict",
    "after-change",
  );
}
/** Models cannot provide source identity, observations, scopes or original recovery receipts. */
export function createSubjectSourceContacts(
  options: Pick<
    SubjectSituationOptions,
    "life" | "worlds" | "native" | "foreground" | "persistence" | "profiles" | "now"
  >,
) {
  const readWorld = async (
    reaction: SubjectReaction,
    object: SituationObject,
    nextRunId: string,
  ): Promise<{
    contacts: HostPrepareResponse["contacts"];
    context: Record<string, unknown>;
  }> => {
    const match = /^world-event:([0-9a-f-]{36}):([0-9a-f-]{36}):([1-9][0-9]*)$/i.exec(
      object.sourceRef,
    );
    if (!match) denied("Choose a canonical event object");
    const [worldId, eventId, revision] = match.slice(1) as [string, string, string];
    const activity = await options.life.get(reaction.subjectId, reaction.activityId);
    if (
      !activity?.scope?.sourceRefs.includes("world:" + worldId) &&
      !activity?.scope?.sourceRefs.includes(object.sourceRef)
    )
      denied("This event is outside the currently adopted world scope");
    const event = await options.worlds.pendingContact({
      subjectId: reaction.subjectId,
      worldId,
      eventId,
    });
    if (!event || String(event.eventRevision) !== revision)
      denied(
        "The exact pending event revision is unavailable; do not substitute a newer scene",
      );
    await options.foreground.bindRun({
      subjectId: reaction.subjectId,
      activityId: reaction.activityId,
      focus: reaction,
      runId: nextRunId,
    });
    const selection = await options.worlds.selectContact({
      subjectId: reaction.subjectId,
      worldId,
      eventId,
      runId: nextRunId,
    });
    if (
      !selection.selected &&
      selection.state === "selected" &&
      selection.selectedRunId
    ) {
      const oldRun = await options.native.readRun(selection.selectedRunId);
      if (oldRun?.consumerId) {
        const applied = await options.native.readAppliedContext(
          selection.selectedRunId,
        );
        const receipt = applied.occurrences.find(
          (value) =>
            value.contactRef === event.sourceRef &&
            decodeAcceptedObservation(value.receipt).occurrenceId,
        );
        if (
          receipt &&
          oldRun.registration.subjectId === reaction.subjectId &&
          oldRun.registration.contacts.some(
            (value) => value.contactRef === event.sourceRef,
          )
        ) {
          await options.worlds.acknowledgeContact({
            subjectId: reaction.subjectId,
            worldId,
            eventId,
            runId: selection.selectedRunId,
            contactRef: receipt.contactRef,
          });
          return {
            contacts: [],
            context: {
              retrievalOnly: true,
              knownWorldEvent: {
                worldId,
                eventId,
                eventRevision: event.eventRevision,
                interval: event.interval,
                perceptions: event.perceptions,
              },
            },
          };
        }
      }
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await options.foreground.assertCurrentIn(
            tx,
            reaction.subjectId,
            reaction.activityId,
            reaction,
          );
          if (await options.native.readRun(selection.selectedRunId!, tx))
            denied(
              "The original prepared contact may already exist in Nous; retain its exact handoff for reconciliation",
            );
          const original = await options.native.readInputState(
            reaction.subjectId,
            selection.selectedRunId!,
            tx,
          );
          if (original?.prepared)
            denied(
              "The original prepare may have published a contact; keep unknown outcomes",
            );
          const retired = await options.foreground.reactionForRun(
            reaction.subjectId,
            selection.selectedRunId!,
            tx,
          );
          if (
            !retired ||
            retired.state === "active" ||
            (original &&
              (original.registration.foreground?.reactionId !== retired.reactionId ||
                original.registration.foreground.focusRevision !==
                  retired.focusRevision))
          )
            denied(
              "Reassignment requires the exact retired qualification and proof that it never prepared",
            );
          await options.worlds.reassignSelectedContactIn(tx, {
            subjectId: reaction.subjectId,
            worldId,
            eventId,
            expectedRunId: selection.selectedRunId!,
            newRunId: nextRunId,
            basisRef: `reaction:${retired.reactionId}:${retired.focusRevision}:retired-before-prepare`,
          });
        }),
      );
    } else if (!selection.selected || selection.state === "released")
      denied("This event is already released or its exact selection is unavailable");
    if (!event.perceptions.length)
      denied("This event has no actual Subject perception");
    const observed = timestampFromDate(new Date(options.now()));
    const material = {
      worldId,
      eventId,
      eventRevision: event.eventRevision,
      interval: event.interval,
      perceptions: event.perceptions,
    };
    return {
      contacts: event.perceptions.map((perception, index) => ({
        contactRef: event.sourceRef + ":perception:" + index,
        observation: encodeObservationInput({
          subjectId: reaction.subjectId,
          requestId: uuidv5(event.sourceRef + ":perception:" + index + ":contact", ns),
          sourceClass: "world_realized",
          externalObjectRef: "object:heptalogos:" + event.sourceRef,
          actorEntityRef: perception.actorRef,
          observedAt: observed,
          occurredTime: {
            timeDomainRef: event.interval.timeDomainRef,
            extent: {
              value: {
                case: "interval",
                value: {
                  start: timestampFromDate(new Date(event.interval.start)),
                  end: timestampFromDate(new Date(event.interval.end)),
                },
              },
            },
          },
          worldRealized: {
            worldId,
            eventId,
            eventRevision: revision,
            producerRef: event.source.producerRef,
            generationMethod: event.source.kind,
            realizedAt: timestampFromDate(new Date(event.recordedAt)),
            worldObserved: {
              timeDomainRef: perception.at.timeDomainRef,
              at: timestampFromDate(new Date(perception.at.at)),
              recordedAt: observed,
            },
            sharedOriginRefs: [event.source.producerRef, ...event.source.sourceRefs],
          },
          material: {
            case: "inlineText",
            value: {
              text: JSON.stringify({ ...material, perceptions: [perception] }),
              mediaType: "application/json",
            },
          },
          context: {
            activity_ref: reaction.activityId,
            world_event_ref: event.sourceRef,
            actual_producer: "heptalogos.world_life",
          },
          admit: false,
        }),
      })),
      context: { actualWorldContact: material },
    };
  };
  const readInitialSetting = (
    reaction: SubjectReaction,
    sourceRef: string,
    nextRunId: string,
  ) =>
    readInitialSettingSource(
      {
        profiles: options.profiles,
        hasAcceptedSource: options.native.hasAcceptedSource,
      },
      { subjectId: reaction.subjectId, sourceRef, nativeRunId: nextRunId },
    );
  return { readWorld, readInitialSetting };
}
