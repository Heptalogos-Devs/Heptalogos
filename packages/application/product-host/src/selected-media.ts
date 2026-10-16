// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Transfers exact selected media to the existing Nous material owner, without a visual model in Host.
 * @module selected-media
 */
import { randomUUID } from "node:crypto";
import type { MessagingService } from "@heptalogos/messaging";
import type { NodeNousClient } from "@nous-wave/client/node";
import {
  decodeObservationInput,
  encodeObservationInput,
  type HostPrepareResponse,
} from "@nous-wave/client/host-bridge";
import type { createArchiveStore } from "./archive-store.js";

type Material = Awaited<
  ReturnType<MessagingService["prepareRead"]>
>["materials"][number];
/** Uploads only the already authorized canonical message attachments and retains their contact attribution. */
export function createSelectedMediaUploader(options: {
  readonly archive: Pick<ReturnType<typeof createArchiveStore>, "readAttachment">;
  readonly nous: () => Promise<Pick<NodeNousClient, "artifacts">>;
}) {
  return async (
    subjectId: string,
    materials: readonly Material[],
    messages: HostPrepareResponse["contacts"],
  ): Promise<HostPrepareResponse["contacts"]> => {
    const result: HostPrepareResponse["contacts"] = [];
    for (const material of materials) {
      const message = messages.find(
        (c) => c.contactRef === "message:" + material.messageId,
      );
      if (!message) throw Error("Selected media requires its exact message contact");
      const original = decodeObservationInput(message.observation);
      for (const attachment of material.attachments) {
        if (attachment.state !== "available" || !attachment.cas) continue;
        const bytes = await options.archive.readAttachment(attachment.cas);
        const artifact = await (
          await options.nous()
        ).artifacts.uploadBytes(subjectId, bytes, {
          mediaType: attachment.cas.mediaType,
          timeoutMs: 30000,
        });
        if (
          artifact.subjectId !== subjectId ||
          artifact.mediaType !== attachment.cas.mediaType ||
          artifact.byteLength !== BigInt(attachment.cas.bytes)
        )
          throw Error(
            "Uploaded selected media identity differs from its canonical attachment",
          );
        const ref = "attachment:" + attachment.attachmentId;
        result.push({
          contactRef: ref,
          observation: encodeObservationInput({
            ...original,
            requestId: randomUUID(),
            externalObjectRef: "object:heptalogos:" + ref,
            material: { case: "artifactId", value: artifact.artifactId },
            context: {
              ...original.context,
              host_selected_media: true,
              attachment_ref: ref,
              part_index: attachment.partIndex,
              original_media_type: attachment.cas.mediaType,
              cas_ref: attachment.cas.reference,
              artifact_content_hash: artifact.contentHash,
            },
          }),
        });
      }
    }
    return result;
  };
}
