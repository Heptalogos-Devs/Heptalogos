// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { ExpressionBrief } from "@heptalogos/subject";
import { encodeCognitionUsage } from "@nous-wave/client/host-bridge";
import {
  createSubjectRoles,
  narrativeReviewOutputContract,
} from "../../src/subject-roles.js";

const brief = {
  sourceRefs: ["message:visible"],
  cognitionRefs: ["derived_representation:visible"],
  eventRefs: [],
  priorClaimRefs: [],
  deception: "none",
  worldDetailScope: null,
} as unknown as ExpressionBrief;
const claim = {
  sourceIndex: 0,
  quote: "实际画面。",
  content: "实际画面。",
  entityRefs: [],
  kind: "external_result",
  stance: "reported",
  polarity: "affirm",
  about: null,
  basis: "report",
  sourceRefs: brief.sourceRefs,
  cognitionRefs: brief.cognitionRefs,
  eventRefs: [],
  priorClaimRefs: [],
};
describe("owned role reference and expression scope", () => {
  it("keeps actual media cognition out of source/world/previous-claim reference slots", () => {
    const schema = compileSchema(narrativeReviewOutputContract(brief));
    const review = (fields = {}) => ({
      claims: [{ ...claim, ...fields }],
      conflicts: [],
      commitments: [],
      worldPatch: null,
    });
    expect(schema.validate(review()).ok).toBe(true);
    for (const fields of [
      { sourceRefs: brief.cognitionRefs },
      { eventRefs: brief.sourceRefs },
      { priorClaimRefs: ["subject-decision:unspoken"] },
      { basis: "world" },
    ])
      expect(schema.validate(review(fields)).ok).toBe(false);
  });
  it.each(["subject.render", "narrative.review"] as const)(
    "gives each %s candidate a separate native session while retaining the Subject and Activity",
    async (role) => {
      const subjectId = randomUUID(),
        activityId = randomUUID();
      const registerInput = vi.fn(async (_input: unknown) => {
        throw Error("captured registration");
      });
      const roles = createSubjectRoles({
        bindings: async () => [
          {
            role,
            enabled: true,
            nativeAgentRef: "profile",
            fallbackAgentRefs: [],
            allowedTools: [],
            outputContract:
              role === "subject.render" ? "natural_text" : "structured_json",
            inputTokens: 32000,
            outputTokens: 4096,
            deadlineMs: 180000,
          },
        ],
        selectAgent: async () => "profile",
        authorize: async () => {},
        life: {
          get: async () => ({
            activityId,
            state: "active",
            adoptedBy: "entity:actual",
            workContextId: randomUUID(),
            purpose: "Current expression",
            progress: {},
            scope: { tools: [], maxRunMs: 180000 },
          }),
        },
        native: { readDispatch: async () => undefined, registerInput },
        dispatch: vi.fn(),
      } as unknown as Parameters<typeof createSubjectRoles>[0]);
      for (let index = 0; index < 2; index++)
        await expect(
          roles.invoke({
            requestId: randomUUID(),
            subjectId,
            activityId,
            role,
            context: { brief },
            contacts: [],
            sourceRefs: [],
            usage: encodeCognitionUsage({
              purpose: "subject_rendering",
              intent: "Current expression",
              audience: { visibility: "internal" },
            }),
          }),
        ).rejects.toThrow("captured registration");
      const first = registerInput.mock.calls[0]![0] as {
        sessionKey: string;
        subjectId: string;
        activityId: string;
      };
      const second = registerInput.mock.calls[1]![0] as typeof first;
      expect(first.sessionKey).not.toBe(second.sessionKey);
      expect([first.subjectId, second.subjectId]).toEqual([subjectId, subjectId]);
      expect([first.activityId, second.activityId]).toEqual([activityId, activityId]);
    },
  );
});
