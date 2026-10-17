// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Selects existing material by exact accepted occurrence and official derivation lineage.
 * @module perceived-materials
 */
import type { NousClient } from "@nous-wave/client";
import {
  decodeAcceptedObservation,
  type HostPrepareResponse,
} from "@nous-wave/client/host-bridge";
import type { TaskPerceptions } from "./native-perceptions.js";
/** Candidate IDs are not grants: only an exact official source-region lookup can select one. */
export async function selectPerceivedMaterials(
  subjectId: string,
  perceptions: TaskPerceptions,
  material: Pick<NousClient["material"], "listDerivedRepresentations">,
): Promise<HostPrepareResponse["currentSources"]> {
  const result: HostPrepareResponse["currentSources"] = [];
  for (const accepted of perceptions.accepted) {
    const receipt = decodeAcceptedObservation(accepted.receipt);
    let selected: string | undefined;
    if (
      receipt.artifactId &&
      receipt.sourceRegionId &&
      perceptions.selectionCandidates.length
    ) {
      const listed = await material.listDerivedRepresentations({
        subjectId,
        artifactId: receipt.artifactId,
        sourceRegionId: receipt.sourceRegionId,
        limit: 64,
      });
      selected = listed.items.find(
        (item) =>
          item.subjectId === subjectId &&
          perceptions.selectionCandidates.includes(item.representationId) &&
          item.inputs.some(
            (input) =>
              input.reference?.kind === "source_region" &&
              input.reference.value === receipt.sourceRegionId,
          ) &&
          item.inputs.every(
            (input) =>
              (input.reference?.kind === "source_region" &&
                input.reference.value === receipt.sourceRegionId) ||
              (input.reference?.kind === "artifact" &&
                input.reference.value === receipt.artifactId),
          ),
      )?.representationId;
    }
    result.push(
      selected
        ? {
            occurrenceId: receipt.occurrenceId,
            derivedRepresentationId: selected,
            basisRole: "interpretation",
          }
        : {
            occurrenceId: receipt.occurrenceId,
            wholeOccurrence: true,
            basisRole: "direct",
          },
    );
  }
  return result;
}
