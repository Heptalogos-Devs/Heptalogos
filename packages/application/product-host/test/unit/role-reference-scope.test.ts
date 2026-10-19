// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { ExpressionBrief } from "@heptalogos/subject";
import {
  encodeCognitionUsage,
  encodeObservationInput,
} from "@nous-wave/client/host-bridge";
import { createSubjectRoles } from "../../src/subject-roles.js";

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
  it("uses one formal short-key format and restores the retained source directory on replay", async () => {
    let retained: unknown;
    const registerInput = vi.fn(async (_input: unknown) => ({ claimed: true }));
    const dispatch = vi.fn(async () => ({
      status: "terminal",
      result: {
        status: "ok",
        result: {
          payloads: [
            {
              text: JSON.stringify({
                claims: [
                  { ...claim, quote: "r1", sourceRefs: ["r1"], cognitionRefs: ["r2"] },
                ],
                conflicts: [],
                commitments: [],
                worldPatch: null,
              }),
            },
          ],
        },
      },
    }));
    const roles = createSubjectRoles({
      bindings: async () => [
        {
          role: "narrative.review",
          enabled: true,
          nativeAgentRef: "reviewer",
          fallbackAgentRefs: [],
          allowedTools: [],
          outputContract: "structured_json",
          inputTokens: 8000,
          outputTokens: 2000,
          deadlineMs: 60000,
        },
      ],
      selectAgent: async () => "reviewer",
      authorize: async () => {},
      life: {
        get: async () => ({
          activityId: "activity",
          state: "active",
          adoptedBy: "actor",
          workContextId: "work",
          purpose: "Index the retained statement",
          revision: 1,
          progress: {},
          scope: { tools: [], maxRunMs: 60000 },
        }),
      },
      native: {
        readDispatch: async () => retained,
        recordRoleOutput: vi.fn(),
        registerInput,
        finishDispatch: async (_subject: string, _run: string, value: unknown) => {
          retained = { ...(value as object), requestDigest: "stable" };
        },
        readRun: async () => ({
          consumerId: "consumer",
          registration: {
            subjectId: "subject",
            activityId: "activity",
            roleScope: { role: "narrative.review" },
          },
        }),
      },
      dispatch,
    } as unknown as Parameters<typeof createSubjectRoles>[0]);
    const input = {
      requestId: "review-run",
      requestDigest: "stable",
      subjectId: "subject",
      activityId: "activity",
      role: "narrative.review" as const,
      context: { brief, outputContract: { forbiddenPromptSchema: true } },
      contacts: [],
      sourceRefs: [],
      usage: encodeCognitionUsage({
        purpose: "narrative_review",
        intent: "Index retained original",
        audience: { visibility: "internal" },
      }),
    };
    const first = await roles.invoke(input);
    expect(first.structuredOutput).toMatchObject({
      claims: [
        {
          quote: "r1",
          sourceRefs: brief.sourceRefs,
          cognitionRefs: brief.cognitionRefs,
        },
      ],
    });
    const registration = registerInput.mock.calls[0]![0] as unknown as {
      extraSystemPrompt: string;
      responseFormat: { json_schema: { schema: unknown } };
    };
    expect(registration.extraSystemPrompt).not.toContain("forbiddenPromptSchema");
    const schema = compileSchema(registration.responseFormat.json_schema.schema);
    expect(
      schema.validate({
        claims: [{ ...claim, sourceRefs: ["r1"], cognitionRefs: ["r2"] }],
        conflicts: [],
        commitments: [],
        worldPatch: null,
      }).ok,
    ).toBe(true);
    expect(
      schema.validate({
        claims: [claim],
        conflicts: [],
        commitments: [],
        worldPatch: null,
      }).ok,
    ).toBe(false);
    const replay = await roles.invoke({
      ...input,
      sourceRefs: ["source:later-context"],
    });
    expect(replay.structuredOutput).toEqual(first.structuredOutput);
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it("continues an accepted index from its retained native output without another dispatch", async () => {
    let state = "running";
    const dispatch = vi.fn();
    const roles = createSubjectRoles({
      native: {
        readDispatch: async () => ({ state: "dispatching", requestDigest: "stable" }),
        readRun: async () => ({ state }),
        readRoleResults: async () => ({
          omitted: false,
          results: [
            {
              resultId: "actual-output",
              observation: encodeObservationInput({
                sourceClass: "generated",
                material: {
                  case: "inlineText",
                  value: {
                    mediaType: "application/json",
                    text: JSON.stringify({
                      claims: [],
                      conflicts: [],
                      commitments: [],
                      worldPatch: null,
                    }),
                  },
                },
              }),
            },
          ],
        }),
      },
      dispatch,
    } as unknown as Parameters<typeof createSubjectRoles>[0]);
    const input = {
      requestId: "same-index",
      requestDigest: "stable",
      subjectId: "subject",
      activityId: "activity",
      role: "narrative.review" as const,
      context: { brief },
      sourceRefs: [],
      contacts: [],
      usage: encodeCognitionUsage({}),
    };
    expect(await roles.startIndex(input)).toEqual({
      status: "pending",
      runId: input.requestId,
    });
    state = "completed";
    expect(await roles.startIndex(input)).toMatchObject({
      status: "completed",
      runId: input.requestId,
      structuredOutput: {
        claims: [],
        conflicts: [],
        commitments: [],
        worldPatch: null,
      },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
