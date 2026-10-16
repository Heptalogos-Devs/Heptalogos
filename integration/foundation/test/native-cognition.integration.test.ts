// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLifeService } from "@heptalogos/subject";
import { readRepositorySql } from "@heptalogos/persistence/repository";
import {
  createNativeCognitionBridge,
  type NativeCognitionOptions,
} from "../../../packages/application/product-host/src/native-cognition.js";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
// Resolve the actual installed Client's public export from its consuming package.
// Tests never import Nous source or its bundled private Protocol dependency.
const metadataUrl = new URL(
  "../../../packages/application/product-host/node_modules/@nous-wave/client/package.json",
  import.meta.url,
);
const metadata = JSON.parse(await readFile(metadataUrl, "utf8")) as {
  exports: Record<string, { import: string }>;
};
const sdk = await import(
  new URL(metadata.exports["./host-bridge"]!.import, metadataUrl).href
);
async function admitSelected(
  f: Awaited<ReturnType<typeof fixture>>,
  response: Awaited<
    ReturnType<ReturnType<typeof createNativeCognitionBridge>["prepare"]>
  >,
) {
  const occurrences = response.contacts.map((contact) => ({
    contactRef: contact.contactRef,
    receipt: sdk.encodeAcceptedObservation({ occurrenceId: randomUUID() }),
  }));
  const usage = sdk.withAcceptedContactRoots(
    sdk.decodeCognitionUsage(response.usage),
    f.input.subjectId,
    occurrences.map((item) => sdk.decodeAcceptedObservation(item.receipt)),
  );
  await f.c.run(() =>
    f.bridge.admitted({
      ...sdk.hostContactIdentitySchema.strip().parse(f.input),
      projection: sdk.encodeProjection({
        projectionId: randomUUID(),
        consumerId: "consumer:fixture",
        subjectId: f.input.subjectId,
        sessionId: f.input.nousSessionId,
        usage,
      }),
      occurrences,
    }),
  );
  return usage;
}
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
async function fixture() {
  const c = await composeProductPersistence();
  const subjectId = randomUUID();
  const actor = `entity:subject:${randomUUID()}`;
  const workContextId = randomUUID();
  const now = () => new Date().toISOString();
  const scope = {
    conversations: [
      {
        conversationRef: "conversation:qq:registered",
        operations: ["observe" as const, "send" as const],
      },
    ],
    tools: ["read"],
    sourceRefs: ["occurrence:registered"],
    maxRunMs: 60000,
  };
  const life = createLifeService({
    persistence: c.persistence,
    now,
    worldNow: async () => ({ timeDomainRef: "time:real", at: now() }),
    scopeAuthority: async () => scope,
  });
  let activity = await c.run(() =>
    life.propose({
      operationId: randomUUID(),
      subjectId,
      purpose: "Read only selected materials",
      mode: "work",
      window: { notBefore: null, notAfter: null },
      proposedBy: actor,
      sourceRefs: [],
      workContextId,
      world: { timeDomainRef: "time:real", at: now() },
      nextOpportunity: null,
      interruptOn: ["manual"],
    }),
  );
  activity = await c.run(() =>
    life.adopt({
      subjectId,
      activityId: activity.activityId,
      expectedRevision: activity.revision,
      adoptedBy: actor,
      scope,
    }),
  );
  activity = await c.run(() =>
    life.transition({
      subjectId,
      activityId: activity.activityId,
      expectedRevision: activity.revision,
      action: "start",
      reason: "Trusted Host dispatch",
    }),
  );
  let contactUnavailable = false;
  let nousUnavailable = false;
  const recordContact = vi.fn(
    async (_input: Parameters<NativeCognitionOptions["recordContact"]>[0]) => {
      if (contactUnavailable) throw new Error("Messaging unavailable");
    },
  );
  const receipts = new Map<string, unknown>();
  const submissions: Record<string, unknown>[] = [];
  const recordObservation = vi.fn(async (input: Record<string, unknown>) => {
    if (nousUnavailable) throw new Error("Nous unavailable");
    submissions.push(sdk.encodeObservationInput(input));
    const id = input.requestId as string;
    if (!receipts.has(id))
      receipts.set(id, sdk.decodeAcceptedObservation({ occurrenceId: randomUUID() }));
    return receipts.get(id);
  });
  let revoked = false;
  const bridge = createNativeCognitionBridge({
    persistence: c.persistence,
    life,
    now,
    authorizeInput: async () => {
      if (revoked) throw new Error("Current input permission revoked");
    },
    recordContact,
    nous: async () =>
      ({ runtime: { recordObservation } }) as unknown as Awaited<
        ReturnType<NativeCognitionOptions["nous"]>
      >,
  });
  const messageRefs = [randomUUID(), randomUUID()];
  const registration = {
    subjectId,
    activityId: activity.activityId,
    sessionKey: "native:main",
    nativeAgentId: "main",
    nativeRunId: randomUUID(),
    prompt: "exact raw native prompt with private engineering envelope",
    role: "main" as const,
    actorEntityRef: actor,
    workContextId,
    usage: sdk.decodeCognitionUsage({
      agentInstanceId: "host:placement",
      purpose: "deliberation",
      sourceRead: {
        subjectId,
        sourceRefs: [{ kind: "occurrence", value: "registered" }],
      },
      intent: "Read selected actual facts",
      audience: { visibility: "group", conversationRef: "conversation:qq:registered" },
    }),
    sourceRefs: [
      "occurrence:registered",
      ...messageRefs.map((ref) => "message:" + ref),
    ],
    messageRefs,
    contacts: [0, 1].map((index) => ({
      contactRef: `message:${messageRefs[index]}`,
      observation: sdk.encodeObservationInput({
        subjectId,
        requestId: randomUUID(),
        sourceClass: "message",
        actorEntityRef: `entity:author:${index}`,
        externalObjectRef: `object:heptalogos:message:${messageRefs[index]}`,
        conversationRef: "conversation:qq:registered",
        occurredTime: {
          value: {
            case: "instant",
            value: sdk.timestampFromDate(
              new Date(Date.now() - 86400000 - index * 1000),
            ),
          },
        },
        material: {
          case: "inlineText",
          value: { text: `Actual author ${index}`, mediaType: "text/plain" },
        },
        context: { message_fact_id: messageRefs[index] },
      }),
    })),
  };
  const saved = await c.run(() => bridge.registerInput(registration));
  const input = {
    version: 1 as const,
    subjectId,
    nousSessionId: randomUUID(),
    contactRequestId: randomUUID(),
    invocationId: "model:1",
    promptDigest: saved.promptDigest,
    native: {
      sessionKey: registration.sessionKey,
      sessionId: "native-session",
      runId: registration.nativeRunId,
      agentId: "main",
      historyGeneration: "history:1",
    },
  };
  return {
    c,
    life,
    bridge,
    registration,
    input,
    messageRefs,
    actor,
    activity,
    recordContact,
    recordObservation,
    submissions,
    revoke: () => {
      revoked = true;
    },
    setContactUnavailable: (value: boolean) => {
      contactUnavailable = value;
    },
    setNousUnavailable: (value: boolean) => {
      nousUnavailable = value;
    },
  };
}
real(
  "native cognition authority uses real fenced PostgreSQL and the public canonical Client codecs",
  () => {
    it("binds exact registered input, freezes actual author/time/scope across tool followups, and retries selected Messaging contact acknowledgement", async () => {
      const f = await fixture();
      try {
        await expect(
          f.c.run(() => f.bridge.prepare({ ...f.input, promptDigest: "0".repeat(64) })),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_input_unregistered" },
        });
        await expect(
          f.c.run(() =>
            f.bridge.prepare({ ...f.input, unknownAuthority: true } as never),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.invalid_input", category: "validation" },
        });
        await expect(
          f.c.run(() =>
            f.bridge.prepare({
              ...f.input,
              native: { ...f.input.native, agentId: "other-account-agent" },
            }),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_agent_changed" },
        });
        const first = await f.c.run(() => f.bridge.prepare(f.input));
        expect(first.workContextId).toBe(f.registration.workContextId);
        expect(
          first.contacts.map(
            (contact) => sdk.decodeObservationInput(contact.observation).actorEntityRef,
          ),
        ).toEqual(["entity:author:0", "entity:author:1"]);
        expect(first.contacts[0]!.observation.observedAt).not.toBe(
          first.contacts[0]!.observation.occurredTime,
        );
        expect(first.contacts[0]!.observation.context).toMatchObject({
          activity_ref: f.activity.activityId,
          contact_request_id: f.input.contactRequestId,
          cognition_usage: {
            agentInstanceId: `native-session:${f.input.native.runId}`,
          },
        });
        expect(await f.c.run(() => f.bridge.prepare(f.input))).toEqual(first);
        const followup = {
          ...f.input,
          contactRequestId: randomUUID(),
          invocationId: "model:2",
        };
        const next = await f.c.run(() => f.bridge.prepare(followup));
        expect(next.contacts).toEqual(first.contacts);
        expect(f.recordContact).not.toHaveBeenCalled();
        const occurrences = first.contacts.map((contact) => ({
          contactRef: contact.contactRef,
          receipt: sdk.encodeAcceptedObservation({ occurrenceId: randomUUID() }),
        }));
        const admitted = {
          ...sdk.hostContactIdentitySchema.strip().parse(f.input),
          projection: sdk.encodeProjection({
            projectionId: randomUUID(),
            subjectId: f.input.subjectId,
            sessionId: f.input.nousSessionId,
            consumerId: "consumer:fixture",
            usage: sdk.withAcceptedContactRoots(
              sdk.decodeCognitionUsage(first.usage),
              f.input.subjectId,
              occurrences.map((item) => sdk.decodeAcceptedObservation(item.receipt)),
            ),
          }),
          occurrences,
        };
        const broadened = structuredClone(admitted.projection);
        (
          (broadened.usage as Record<string, unknown>).sourceRead as {
            sourceRefs: unknown[];
          }
        ).sourceRefs.push({ kind: "occurrence", value: "unselected-root" });
        await expect(
          f.c.run(() => f.bridge.admitted({ ...admitted, projection: broadened })),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_scope_changed" },
        });
        f.setContactUnavailable(true);
        await expect(f.c.run(() => f.bridge.admitted(admitted))).rejects.toThrow();
        f.setContactUnavailable(false);
        await f.c.run(() => f.bridge.admitted(admitted));
        expect(f.recordContact.mock.calls.at(-1)?.[0]).toMatchObject({
          messageRefs: f.messageRefs,
          contactId: f.input.contactRequestId,
        });
        expect((await f.bridge.readRun(f.input.native.runId))?.appliedUsage).toEqual(
          sdk.encodeCognitionUsage(sdk.decodeProjection(admitted.projection).usage!),
        );
        expect((await f.bridge.readRun(f.input.native.runId))?.consumerId).toBe(
          "consumer:fixture",
        );
        const rows = await readRepositorySql<{ document: unknown }>(
          f.c.persistence,
          "SELECT document FROM heptalogos.life_native_input",
        );
        expect(JSON.stringify(rows)).not.toContain(f.registration.prompt);
        await expect(
          f.c.run(() =>
            f.bridge.prepare({
              ...f.input,
              native: { ...f.input.native, sessionId: "another-session" },
              contactRequestId: randomUUID(),
              invocationId: "model:3",
            }),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_run_changed" },
        });
        f.revoke();
        await expect(
          f.c.run(() =>
            f.bridge.prepare({
              ...f.input,
              contactRequestId: randomUUID(),
              invocationId: "model:revoked",
            }),
          ),
        ).rejects.toThrow();
        expect(
          await readRepositorySql(
            f.c.persistence,
            "SELECT contact_request_id FROM heptalogos.life_native_contact WHERE invocation_id='model:revoked'",
          ),
        ).toEqual([]);
      } finally {
        await f.c.close();
      }
    }, 120000);

    it("keeps pending actual results and original scope after cancellation, replays first observations, and never overwrites accepted receipts", async () => {
      const f = await fixture();
      try {
        const response = await f.c.run(() => f.bridge.prepare(f.input));
        const applied = await admitSelected(f, response);
        const actual = sdk.encodeObservationInput({
          subjectId: f.input.subjectId,
          sessionId: f.input.nousSessionId,
          requestId: randomUUID(),
          sourceClass: "tool",
          observedAt: sdk.timestampFromDate(new Date()),
          material: {
            case: "inlineText",
            value: {
              text: '{"actual_result":"already written"}',
              mediaType: "application/json",
            },
          },
          context: { tool_call_id: "actual-tool" },
        });
        const pending = { ...f.input, stage: "pending" as const, observation: actual };
        delete (pending as Partial<typeof pending>).promptDigest;
        const first = await f.c.run(() => f.bridge.feedback(pending));
        expect(first.stage).toBe("pending");
        const current = (await f.life.get(f.input.subjectId, f.activity.activityId))!;
        await f.c.run(() =>
          f.life.transition({
            subjectId: f.input.subjectId,
            activityId: f.activity.activityId,
            expectedRevision: current.revision,
            action: "cancel",
            reason: "The actual tool already finished",
          }),
        );
        const later = {
          ...pending,
          observation: {
            ...actual,
            observedAt: new Date(Date.now() + 1000).toISOString(),
          },
        };
        expect(await f.c.run(() => f.bridge.feedback(later))).toEqual(first);
        if (first.stage !== "pending")
          throw new Error("Expected retained pending fact");
        expect(first.observation.context).toMatchObject({
          activity_ref: f.activity.activityId,
          cognition_usage: sdk.encodeCognitionUsage(applied),
        });
        f.setNousUnavailable(true);
        await expect(f.c.run(() => f.bridge.flushPendingFeedback(8))).rejects.toThrow();
        let rows = await readRepositorySql<{ delivered_at: unknown }>(
          f.c.persistence,
          "SELECT delivered_at FROM heptalogos.cognition_pending_feedback",
        );
        expect(rows[0]!.delivered_at).toBeNull();
        f.setNousUnavailable(false);
        expect(await f.c.run(() => f.bridge.flushPendingFeedback(8))).toEqual({
          delivered: 1,
        });
        expect(await f.c.run(() => f.bridge.flushPendingFeedback(8))).toEqual({
          delivered: 0,
        });
        expect(f.submissions).toEqual([first.observation]);
        const bad = {
          ...f.input,
          stage: "committed" as const,
          observationRequestId: actual.requestId,
          receipt: sdk.encodeAcceptedObservation({ occurrenceId: randomUUID() }),
        };
        delete (bad as Partial<typeof bad>).promptDigest;
        await expect(f.c.run(() => f.bridge.feedback(bad))).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_receipt_changed" },
        });
        rows = await readRepositorySql(
          f.c.persistence,
          "SELECT delivered_at FROM heptalogos.cognition_pending_feedback",
        );
        expect(rows[0]!.delivered_at).not.toBeNull();
      } finally {
        await f.c.close();
      }
    }, 120000);

    it("admits identical prompts in a fresh native run after RESET without rebinding the old run", async () => {
      const f = await fixture();
      try {
        await f.c.run(() => f.bridge.prepare(f.input));
        await expect(
          f.c.run(() =>
            f.bridge.prepare({
              ...f.input,
              nousSessionId: randomUUID(),
              contactRequestId: randomUUID(),
              invocationId: "rebind-old-run",
            }),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_run_changed" },
        });
        await f.c.run(() => f.bridge.finishRun(f.input.native.runId, "completed"));
        const nativeRunId = randomUUID();
        const next = {
          ...f.registration,
          nativeRunId,
          contacts: f.registration.contacts.map((contact) => ({
            ...contact,
            observation: sdk.encodeObservationInput({
              ...sdk.decodeObservationInput(contact.observation),
              requestId: randomUUID(),
            }),
          })),
        };
        const registered = await f.c.run(() => f.bridge.registerInput(next));
        expect(registered.promptDigest).toBe(f.input.promptDigest);
        const freshInput = {
          ...f.input,
          nousSessionId: randomUUID(),
          contactRequestId: randomUUID(),
          invocationId: "fresh-run-after-reset",
          native: {
            ...f.input.native,
            runId: nativeRunId,
            sessionId: "native-session-after-reset",
            historyGeneration: "history-after-reset",
          },
        };
        const response = await f.c.run(() => f.bridge.prepare(freshInput));
        expect(response.contacts).toHaveLength(2);
        expect(response.contacts[0]!.observation).not.toEqual(
          f.registration.contacts[0]!.observation,
        );
        expect((await f.bridge.readRun(nativeRunId))?.nousSessionId).toBe(
          freshInput.nousSessionId,
        );
        expect((await f.bridge.readRun(f.input.native.runId))?.state).toBe("completed");
        await expect(
          f.c.run(() =>
            f.bridge.registerInput({ ...next, prompt: "different prompt" }),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_input_conflict" },
        });
      } finally {
        await f.c.close();
      }
    }, 120000);

    it("requires the actual running parent even when another run shares its session, gives isolated children only worker scope, and refuses malformed public protobuf JSON", async () => {
      const f = await fixture();
      try {
        const response = await f.c.run(() => f.bridge.prepare(f.input));
        const applied = await admitSelected(f, response);
        const handoff = {
          version: 1 as const,
          requestId: randomUUID(),
          subjectId: f.input.subjectId,
          parentSessionKey: f.input.native.sessionKey,
          parentSessionId: f.input.native.sessionId,
          parentRunId: f.input.native.runId,
          parentNousSessionId: f.input.nousSessionId,
          childSessionKey: "native:child",
          childSessionId: "native-child",
          childNousSessionId: randomUUID(),
          contextMode: "isolated" as const,
        };
        await f.c.run(() => f.bridge.handoff(handoff));
        const child = {
          ...f.input,
          contactRequestId: randomUUID(),
          invocationId: "child:1",
          nousSessionId: handoff.childNousSessionId,
          promptDigest: "a".repeat(64),
          native: {
            sessionKey: handoff.childSessionKey,
            sessionId: handoff.childSessionId,
            historyGeneration: "child-history",
            agentId: "main",
            runId: randomUUID(),
            parentSessionKey: handoff.parentSessionKey,
          },
        };
        const inherited = await f.c.run(() => f.bridge.prepare(child));
        expect(inherited.contacts).toEqual([]);
        expect(sdk.decodeCognitionUsage(inherited.usage).sourceRead).toEqual(
          applied.sourceRead,
        );
        expect(sdk.decodeCognitionUsage(inherited.usage).purpose).toBe("worker");
        expect((await f.bridge.readRun(child.native.runId))?.registration.role).toBe(
          "worker",
        );
        const otherRunId = randomUUID();
        await f.c.run(() =>
          f.bridge.registerInput({ ...f.registration, nativeRunId: otherRunId }),
        );
        await f.c.run(() =>
          f.bridge.prepare({
            ...f.input,
            native: { ...f.input.native, runId: otherRunId },
            contactRequestId: randomUUID(),
            invocationId: "other-run:1",
          }),
        );
        await expect(
          f.c.run(() =>
            f.bridge.handoff({
              ...handoff,
              parentRunId: randomUUID(),
              childSessionKey: "wrong-parent-run-child",
              requestId: randomUUID(),
            }),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_parent_changed" },
        });
        await f.c.run(() =>
          f.bridge.handoff({
            ...handoff,
            childSessionKey: "same-session-exact-parent",
            requestId: randomUUID(),
          }),
        );
        const malformed = {
          ...f.input,
          projection: { unknownAuthority: true },
          occurrences: [],
        };
        delete (malformed as Partial<typeof malformed>).promptDigest;
        await expect(f.c.run(() => f.bridge.admitted(malformed))).rejects.toMatchObject(
          { problem: { problemCode: "gateway.invalid_input", category: "validation" } },
        );
        await f.c.run(() => f.bridge.finishRun(f.input.native.runId, "cancelled"));
        await expect(
          f.c.run(() =>
            f.bridge.prepare({
              ...child,
              contactRequestId: randomUUID(),
              invocationId: "child:2",
            }),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_parent_changed" },
        });
      } finally {
        await f.c.close();
      }
    }, 120000);
  },
);

