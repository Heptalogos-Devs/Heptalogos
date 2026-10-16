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
import type { Registration } from "./native-cognition.js";
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
    !target ||
    !scope.conversations.some(
      (c) => c.conversationRef === target && c.operations.includes("observe"),
    )
  )
    return false;
  const selected = new Set(registration.messageRefs);
  if (selected.size !== registration.messageRefs.length) return false;
  const seen = new Set<string>();
  for (const contact of registration.contacts) {
    const ref = contact.contactRef;
    if (seen.has(ref)) return false;
    const observation = decodeObservationInput(contact.observation);
    if (
      observation.subjectId !== registration.subjectId ||
      observation.externalObjectRef !== ref ||
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
  const inherited = new Set(
    registration.role === "worker" ? (registration.inheritedMessageSources ?? []) : [],
  );
  return (
    registration.sourceRefs.every((ref) =>
      ref.startsWith("message:")
        ? (selected.has(ref.slice(8)) && seen.has(ref)) || inherited.has(ref)
        : scope.sourceRefs.includes(ref),
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
): Promise<boolean> {
  const usage = decodeCognitionUsage(registration.usage);
  const target = usage.audience?.conversationRef;
  if (!target?.startsWith("conversation:heptalogos:"))
    return registration.messageRefs.length === 0;
  const conversationId = target.slice("conversation:heptalogos:".length);
  const messageRefs = [
    ...new Set([
      ...registration.messageRefs,
      ...(registration.role === "worker"
        ? (registration.inheritedMessageSources ?? [])
        : []
      ).map((ref) => ref.slice(8)),
    ]),
  ];
  const result = await messaging.messageSources({
    messageRefs,
    conversationIds: [conversationId],
  });
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
  const read = await messaging.prepareRead({
    messageRefs: [...registration.messageRefs],
    audience: { subjectId: registration.subjectId, conversationIds: [conversationId] },
    budget: { maxMessages: 64, maxBytes: 1024 * 1024 },
  });
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
