// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import type { NousClient } from "@nous-wave/client";
import type { Pursuit, LifeActivity, createPursuitService } from "@heptalogos/subject";
import {
  managementProblem,
  type ProductManagement,
  type ManagementAuthentication,
} from "@heptalogos/management";
import { createPursuitMotivation } from "../../src/pursuit-motivation.js";
import { createProductHttpApp } from "../../src/product-http.js";
describe("public Motivation and service-only Pursuit boundaries", () => {
  it("reads actual current revisions, forwards only adopted SourceRead and preserves official unknown coverage", async () => {
    const subjectId = randomUUID(),
      desireId = randomUUID(),
      conditionId = randomUUID(),
      workContextId = randomUUID();
    let current = true;
    const getRevision = vi.fn(async ({ id }: { id: string }) => ({
      subjectId,
      reference: {
        kind: id === desireId ? "desire_revision" : "desired_condition_revision",
        value: id,
      },
      currentRevisionId: current ? id : randomUUID(),
      objectEpoch: 1n,
      acceptanceState: "accepted",
      integrityState: "valid",
      suppressionState: "normal",
      content: {
        family: id === desireId ? "desire" : "desired_condition",
        condition: { window: { timeDomainRef: "time:real" } },
      },
    }));
    const evaluate = vi.fn(async () => ({
      evaluationId: randomUUID(),
      conditionRevision: { kind: "desired_condition_revision", value: conditionId },
      verdict: "unknown",
      finalConclusion: false,
      coverage: "gap",
      evaluatedInterval: { timeDomainRef: "time:real" },
      inputs: [],
    }));
    const client = {
      motivation: { getRevision, evaluate },
      runtime: {
        getWorkContext: async () => ({
          workContext: { subjectId, workContextId, state: "open" },
        }),
      },
    } as unknown as Pick<NousClient, "motivation" | "runtime">;
    const adapter = createPursuitMotivation({
      nous: async () => client,
      now: () => new Date().toISOString(),
    });
    const pursuit = {
      subjectId,
      workContextId,
      desireRevision: { kind: "desire_revision", value: desireId },
      conditionRevision: { kind: "desired_condition_revision", value: conditionId },
    } as Pursuit;
    expect((await adapter.inspect(pursuit)).current).toBe(true);
    current = false;
    expect((await adapter.inspect(pursuit)).current).toBe(false);
    expect(await adapter.workContextOpen(subjectId, workContextId)).toBe(true);
    const activity = {
      scope: {
        sourceRefs: ["message:" + randomUUID(), "occurrence:actual-result"],
        conversations: [
          {
            conversationRef: "conversation:heptalogos:" + randomUUID(),
            operations: ["observe"],
          },
        ],
      },
    } as LifeActivity;
    const requested = [{ kind: "occurrence", value: "not-granted" }];
    const result = await adapter.evaluate({
      pursuit,
      activity,
      operationId: randomUUID(),
      evidenceRefs: requested,
    });
    expect(result.verdict).toBe("unknown");
    expect(result.coverage).toBe("gap");
    expect(result.applicable).toBeNull();
    const input = (evaluate.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(input).not.toHaveProperty("complete");
    expect(input.evidenceRefs).toEqual(requested);
    expect(input.sourceRead).toEqual({
      subjectId,
      sourceRefs: [
        { kind: "occurrence", value: "actual-result" },
        { kind: "work_context", value: workContextId },
      ],
      originConversationRefs: [activity.scope!.conversations[0]!.conversationRef],
    });
  });
  it("rejects ordinary administrator/chat credentials and a different Subject before reading Pursuit state", async () => {
    const subjectId = randomUUID(),
      pursuitId = randomUUID(),
      get = vi.fn(async () => undefined);
    const app = await createProductHttpApp({
      identity: { installationId: "fixture", bootId: "fixture" },
      authentication: {} as ManagementAuthentication,
      product: {} as ProductManagement,
      onAdministratorClaimed: async () => {},
      pursuit: {
        currentSubject: async () => subjectId,
        authenticate: async (token) => {
          if (token !== "service-only")
            throw managementProblem(
              "gateway.service_invalid",
              "Service credential required",
              "Use the private Channel service credential",
              "authorization",
            );
        },
        runMutation: async (_kind, fn) => fn(),
        pursuits: { get } as unknown as ReturnType<typeof createPursuitService>,
      },
    });
    try {
      const request = (subject: string, token: string) =>
        app.inject({
          method: "POST",
          url: "/gateway/v1/pursuit/read",
          headers: { authorization: "Bearer " + token },
          payload: { subjectId: subject, pursuitId },
        });
      expect((await request(subjectId, "ordinary-administrator")).statusCode).toBe(401);
      expect(get).not.toHaveBeenCalled();
      expect((await request(randomUUID(), "service-only")).statusCode).toBe(403);
      expect(get).not.toHaveBeenCalled();
      const allowed = await request(subjectId, "service-only");
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toEqual({ pursuit: null });
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