real("mandatory native tool execution admission", () => {
  it("requires an admitted exact invocation and rechecks current authority at both execution phases", async () => {
    const f = await fixture();
    try {
      const prepared = await f.c.run(() => f.bridge.prepare(f.input));
      expect(prepared.allowedToolNames).toEqual(["read"]);
      const identity = sdk.hostContactIdentitySchema.strip().parse(f.input);
      const request = {
        ...identity,
        toolName: "read",
        toolCallId: "actual:1",
        phase: "prepare" as const,
      };
      await expect(
        f.c.run(() => f.bridge.toolExecution(request)),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_tool_unavailable" },
      });
      const usage = await admitSelected(f, prepared);
      expect(await f.c.run(() => f.bridge.toolExecution(request))).toMatchObject({
        allowed: true,
        usage: sdk.encodeCognitionUsage(usage),
      });
      await expect(
        f.c.run(() => f.bridge.toolExecution({ ...request, toolName: "exec" })),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_tool_denied" },
      });
      await expect(
        f.c.run(() => f.bridge.toolExecution({ ...request, invocationId: "forged" })),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_contact_changed" },
      });
      expect(
        await f.c.run(() => f.bridge.toolExecution({ ...request, phase: "execute" })),
      ).toMatchObject({ allowed: true, usage: sdk.encodeCognitionUsage(usage) });
      f.revoke();
      await expect(
        f.c.run(() => f.bridge.toolExecution({ ...request, phase: "execute" })),
      ).rejects.toThrow();
      await f.c.run(() => f.bridge.finishRun(f.input.native.runId, "cancelled"));
      await expect(
        f.c.run(() => f.bridge.toolExecution(request)),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_tool_unavailable" },
      });
    } finally {
      await f.c.close();
    }
  }, 120000);
});

