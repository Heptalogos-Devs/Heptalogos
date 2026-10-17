// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import type { NousClient } from "@nous-wave/client";
import { encodeAcceptedObservation } from "@nous-wave/client/host-bridge";
import { selectPerceivedMaterials } from "../../src/perceived-materials.js";
describe("existing Task material selection", () => {
  it("treats aggregated A/B IDs only as candidates and selects solely exact authorized artifact/region lineage", async () => {
    const subjectId = randomUUID(),
      artifactId = randomUUID(),
      regionA = randomUUID(),
      regionB = randomUUID(),
      occurrenceId = randomUUID();
    const derivedA = randomUUID(),
      derivedB = randomUUID(),
      mixed = randomUUID();
    const lookup = vi.fn(async (_input: unknown) => ({
      items: [
        {
          subjectId,
          representationId: derivedB,
          inputs: [{ reference: { kind: "source_region", value: regionB } }],
        },
        {
          subjectId,
          representationId: mixed,
          inputs: [
            { reference: { kind: "source_region", value: regionA } },
            { reference: { kind: "source_region", value: regionB } },
          ],
        },
        {
          subjectId,
          representationId: derivedA,
          text: "Existing perception content is never copied into Host results",
          inputs: [
            { reference: { kind: "source_region", value: regionA } },
            { reference: { kind: "artifact", value: artifactId } },
          ],
        },
      ],
      truncated: false,
    }));
    const selected = await selectPerceivedMaterials(
      subjectId,
      {
        sourceRefs: ["message:A"],
        accepted: [
          {
            contactRef: "attachment:A",
            receipt: encodeAcceptedObservation({
              occurrenceId,
              artifactId,
              sourceRegionId: regionA,
            }),
          },
        ],
        selectionCandidates: [derivedA, derivedB, mixed],
      },
      { listDerivedRepresentations: lookup } as unknown as Pick<
        NousClient["material"],
        "listDerivedRepresentations"
      >,
    );
    expect(lookup.mock.calls[0]?.[0]).toEqual({
      subjectId,
      artifactId,
      sourceRegionId: regionA,
      limit: 64,
    });
    expect(selected).toEqual([
      { occurrenceId, derivedRepresentationId: derivedA, basisRole: "interpretation" },
    ]);
    expect(JSON.stringify(selected)).not.toContain("Existing perception content");
  });
  it("does not select an unseen or purged representation and never asks for new derivation", async () => {
    const subjectId = randomUUID(),
      artifactId = randomUUID(),
      sourceRegionId = randomUUID(),
      occurrenceId = randomUUID();
    const lookup = vi.fn(async () => ({
      items: [
        {
          subjectId,
          representationId: "not-actually-seen",
          inputs: [{ reference: { kind: "source_region", value: sourceRegionId } }],
        },
      ],
      truncated: false,
    }));
    const perceived = {
      sourceRefs: ["message:A"],
      accepted: [
        {
          contactRef: "attachment:A",
          receipt: encodeAcceptedObservation({
            occurrenceId,
            artifactId,
            sourceRegionId,
          }),
        },
      ],
      selectionCandidates: ["actually-seen-but-now-unavailable"],
    };
    expect(
      await selectPerceivedMaterials(subjectId, perceived, {
        listDerivedRepresentations: lookup,
      } as unknown as Pick<NousClient["material"], "listDerivedRepresentations">),
    ).toEqual([{ occurrenceId, wholeOccurrence: true, basisRole: "direct" }]);
    expect(lookup).toHaveBeenCalledOnce();
  });
});
