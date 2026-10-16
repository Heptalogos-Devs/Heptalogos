// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Checks exact message contacts against adopted conversation authority without granting other sources.
 * @module native-source-selection
 */
import {
  decodeCognitionUsage,
  decodeObservationInput,
} from "@nous-wave/client/host-bridge";
import type { MessagingService } from "@heptalogos/messaging";
import type { LifeActivity } from "@heptalogos/subject";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import type { Registration } from "./native-cognition.js";
const uuid =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const worldContactPattern = new RegExp(
  `^world-event:(${uuid}):(${uuid}):([1-9][0-9]*)(?::perception:(0|[1-9][0-9]*))?$`,
);
const timestampValue = (value: { seconds: bigint; nanos: number }) =>
  value.seconds * 1_000_000_000n + BigInt(value.nanos);
/** Future messages use the already adopted observe grant; other anchors remain explicitly scoped. */
export function hasAuthorizedNativeSources(
  activity: LifeActivity,
  registration: Registration,
): boolean {
  const scope = activity.scope;
  if (!scope) return false;
  const usage = decodeCognitionUsage(registration.usage);
  const target = usage.audience?.conversationRef;
  if (
    (!target && usage.audience?.visibility !== "internal") ||
    (target &&
      !scope.conversations.some(
        (c) => c.conversationRef === target && c.operations.includes("observe"),
      ))
  )
    return false;
  const selected = new Set(registration.messageRefs);
  if (selected.size !== registration.messageRefs.length) return false;
  const seen = new Set<string>();
  const worldEvents = new Set<string>();
  for (const contact of registration.contacts) {
    const ref = contact.contactRef;
    if (seen.has(ref)) return false;
    const observation = decodeObservationInput(contact.observation);
    if (ref.startsWith("role-result-release:")) {
      if (
        observation.subjectId !== registration.subjectId ||
        observation.sourceClass !== "host_event" ||
        typeof observation.context?.child_run_id !== "string" ||
        !observation.externalObjectRef?.startsWith(
          "object:heptalogos:role-result:" + observation.context.child_run_id + ":",
        ) ||
        observation.requestId !== ref.slice("role-result-release:".length) ||
        observation.context?.source_nature !== "execution_result_release"
      )
        return false;
      seen.add(ref);
      continue;
    }
    // Host registration and canonical WorldLife resolution supply this source;
    // a contact prefix alone grants no world or hidden-event permission.
    if (ref.startsWith("world-event:")) {
      const match = worldContactPattern.exec(ref);
      const source = observation.worldRealized;
      const perceived = source?.worldObserved;
      const extent = observation.occurredTime?.extent?.value;
      if (
        !match ||
        observation.subjectId !== registration.subjectId ||
        observation.actorEntityRef !== registration.actorEntityRef ||
        observation.sourceClass !== "world_realized" ||
        !source ||
        source.worldId !== match[1] ||
        source.eventId !== match[2] ||
        source.eventRevision !== match[3] ||
        !perceived?.at ||
        !perceived.recordedAt ||
        perceived.timeDomainRef !== observation.occurredTime?.timeDomainRef ||
        observation.observedStamp
      )
        return false;
      const root = `world-event:${match[1]}:${match[2]}:${match[3]}`;
      if (
        !registration.sourceRefs.includes(root) ||
        ![root, `world:${match[1]}`].some((sourceRef) =>
          scope.sourceRefs.includes(sourceRef),
        ) ||
        observation.externalObjectRef !== "object:heptalogos:" + root
      )
        return false;
      const at = timestampValue(perceived.at);
      if (extent?.case === "interval") {
        if (
          !extent.value.start ||
          !extent.value.end ||
          at < timestampValue(extent.value.start) ||
          at > timestampValue(extent.value.end)
        )
          return false;
      } else if (extent?.case !== "instant" || at !== timestampValue(extent.value))
        return false;
      seen.add(ref);
      worldEvents.add(root);
      continue;
    }
    if (
      observation.subjectId !== registration.subjectId ||
      observation.externalObjectRef !== "object:heptalogos:" + ref ||
      observation.conversationRef !== target ||
      observation.sourceClass !== "message"
    )
      return false;
    if (ref.startsWith("message:")) {
      if (!selected.has(ref.slice(8))) return false;
    } else if (ref.startsWith("attachment:")) {
      const context = observation.context;
      const parent = context?.message_ref;
      if (
        context?.host_selected_media !== true ||
        context.attachment_ref !== ref ||
        typeof parent !== "string" ||
        !parent.startsWith("message:") ||
        !selected.has(parent.slice(8)) ||
        !Number.isInteger(context.part_index) ||
        Number(context.part_index) < 0 ||
        observation.material.case !== "artifactId" ||
        !observation.material.value
      )
        return false;
    } else return false;
    seen.add(ref);
  }
  const inherited = new Set(registration.inheritedMessageSources ?? []);
  return (
    registration.sourceRefs.every((ref) =>
      ref.startsWith("world-event:")
        ? (() => {
            const match = worldContactPattern.exec(ref);
            return (
              !!match &&
              !match[4] &&
              (scope.sourceRefs.includes(ref) ||
                scope.sourceRefs.includes(`world:${match[1]}`)) &&
              (worldEvents.has(ref) ||
                (registration.inheritedSourceRefs ?? []).includes(ref))
            );
          })()
        : ref.startsWith("message:")
          ? (selected.has(ref.slice(8)) && seen.has(ref)) || inherited.has(ref)
          : scope.sourceRefs.includes(ref) ||
            (registration.inheritedSourceRefs ?? []).includes(ref) ||
            (ref.startsWith("role-result-release:") && seen.has(ref)),
    ) &&
    [...selected].every(
      (ref) =>
        seen.has("message:" + ref) &&
        registration.sourceRefs.includes("message:" + ref),
    )
  );
}