real("physical delivery feedback", () => {
  it("keeps one exact receipt pending while Nous is offline and commits its real result once after recovery", async () => {
    const f = await fixture();
    try {
      const response = await f.c.run(() => f.bridge.prepare(f.input));
      await admitSelected(f, response);
      const fact = {
        subjectId: f.input.subjectId,
        activityId: f.activity.activityId,
        runId: f.input.native.runId,
        reference: randomUUID(),
        nativeIntentId: "actual-final-intent",
        channel: "heptalogos-qq",
        accountId: "bot",
        to: "group:target",
        sourceIndex: 0,
        partIndex: 0,
        attemptId: randomUUID(),
        recordedAt: new Date().toISOString(),
        outcome: {
          state: "accepted" as const,
          platformMessageId: "90071992547409939999",
          acceptedAt: new Date().toISOString(),
        },
      };
      f.setNousUnavailable(true);
      await f.c.run(() => f.bridge.recordDeliveryFact(fact));
      await f.c.run(() => f.bridge.recordDeliveryFact(fact));
      const pending = await readRepositorySql<{
        document: { observation: Record<string, unknown> };
        receipt: unknown;
      }>(
        f.c.persistence,
        "SELECT document,receipt FROM heptalogos.cognition_pending_feedback WHERE run_id=$1",
        [fact.runId],
      );
      expect(pending).toHaveLength(1);
      expect(pending[0]!.receipt).toBeNull();
      const observed = sdk.decodeObservationInput(pending[0]!.document.observation);
      expect(observed.sourceClass).toBe("host_event");
      expect(observed.externalObjectRef).toBe(
        "object:heptalogos:delivery:" + fact.attemptId,
      );
      expect(observed.actorEntityRef).toBe(f.actor);
      expect(observed.conversationRef).toBe("conversation:qq:registered");
      expect(observed.context!.outcome_state).toBe("accepted");
      f.setNousUnavailable(false);
      await f.c.run(() => f.bridge.finishRun(fact.runId, "completed"));
      expect(await f.c.run(() => f.bridge.flushPendingFeedback(32))).toEqual({
        delivered: 1,
      });
      expect(await f.c.run(() => f.bridge.flushPendingFeedback(32))).toEqual({
        delivered: 0,
      });
      expect(f.submissions).toHaveLength(1);
      expect(
        JSON.parse(sdk.decodeObservationInput(f.submissions[0]).material.value.text)
          .outcome.platformMessageId,
      ).toBe(fact.outcome.platformMessageId);
    } finally {
      await f.c.close();
    }
  }, 120000);
});