/** Checks the selected message identities against canonical metadata in the exact adopted audience. */
export async function hasCanonicalNativeMessages(
  registration: Registration,
  messaging: Pick<MessagingService, "messageSources" | "prepareRead">,
  transaction?: PersistenceInternalTransaction,
): Promise<boolean> {
  const usage = decodeCognitionUsage(registration.usage);
  const target = usage.audience?.conversationRef;
  if (!target?.startsWith("conversation:heptalogos:"))
    return registration.messageRefs.length === 0;
  const conversationId = target.slice("conversation:heptalogos:".length);
  const messageRefs = [
    ...new Set([
      ...registration.messageRefs,
      ...(registration.inheritedMessageSources ?? []).map((ref) => ref.slice(8)),
    ]),
  ];
  if (!messageRefs.length)
    return registration.contacts.every(
      (contact) =>
        contact.contactRef.startsWith("world-event:") ||
        contact.contactRef.startsWith("role-result-release:"),
    );
  const result = await messaging.messageSources(
    {
      messageRefs,
      conversationIds: [conversationId],
    },
    transaction,
  );
  const canonical =
    result.sources.length === messageRefs.length &&
    result.sources.every(
      (source) =>
        source.conversationId === conversationId && source.lifecycle === "present",
    );
  if (!canonical) return false;
  const media = registration.contacts.filter((c) =>
    c.contactRef.startsWith("attachment:"),
  );
  if (!media.length) return true;
  const read = await messaging.prepareRead(
    {
      messageRefs: [...registration.messageRefs],
      audience: {
        subjectId: registration.subjectId,
        conversationIds: [conversationId],
      },
      budget: { maxMessages: 64, maxBytes: 1024 * 1024 },
    },
    transaction,
  );
  if (read.omitted.length) return false;
  return media.every((contact) => {
    const context = decodeObservationInput(contact.observation).context;
    const message = read.materials.find(
      (m) => "message:" + m.messageId === context?.message_ref,
    );
    return (
      !!message &&
      !message.withheld &&
      message.attachments.some(
        (a) =>
          "attachment:" + a.attachmentId === contact.contactRef &&
          a.partIndex === context?.part_index &&
          a.state === "available" &&
          a.cas?.reference === context?.cas_ref &&
          a.cas?.mediaType === context?.original_media_type,
      )
    );
  });
}
