// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLifeService } from "@heptalogos/subject";
import {
  readRepositorySql,
  executeRepositorySql,
  useRepositoryMutationTransaction,
} from "@heptalogos/persistence/repository";
import {
  createNativeCognitionBridge,
  type NativeCognitionOptions,
} from "../../../packages/application/product-host/src/native-cognition.js";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
import type { NativeLifeResponse } from "../../../packages/application/product-host/src/native-life-contracts.js";
function activityLife(value: NativeLifeResponse) {
  if ("revision" in value) return value;
  throw Error("Expected the actual Activity response for inspect/progress");
}
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
async function fixture(
  tools = ["read"],
  readLife?: NativeCognitionOptions["readLife"],
) {
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
    tools,
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
  let externalCheck: () => Promise<void> = async () => {};
  let revoked = false;
  const bridge = createNativeCognitionBridge({
    persistence: c.persistence,
    life,
    now,
    captureObservedStamp: async () => {
      const at = sdk.timestampFromDate(new Date());
      return sdk.decodeObservationInput(
        sdk.encodeObservationInput({
          observedStamp: { timeDomainRef: "time:real", at, recordedAt: at },
        }),
      ).observedStamp!;
    },
    ...(readLife ? { readLife } : {}),
    resolveChildProviderPolicy: async () => ({
      tokenBudget: { inputTokens: 8192, outputTokens: 2048 },
      allowedToolNames: tools,
    }),
    checkInput: async () => externalCheck(),
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
    tokenBudget: { inputTokens: 8192, outputTokens: 2048 },
    allowedToolNames: tools,
    roleScope: {
      role: "subject.deliberation" as const,
      purpose: "subject_deliberation" as const,
      view: "subject" as const,
      contactNature: "subject_experience" as const,
    },
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
    setExternalCheck: (check: () => Promise<void>) => {
      externalCheck = check;
    },
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
          childNativeAgentId: "main",
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
        expect(sdk.decodeCognitionUsage(inherited.usage).purpose).toBe(
          "professional_execution",
        );
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
              childNativeAgentId: "main",
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
            childNativeAgentId: "main",
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
      const renderRunId = randomUUID(),
        renderSessionKey = "native:render:" + randomUUID();
      const renderer = {
        ...f.registration,
        parentRunId: f.input.native.runId,
        nativeRunId: renderRunId,
        sessionKey: renderSessionKey,
        roleScope: {
          role: "subject.render" as const,
          purpose: "subject_rendering" as const,
          view: "renderer" as const,
          contactNature: "execution_only" as const,
        },
        contacts: [],
        messageRefs: [],
      };
      await expect(
        f.c.run(() =>
          f.bridge.registerInput({
            ...renderer,
            nativeRunId: randomUUID(),
            sourceRefs: [...renderer.sourceRefs, "message:unadopted"],
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_parent_sources_denied" },
      });
      const selected = await f.c.run(() => f.bridge.registerInput(renderer));
      const renderInput = {
        ...f.input,
        nousSessionId: randomUUID(),
        contactRequestId: randomUUID(),
        invocationId: "renderer-output",
        promptDigest: selected.promptDigest,
        native: {
          ...f.input.native,
          sessionKey: renderSessionKey,
          sessionId: randomUUID(),
          runId: renderRunId,
        },
      };
      const renderPrepared = await f.c.run(() => f.bridge.prepare(renderInput));
      expect(renderPrepared.contacts).toEqual([]);
      expect(renderPrepared.allowedToolNames).toEqual([]);
      await admitSelected({ ...f, input: renderInput }, renderPrepared);
      const firstApplied = await f.bridge.readAppliedContext(renderRunId);
      expect(firstApplied).toMatchObject({
        runId: renderRunId,
        contactRequestId: renderInput.contactRequestId,
        roleScope: renderer.roleScope,
      });
      expect(sdk.decodeProjection(firstApplied.projection).usage).toEqual(
        sdk.decodeCognitionUsage(firstApplied.usage),
      );
      const secondInput = {
        ...renderInput,
        contactRequestId: randomUUID(),
        invocationId: "renderer-next-actual-step",
      };
      const secondPrepared = await f.c.run(() => f.bridge.prepare(secondInput));
      const secondProjection = sdk.encodeProjection({
        projectionId: randomUUID(),
        consumerId: "consumer:fixture",
        subjectId: secondInput.subjectId,
        sessionId: secondInput.nousSessionId,
        usage: sdk.decodeCognitionUsage(secondPrepared.usage),
        segments: [
          {
            segmentId: "actual-current",
            domain: "runtime",
            text: "ACTUAL NOUS PROJECTION",
          },
        ],
      });
      await f.c.run(() =>
        f.bridge.admitted({
          ...sdk.hostContactIdentitySchema.strip().parse(secondInput),
          projection: secondProjection,
          occurrences: [],
        }),
      );
      await f.c.run(() =>
        f.bridge.admitted({
          ...sdk.hostContactIdentitySchema.strip().parse(renderInput),
          projection: firstApplied.projection,
          occurrences: [],
        }),
      );
      expect((await f.bridge.readAppliedContext(renderRunId)).projection).toEqual(
        secondProjection,
      );
      const rawResultId = randomUUID();
      const raw = await f.c.run(() =>
        f.bridge.feedback({
          ...sdk.hostContactIdentitySchema.strip().parse(renderInput),
          stage: "pending",
          observation: sdk.encodeObservationInput({
            subjectId: f.input.subjectId,
            sessionId: renderInput.nousSessionId,
            requestId: rawResultId,
            sourceClass: "generated",
            observedAt: sdk.timestampFromDate(new Date()),
            material: {
              case: "inlineText",
              value: { text: "RAW RENDERER DRAFT", mediaType: "text/plain" },
            },
          }),
        }),
      );
      expect(raw).toMatchObject({ retainedOnly: true });
      const fact = {
        subjectId: f.input.subjectId,
        activityId: f.activity.activityId,
        runId: renderRunId,
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
      expect(observed.context!.contact_nature).toBe("subject_experience");
      expect(
        sdk.decodeCognitionUsage(observed.context!.cognition_usage).contactNature,
      ).toBe("subject_experience");
      expect(
        (await f.bridge.readRoleResults(f.input.subjectId, renderRunId)).results.map(
          (r) => r.resultId,
        ),
      ).toEqual([rawResultId]);
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

real("native external checks do not occupy the fenced input transaction", () => {
  it("allows a real Life pause while NoUS checking is blocked and rejects stale final model admission", async () => {
    const f = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      f.setExternalCheck(async () => {
        entered();
        await gate;
      });
      const admission = f.c.run(() => f.bridge.prepare(f.input));
      await waiting;
      const paused = await Promise.race([
        f.c.run(() =>
          f.life.transition({
            subjectId: f.activity.subjectId,
            activityId: f.activity.activityId,
            expectedRevision: f.activity.revision,
            action: "pause",
            reason: "Actual cancellation while NoUS preflight is pending",
          }),
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(Error("External check retained the Activity write lock")),
            2000,
          ),
        ),
      ]);
      expect(paused.state).toBe("paused");
      release();
      await expect(admission).rejects.toBeDefined();
      const rows = await readRepositorySql<{ count: number }>(
        f.c.persistence,
        "SELECT count(*)::integer AS count FROM heptalogos.life_native_contact WHERE run_id=$1",
        [f.input.native.runId],
      );
      expect(rows[0]!.count).toBe(0);
    } finally {
      release?.();
      await f.c.close();
    }
  }, 120000);
});

real("native Life bound to the current admitted run", () => {
  it("uses admitted owner reads without a new external root and fences permission changes", async () => {
    let duringRead = async () => {};
    const readLife = vi.fn<NonNullable<NativeCognitionOptions["readLife"]>>(
      async (_binding, request) => {
        await duringRead();
        return {
          action: request.action,
          retrievalOnly: true,
          sourceRefs: ["claim:canonical"],
          data: { existing: true },
        };
      },
    );
    const f = await fixture(["heptalogos_life"], readLife);
    try {
      const prepared = await f.c.run(() => f.bridge.prepare(f.input));
      await admitSelected(f, prepared);
      const base = {
        nativeRunId: f.input.native.runId,
        activityRef: f.activity.activityId,
        nativeAgentId: f.input.native.agentId,
        sessionKey: f.input.native.sessionKey,
        sessionId: f.input.native.sessionId,
        toolCallId: "actual-read",
        request: { action: "epistemic" as const },
      };
      await expect(f.c.run(() => f.bridge.life(base))).resolves.toMatchObject({
        retrievalOnly: true,
      });
      expect(readLife.mock.calls[0]![0]).toMatchObject({
        subjectId: f.input.subjectId,
        nativeRunId: f.input.native.runId,
        role: "subject.deliberation",
        admittedProjection: { consumerId: "consumer:fixture" },
      });
      const pending = await f.c.run(() =>
        f.bridge.feedback({
          ...sdk.hostContactIdentitySchema.strip().parse(f.input),
          stage: "pending",
          observation: sdk.encodeObservationInput({
            requestId: randomUUID(),
            subjectId: f.input.subjectId,
            sessionId: f.input.nousSessionId,
            sourceClass: "tool",
            observedAt: sdk.timestampFromDate(new Date()),
            context: { tool_name: "heptalogos_life", tool_call_id: "actual-read" },
            material: {
              case: "inlineText",
              value: { text: "existing owner projection", mediaType: "text/plain" },
            },
          }),
        }),
      );
      expect(pending).toMatchObject({ retainedOnly: true });
      const forged = await f.c.run(() =>
        f.bridge.feedback({
          ...sdk.hostContactIdentitySchema.strip().parse(f.input),
          stage: "pending",
          observation: sdk.encodeObservationInput({
            requestId: randomUUID(),
            subjectId: f.input.subjectId,
            sessionId: f.input.nousSessionId,
            sourceClass: "tool",
            observedAt: sdk.timestampFromDate(new Date()),
            context: {
              tool_name: "heptalogos_life",
              tool_call_id: "toString",
              retrievalOnly: true,
            },
            material: {
              case: "inlineText",
              value: { text: "unproven read payload", mediaType: "text/plain" },
            },
          }),
        }),
      );
      expect(forged).toMatchObject({ retainedOnly: false });
      expect(f.recordObservation).not.toHaveBeenCalled();
      duringRead = async () => {
        f.revoke();
      };
      await expect(
        f.c.run(() => f.bridge.life({ ...base, toolCallId: "revoked-read" })),
      ).rejects.toBeDefined();
    } finally {
      await f.c.close();
    }
  }, 120000);
  it("records only Host selected/committed references, preserves active mode, and fences stale/cross-run/grant changes", async () => {
    const f = await fixture(["read", "heptalogos_life"]);
    try {
      const prepared = await f.c.run(() => f.bridge.prepare(f.input));
      await admitSelected(f, prepared);
      const base = {
        nativeRunId: f.input.native.runId,
        activityRef: f.activity.activityId,
        nativeAgentId: f.input.native.agentId,
        sessionKey: f.input.native.sessionKey,
        sessionId: f.input.native.sessionId,
        toolCallId: "actual-sdk-life-call",
      };
      const view = await f.c
        .run(() => f.bridge.life({ ...base, request: { action: "inspect" } }))
        .then(activityLife);
      for (const bad of [
        { nativeRunId: randomUUID() },
        { activityRef: randomUUID() },
        { sessionId: "other-native-session" },
        { nativeAgentId: "worker" },
        { sessionKey: "another-run" },
      ])
        await expect(
          f.c.run(() =>
            f.bridge.life({ ...base, ...bad, request: { action: "inspect" } }),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_life_unavailable" },
        });
      await expect(
        f.c.run(() =>
          f.bridge.life({
            ...base,
            request: { action: "inspect", sourceRefs: ["invented"] } as never,
          }),
        ),
      ).rejects.toBeDefined();
      await expect(
        f.c.run(() =>
          f.bridge.life({
            ...base,
            request: {
              action: "progress",
              note: "claim",
              expectedRevision: view.revision,
              mode: "rest",
              nextOpportunity: {
                timeDomainRef: "wrong-world",
                at: new Date().toISOString(),
              },
            },
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "life.time_domain_unavailable" },
      });
      // An actual committed tool fact, not its text, is the only added result evidence.
      const observationRequestId = randomUUID(),
        occurrenceId = randomUUID(),
        artifactId = randomUUID();
      await f.c.run(() =>
        f.bridge.feedback({
          ...sdk.hostContactIdentitySchema.strip().parse(f.input),
          stage: "pending",
          observation: sdk.encodeObservationInput({
            requestId: observationRequestId,
            subjectId: f.input.subjectId,
            sessionId: f.input.nousSessionId,
            sourceClass: "tool",
            observedAt: sdk.timestampFromDate(new Date()),
            material: {
              case: "inlineText",
              value: { text: "ACTUAL SYNTHETIC TOOL RESULT", mediaType: "text/plain" },
            },
          }),
        }),
      );
      await f.c.run(() =>
        f.bridge.feedback({
          ...sdk.hostContactIdentitySchema.strip().parse(f.input),
          stage: "committed",
          observationRequestId,
          receipt: sdk.encodeAcceptedObservation({ occurrenceId, artifactId }),
        }),
      );
      const progress = {
        action: "progress" as const,
        note: "I am resting until the next point",
        expectedRevision: view.revision,
        mode: "rest" as const,
        nextOpportunity: {
          timeDomainRef: view.world.timeDomainRef,
          at: new Date(Date.now() + 60000).toISOString(),
        },
      };
      const result = await f.c
        .run(() => f.bridge.life({ ...base, request: progress }))
        .then(activityLife);
      expect(result).toMatchObject({
        state: "active",
        mode: "rest",
        progress: {
          note: "Subject progress statement: " + progress.note,
          sourceRefs: f.registration.sourceRefs,
          artifactRefs: ["artifact:" + artifactId],
          resultRefs: ["occurrence:" + occurrenceId],
        },
      });
      await expect(
        f.c.run(() => f.bridge.life({ ...base, request: progress })),
      ).rejects.toMatchObject({ problem: { problemCode: "life.conflict" } });
      expect(
        (
          await f.c
            .run(() => f.bridge.life({ ...base, request: { action: "inspect" } }))
            .then(activityLife)
        ).revision,
      ).toBe(result.revision);
      // External checks finish outside the mutation fence; a revocation during them wins locally.
      f.setExternalCheck(async () => {
        f.revoke();
      });
      await expect(
        f.c.run(() =>
          f.bridge.life({
            ...base,
            request: { ...progress, expectedRevision: result.revision },
          }),
        ),
      ).rejects.toBeDefined();
      expect(
        (await f.life.get(f.input.subjectId, f.activity.activityId))?.revision,
      ).toBe(result.revision);
    } finally {
      await f.c.close();
    }
  }, 120000);
});

real("native child completion causality", () => {
  it("releases an admitted terminal direct execution RoleRun through its exact registered parent without a native handoff", async () => {
    const f = await fixture();
    try {
      await admitSelected(f, await f.c.run(() => f.bridge.prepare(f.input)));
      const createDirect = async (
        role: "subject.execution" | "subject.render",
        admitted = true,
        selectedRunId = randomUUID(),
      ) => {
        const nativeRunId = selectedRunId,
          sessionKey = "native:direct-role:" + randomUUID();
        const registered = await f.c.run(() =>
          f.bridge.registerInput({
            ...f.registration,
            parentRunId: f.input.native.runId,
            nativeRunId,
            sessionKey,
            prompt: "Actual bounded direct role result",
            roleScope:
              role === "subject.execution"
                ? {
                    role,
                    purpose: "professional_execution",
                    view: "worker",
                    contactNature: "execution_only",
                  }
                : {
                    role,
                    purpose: "subject_rendering",
                    view: "renderer",
                    contactNature: "execution_only",
                  },
            usage: sdk.decodeCognitionUsage({
              purpose: "professional_execution",
              sourceRead: { subjectId: f.input.subjectId, sourceRefs: [] },
              audience: {
                visibility: "group",
                conversationRef: "conversation:qq:registered",
              },
            }),
            sourceRefs: [],
            messageRefs: [],
            contacts: [],
          }),
        );
        const input = {
          ...f.input,
          contactRequestId: randomUUID(),
          invocationId: "direct:1",
          nousSessionId: randomUUID(),
          promptDigest: registered.promptDigest,
          native: {
            ...f.input.native,
            runId: nativeRunId,
            sessionKey,
            sessionId: randomUUID(),
            historyGeneration: randomUUID(),
          },
        };
        const prepared = await f.c.run(() => f.bridge.prepare(input));
        expect(prepared.contacts).toEqual([]);
        if (admitted) await admitSelected({ ...f, input }, prepared);
        const resultId = randomUUID();
        const pending = await f.c.run(() =>
          f.bridge.feedback({
            ...sdk.hostContactIdentitySchema.strip().parse(input),
            stage: "pending",
            observation: sdk.encodeObservationInput({
              subjectId: f.input.subjectId,
              sessionId: input.nousSessionId,
              requestId: resultId,
              sourceClass: "generated",
              observedAt: sdk.timestampFromDate(new Date()),
              material: {
                case: "inlineText",
                value: {
                  text: "IMMUTABLE DIRECT ROLE RESULT",
                  mediaType: "text/plain",
                },
              },
            }),
          }),
        );
        expect(pending).toMatchObject({ retainedOnly: true });
        return {
          input,
          resultId,
          release: {
            version: 1 as const,
            requestId: randomUUID(),
            subjectId: f.input.subjectId,
            parentRunId: f.input.native.runId,
            childRunId: nativeRunId,
            resultIds: [resultId],
          },
        };
      };
      const direct = await createDirect("subject.execution");
      await expect(
        f.c.run(() => f.bridge.releaseResult(direct.release)),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_result_release_denied" },
      });
      const terminal = {
        ...sdk.hostContactIdentitySchema.strip().parse(direct.input),
        outcome: "completed" as const,
        endedAt: "2026-01-01T00:00:00.000Z",
      };
      const terminalReceipt = await f.c.run(() => f.bridge.runTerminal(terminal));
      expect(terminalReceipt).toMatchObject({
        accepted: true,
        ready: true,
        resultRetained: true,
      });
      const firstReady = await f.bridge.readyResults({
        subjectId: f.input.subjectId,
        limit: 128,
      });
      expect(firstReady.runs.map((value) => value.runId)).toContain(
        direct.input.native.runId,
      );
      const recordedAt = firstReady.runs.find(
        (value) => value.runId === direct.input.native.runId,
      )!.terminalAt;
      expect(recordedAt).not.toBe(terminal.endedAt);
      expect(await f.c.run(() => f.bridge.runTerminal(terminal))).toEqual(
        terminalReceipt,
      );
      expect(
        (
          await f.bridge.readyResults({ subjectId: f.input.subjectId, limit: 128 })
        ).runs.find((value) => value.runId === direct.input.native.runId)!.terminalAt,
      ).toBe(recordedAt);
      await expect(
        f.c.run(() =>
          f.bridge.runTerminal({ ...terminal, endedAt: "2026-01-02T00:00:00.000Z" }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_terminal_changed" },
      });
      const later = await createDirect(
        "subject.execution",
        true,
        "00000000-0000-4000-8000-000000000001",
      );
      await f.c.run(() =>
        f.bridge.runTerminal({
          ...sdk.hostContactIdentitySchema.strip().parse(later.input),
          outcome: "completed",
          endedAt: "2025-01-01T00:00:00.000Z",
        }),
      );
      expect(
        (
          await f.bridge.readyResults({
            subjectId: f.input.subjectId,
            limit: 128,
            afterRunId: direct.input.native.runId,
          })
        ).runs.map((value) => value.runId),
      ).toContain(later.input.native.runId);
      expect(f.recordObservation).not.toHaveBeenCalled();
      expect(
        await readRepositorySql(
          f.c.persistence,
          "SELECT child_session_key FROM heptalogos.life_handoff WHERE child_session_key=$1",
          [direct.input.native.sessionKey],
        ),
      ).toEqual([]);
      const unadmitted = await createDirect("subject.execution", false);
      await f.c.run(() =>
        f.bridge.finishRun(unadmitted.input.native.runId, "completed"),
      );
      await expect(
        f.c.run(() => f.bridge.releaseResult(unadmitted.release)),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_result_release_denied" },
      });
      const renderer = await createDirect("subject.render");
      await f.c.run(() => f.bridge.finishRun(renderer.input.native.runId, "completed"));
      await expect(
        f.c.run(() => f.bridge.releaseResult(renderer.release)),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_result_release_denied" },
      });
      let drift = true;
      const alteredParent = randomUUID();
      f.setExternalCheck(async () => {
        if (!drift) return;
        drift = false;
        await f.c.persistence.mutate((ctx) =>
          useRepositoryMutationTransaction(ctx, (tx) =>
            executeRepositorySql(
              tx,
              "UPDATE heptalogos.life_native_run SET document=jsonb_set(document,'{registration,parentRunId}',to_jsonb($2::text)) WHERE run_id=$1",
              [direct.input.native.runId, alteredParent],
            ),
          ),
        );
      });
      await expect(
        f.c.run(() => f.bridge.releaseResult(direct.release)),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_result_release_denied" },
      });
      f.setExternalCheck(async () => {});
      await f.c.run(() =>
        f.c.persistence.mutate((ctx) =>
          useRepositoryMutationTransaction(ctx, (tx) =>
            executeRepositorySql(
              tx,
              "UPDATE heptalogos.life_native_run SET document=jsonb_set(document,'{registration,parentRunId}',to_jsonb($2::text)) WHERE run_id=$1",
              [direct.input.native.runId, f.input.native.runId],
            ),
          ),
        ),
      );
      expect(
        await f.bridge.readResultParent(f.input.subjectId, direct.release.childRunId),
      ).toBe(f.input.native.runId);
      const released = await f.c.run(() => f.bridge.releaseResult(direct.release));
      expect(
        (
          await f.bridge.readyResults({ subjectId: f.input.subjectId, limit: 128 })
        ).runs.map((value) => value.runId),
      ).toContain(direct.input.native.runId);
      expect(await f.c.run(() => f.bridge.releaseResult(direct.release))).toEqual(
        released,
      );
      expect(released).toMatchObject({
        contactNature: "subject_experience",
        opportunity: {
          kind: "activity_result",
          parentRunId: f.input.native.runId,
          childRunId: direct.input.native.runId,
        },
      });
      expect(
        await f.bridge.readResultRelease(f.input.subjectId, direct.release.requestId),
      ).toEqual(released);
      expect(
        await f.bridge.readResultRelease(randomUUID(), direct.release.requestId),
      ).toBeUndefined();
      const lateResultId = randomUUID();
      await f.c.run(() =>
        f.bridge.feedback({
          ...sdk.hostContactIdentitySchema.strip().parse(direct.input),
          stage: "pending",
          observation: sdk.encodeObservationInput({
            subjectId: f.input.subjectId,
            sessionId: direct.input.nousSessionId,
            requestId: lateResultId,
            sourceClass: "generated",
            observedAt: sdk.timestampFromDate(new Date()),
            material: {
              case: "inlineText",
              value: { text: "LATE ACTUAL FEEDBACK", mediaType: "text/plain" },
            },
          }),
        }),
      );
      expect(
        (await f.bridge.readRoleResults(f.input.subjectId, direct.input.native.runId))
          .results,
      ).toHaveLength(2);
      expect(
        await f.bridge.readResultRelease(f.input.subjectId, direct.release.requestId),
      ).toEqual(released);
      await expect(
        f.c.run(() =>
          f.bridge.releaseResult({
            ...direct.release,
            resultIds: [direct.resultId, lateResultId],
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_result_release_changed" },
      });
      expect(JSON.stringify(released.contacts)).toContain(
        "IMMUTABLE DIRECT ROLE RESULT",
      );
      expect(f.recordObservation).not.toHaveBeenCalled();
      const subjectRun = randomUUID(),
        subjectSession = "native:released-direct:" + randomUUID();
      const registered = await f.c.run(() =>
        f.bridge.registerInput({
          ...f.registration,
          nativeRunId: subjectRun,
          sessionKey: subjectSession,
          prompt: "Deliberate on this explicitly released professional result",
          sourceRefs: released.contacts.map((contact) => contact.contactRef),
          messageRefs: [],
          contacts: released.contacts,
        }),
      );
      const subjectInput = {
        ...f.input,
        contactRequestId: randomUUID(),
        invocationId: "direct-result:subject",
        promptDigest: registered.promptDigest,
        native: {
          ...f.input.native,
          runId: subjectRun,
          sessionKey: subjectSession,
          sessionId: randomUUID(),
          historyGeneration: randomUUID(),
        },
      };
      const selected = await f.c.run(() => f.bridge.prepare(subjectInput));
      expect(selected.contacts).toHaveLength(1);
      await admitSelected({ ...f, input: subjectInput }, selected);
      expect(
        (
          await f.bridge.readyResults({ subjectId: f.input.subjectId, limit: 128 })
        ).runs.map((value) => value.runId),
      ).not.toContain(direct.input.native.runId);
      expect((await f.bridge.readAppliedContext(subjectRun)).roleScope.role).toBe(
        "subject.deliberation",
      );
      expect(
        await readRepositorySql(
          f.c.persistence,
          "SELECT child_session_key FROM heptalogos.life_handoff WHERE child_session_key=$1",
          [direct.input.native.sessionKey],
        ),
      ).toEqual([]);
    } finally {
      await f.c.close();
    }
  }, 120000);
  it("retains exact worker results outside cognition and releases only selected facts into a new Subject contact", async () => {
    const f = await fixture(["read", "heptalogos_life"]);
    try {
      await admitSelected(f, await f.c.run(() => f.bridge.prepare(f.input)));
      const childSessionKey = "agent:main:subagent:" + randomUUID(),
        childSessionId = randomUUID(),
        childNousSessionId = randomUUID(),
        childRunId = randomUUID();
      const handoff = {
        version: 1 as const,
        requestId: randomUUID(),
        subjectId: f.input.subjectId,
        parentRunId: f.input.native.runId,
        parentSessionKey: f.input.native.sessionKey,
        parentSessionId: f.input.native.sessionId,
        parentNousSessionId: f.input.nousSessionId,
        childNativeAgentId: "main",
        childSessionKey,
        childSessionId,
        childNousSessionId,
        contextMode: "isolated" as const,
      };
      await f.c.run(() => f.bridge.handoff(handoff));
      const child = {
        ...f.input,
        nousSessionId: childNousSessionId,
        contactRequestId: randomUUID(),
        invocationId: "actual-child-final",
        promptDigest: "7".repeat(64),
        native: {
          ...f.input.native,
          parentSessionKey: f.input.native.sessionKey,
          sessionKey: childSessionKey,
          sessionId: childSessionId,
          runId: childRunId,
          historyGeneration: childSessionId,
        },
      };
      const prepared = await f.c.run(() => f.bridge.prepare(child));
      await admitSelected({ ...f, input: child }, prepared);
      const bound = {
        nativeRunId: childRunId,
        activityRef: f.activity.activityId,
        nativeAgentId: "main",
        sessionKey: childSessionKey,
        sessionId: childSessionId,
        toolCallId: "actual-child-life",
      };
      const inspected = await f.c
        .run(() => f.bridge.life({ ...bound, request: { action: "inspect" } }))
        .then(activityLife);
      await expect(
        f.c.run(() =>
          f.bridge.life({
            ...bound,
            request: {
              action: "progress",
              expectedRevision: inspected.revision,
              note: "worker cannot change main Activity",
              nextOpportunity: null,
              mode: "rest",
            },
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_life_role_denied" },
      });
      const requestId = randomUUID(),
        occurrenceId = randomUUID(),
        artifactId = randomUUID();
      const identity = sdk.hostContactIdentitySchema.strip().parse(child);
      await f.c.run(() =>
        f.bridge.feedback({
          ...identity,
          stage: "pending",
          observation: sdk.encodeObservationInput({
            requestId,
            subjectId: f.input.subjectId,
            sessionId: childNousSessionId,
            sourceClass: "generated",
            observedAt: sdk.timestampFromDate(new Date()),
            material: {
              case: "inlineText",
              value: {
                text: JSON.stringify({
                  content: [{ type: "text", text: "SAVED ACTUAL CHILD RESULT" }],
                  delivery: "model_output",
                }),
                mediaType: "application/json",
              },
            },
          }),
        }),
      );
      await expect(
        f.c.run(() =>
          f.bridge.feedback({
            ...identity,
            stage: "committed",
            observationRequestId: requestId,
            receipt: sdk.encodeAcceptedObservation({ occurrenceId, artifactId }),
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_execution_result_only" },
      });
      expect(
        await f.bridge.readRoleResults(f.input.subjectId, childRunId),
      ).toMatchObject({ results: [{ resultId: requestId }] });
      expect(
        await readRepositorySql(
          f.c.persistence,
          "SELECT request_id FROM heptalogos.cognition_pending_feedback WHERE run_id=$1",
          [childRunId],
        ),
      ).toEqual([]);
      // A retained pre-registration-parent worker keeps its immutable handoff,
      // results and missing provider policy. Recovery must not admit another attempt.
      await f.c.run(() =>
        f.c.persistence.mutate((context) =>
          useRepositoryMutationTransaction(context, async (tx) => {
            await executeRepositorySql(
              tx,
              "UPDATE heptalogos.life_handoff SET document=document #- '{registration,parentRunId}' WHERE child_session_key=$1",
              [childSessionKey],
            );
            await executeRepositorySql(
              tx,
              "UPDATE heptalogos.life_native_run SET document=jsonb_set(document #- '{registration,parentRunId}' #- '{registration,tokenBudget}' #- '{registration,allowedToolNames}', '{registration,providerPolicyState}', '\"unconfigured\"'::jsonb) WHERE run_id=$1",
              [childRunId],
            );
          }),
        ),
      );
      await f.c.run(() => f.bridge.finishRun(childRunId, "uncertain"));
      const retainedBefore = await f.bridge.readRoleResults(
        f.input.subjectId,
        childRunId,
      );
      expect(retainedBefore.run.registration.parentRunId).toBeUndefined();
      expect(await f.bridge.readResultParent(f.input.subjectId, childRunId)).toBe(
        f.input.native.runId,
      );
      await expect(
        f.bridge.readResultParent(randomUUID(), childRunId),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_result_release_denied" },
      });
      // Recovery of the pre-fix durable child uses only the exact existing handoff; no latest-run lookup.
      const completion = {
        version: 1 as const,
        subjectId: f.input.subjectId,
        parentSessionKey: f.input.native.sessionKey,
        childRunId,
        childSessionKey,
        childSessionId,
        childNousSessionId,
        outcome: "completed" as const,
        endedAt: new Date().toISOString(),
      };
      await expect(
        f.c.run(() => f.bridge.completion(completion)),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_completion_changed" },
      });
      const recoveredCompletion = {
        ...completion,
        parentRunId: f.input.native.runId,
        recover: true,
      };
      for (const changed of [
        { subjectId: randomUUID() },
        { childSessionId: randomUUID() },
        { parentSessionId: randomUUID() },
        { childSessionKey: "agent:other:subagent:" + randomUUID() },
        { parentRunId: randomUUID() },
        { childNousSessionId: randomUUID() },
      ])
        await expect(
          f.c.run(() => f.bridge.completion({ ...recoveredCompletion, ...changed })),
        ).rejects.toMatchObject({
          problem: { problemCode: "gateway.native_completion_changed" },
        });
      expect((await f.bridge.readRun(childRunId))?.state).toBe("uncertain");
      const ack = await f.c.run(() => f.bridge.completion(recoveredCompletion));
      expect(
        await f.bridge.readRoleResults(f.input.subjectId, childRunId),
      ).toMatchObject({ results: retainedBefore.results });
      await expect(
        f.c.run(() =>
          f.bridge.prepare({
            ...child,
            contactRequestId: randomUUID(),
            invocationId: "must-not-rerun-paid",
          }),
        ),
      ).rejects.toBeDefined();
      await expect(
        f.c.run(() =>
          f.bridge.completion({
            ...recoveredCompletion,
            endedAt: new Date(Date.parse(completion.endedAt) + 1000).toISOString(),
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_completion_changed" },
      });
      await expect(
        f.c.run(() =>
          f.bridge.completion({ ...recoveredCompletion, outcome: "failed" }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_completion_changed" },
      });

      expect(ack.parentRunId).toBe(f.input.native.runId);
      expect((await f.bridge.readRun(childRunId))?.state).toBe("completed");
      expect(
        (await f.bridge.readyResults({ subjectId: f.input.subjectId, limit: 128 }))
          .runs,
      ).toContainEqual(expect.objectContaining({ runId: childRunId, resultCount: 1 }));
      await f.c.run(() => f.bridge.completion(recoveredCompletion));
      await expect(
        f.c.run(() =>
          f.bridge.completion({ ...completion, parentRunId: randomUUID() }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_completion_changed" },
      });
      await f.c.run(() => f.bridge.finishRun(f.input.native.runId, "completed"));
      const nativeRunId = `announce:v1:${childSessionKey}:${childRunId}:nous-completion-v1`;
      const continuation = {
        ...completion,
        parentRunId: f.input.native.runId,
        parentSessionId: f.input.native.sessionId,
        parentNousSessionId: f.input.nousSessionId,
        continuation: {
          nativeRunId,
          nativeAgentId: "main",
          prompt: "Native durable child findings: SAVED ACTUAL CHILD RESULT",
        },
      };
      await expect(
        f.c.run(() => f.bridge.completion(continuation)),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.invalid_input" },
      });
      const releaseInput = {
        version: 1 as const,
        requestId: randomUUID(),
        subjectId: f.input.subjectId,
        parentRunId: f.input.native.runId,
        childRunId,
        resultIds: [requestId],
      };
      const released = await f.c.run(() => f.bridge.releaseResult(releaseInput));
      expect(released.contactNature).toBe("subject_experience");
      expect(released.opportunity.kind).toBe("activity_result");
      expect(released.contacts).toHaveLength(1);
      expect(JSON.stringify(released.contacts)).toContain("SAVED ACTUAL CHILD RESULT");
      expect(await f.c.run(() => f.bridge.releaseResult(releaseInput))).toEqual(
        released,
      );
      const releasedRunId = randomUUID(),
        releasedSessionKey = "native:subject-result:" + randomUUID();
      const subjectInput = {
        ...f.registration,
        nativeRunId: releasedRunId,
        sessionKey: releasedSessionKey,
        prompt: "Deliberate on the explicitly released result",
        sourceRefs: [released.contacts[0]!.contactRef],
        messageRefs: [],
        contacts: released.contacts,
      };
      const selected = await f.c.run(() => f.bridge.registerInput(subjectInput));
      const actual = {
        ...f.input,
        contactRequestId: randomUUID(),
        invocationId: "subject-released-result",
        promptDigest: selected.promptDigest,
        native: {
          ...f.input.native,
          runId: releasedRunId,
          sessionKey: releasedSessionKey,
        },
      };
      const subjectPrepared = await f.c.run(() => f.bridge.prepare(actual));
      expect(subjectPrepared.contacts).toHaveLength(1);
      expect(subjectPrepared.currentSources).toEqual([]);
      await admitSelected({ ...f, input: actual }, subjectPrepared);
      await expect(
        f.c.run(() =>
          f.bridge.registerInput({
            ...subjectInput,
            nativeRunId: randomUUID(),
            contacts: [
              {
                ...released.contacts[0]!,
                observation: {
                  ...released.contacts[0]!.observation,
                  sourceClass: "tool",
                },
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_result_release_changed" },
      });

      await expect(
        f.c.run(() =>
          f.bridge.releaseResult({ ...releaseInput, resultIds: [randomUUID()] }),
        ),
      ).rejects.toBeDefined();
      await expect(
        f.c.run(() =>
          f.bridge.completion({
            ...completion,
            endedAt: new Date(Date.now() + 60000).toISOString(),
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_completion_changed" },
      });
      const switchedRun = randomUUID();
      const switched = await f.c.run(() =>
        f.bridge.registerInput({
          ...f.registration,
          nativeRunId: switchedRun,
          roleScope: {
            role: "subject.execution",
            purpose: "professional_execution",
            view: "worker",
            contactNature: "execution_only",
          },
        }),
      );
      await expect(
        f.c.run(() =>
          f.bridge.prepare({
            ...f.input,
            contactRequestId: randomUUID(),
            invocationId: "cross-role",
            promptDigest: switched.promptDigest,
            native: { ...f.input.native, runId: switchedRun },
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_role_history_changed" },
      });
      const otherAudienceRun = randomUUID();
      const otherAudience = await f.c.run(() =>
        f.bridge.registerInput({
          ...f.registration,
          nativeRunId: otherAudienceRun,
          usage: {
            ...f.registration.usage,
            audience: { ...f.registration.usage.audience!, visibility: "internal" },
          },
        }),
      );
      await expect(
        f.c.run(() =>
          f.bridge.prepare({
            ...f.input,
            contactRequestId: randomUUID(),
            invocationId: "cross-audience",
            promptDigest: otherAudience.promptDigest,
            native: { ...f.input.native, runId: otherAudienceRun },
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_role_history_changed" },
      });
      f.revoke();
      await expect(
        f.c.run(() =>
          f.bridge.completion({
            ...continuation,
            continuation: {
              ...continuation.continuation,
              nativeRunId: nativeRunId + ":forged",
            },
          } as never),
        ),
      ).rejects.toBeDefined();
      // Recording the already-produced terminal fact is distinct from permitting new input/effects.
      await f.c.run(() => f.bridge.completion(completion));
    } finally {
      await f.c.close();
    }
  }, 120000);
});

real("admitted native caller history", () => {
  it("keeps same-Activity admitted turns and the exact current caller, excluding unadmitted, foreign Activity and altered native text", async () => {
    const f = await fixture();
    try {
      await admitSelected(f, await f.c.run(() => f.bridge.prepare(f.input)));
      let other = await f.c.run(() =>
        f.life.propose({
          operationId: randomUUID(),
          subjectId: f.input.subjectId,
          purpose: "Another adopted Activity",
          mode: "work",
          window: { notBefore: null, notAfter: null },
          proposedBy: f.actor,
          sourceRefs: [],
          workContextId: f.activity.workContextId,
          world: f.activity.world,
          nextOpportunity: null,
          interruptOn: ["manual"],
        }),
      );
      other = await f.c.run(() =>
        f.life.adopt({
          subjectId: f.input.subjectId,
          activityId: other.activityId,
          expectedRevision: other.revision,
          adoptedBy: f.actor,
          scope: f.activity.scope!,
        }),
      );
      other = await f.c.run(() =>
        f.life.transition({
          subjectId: f.input.subjectId,
          activityId: other.activityId,
          expectedRevision: other.revision,
          action: "start",
          reason: "Explicit other Activity",
        }),
      );
      const otherRun = randomUUID();
      await f.c.run(() =>
        f.bridge.registerInput({
          ...f.registration,
          activityId: other.activityId,
          nativeRunId: otherRun,
        }),
      );
      const otherInput = {
        ...f.input,
        contactRequestId: randomUUID(),
        invocationId: "other-activity",
        native: { ...f.input.native, runId: otherRun },
      };
      await admitSelected(
        { ...f, input: otherInput },
        await f.c.run(() => f.bridge.prepare(otherInput)),
      );
      const currentRun = randomUUID();
      await f.c.run(() =>
        f.bridge.registerInput({ ...f.registration, nativeRunId: currentRun }),
      );
      const unknownRun = randomUUID();
      const historyUsers = [
        {
          key: f.input.native.runId + ":user",
          nativeRunId: f.input.native.runId,
          promptDigest: f.input.promptDigest,
        },
        {
          key: otherRun + ":user",
          nativeRunId: otherRun,
          promptDigest: f.input.promptDigest,
        },
        {
          key: unknownRun + ":user",
          nativeRunId: unknownRun,
          promptDigest: f.input.promptDigest,
        },
        {
          key: currentRun + ":user",
          nativeRunId: currentRun,
          promptDigest: f.input.promptDigest,
        },
        {
          key: "forged-key",
          nativeRunId: f.input.native.runId,
          promptDigest: f.input.promptDigest,
        },
      ];
      const response = await f.c.run(() =>
        f.bridge.prepare({
          ...f.input,
          contactRequestId: randomUUID(),
          invocationId: "current-caller",
          native: { ...f.input.native, runId: currentRun },
          historyUsers,
        }),
      );
      expect(response.allowedHistoryUserKeys).toEqual([
        f.input.native.runId + ":user",
        currentRun + ":user",
      ]);
    } finally {
      await f.c.close();
    }
  }, 120000);
});

real("trusted provider budgets and role tools", () => {
  it("enforces role tools inside Activity scope and preserves unconfigured historical results without permitting another attempt", async () => {
    const f = await fixture(["read", "write"]);
    try {
      const runId = randomUUID();
      const selection = await f.c.run(() =>
        f.bridge.registerInput({
          ...f.registration,
          nativeRunId: runId,
          tokenBudget: { inputTokens: 2048, outputTokens: 37 },
          allowedToolNames: ["read"],
        }),
      );
      const input = {
        ...f.input,
        contactRequestId: randomUUID(),
        invocationId: "bounded-policy",
        promptDigest: selection.promptDigest,
        native: { ...f.input.native, runId },
      };
      const prepared = await f.c.run(() => f.bridge.prepare(input));
      expect(prepared.tokenBudget).toEqual({ inputTokens: 2048, outputTokens: 37 });
      expect(prepared.allowedToolNames).toEqual(["read"]);
      await admitSelected({ ...f, input }, prepared);
      await expect(
        f.c.run(() =>
          f.bridge.toolExecution({
            ...sdk.hostContactIdentitySchema.strip().parse(input),
            toolName: "write",
            toolCallId: "denied-role-tool",
            phase: "execute",
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_tool_denied" },
      });
      const applied = await f.bridge.readAppliedContext(runId);
      await f.c.run(() =>
        f.c.persistence.mutate((context) =>
          useRepositoryMutationTransaction(context, async (tx) => {
            await executeRepositorySql(
              tx,
              `UPDATE heptalogos.life_native_input SET document=jsonb_set(document,'{registration,providerPolicyState}','"unconfigured"'::jsonb) WHERE native_run_id=$1`,
              [runId],
            );
            await executeRepositorySql(
              tx,
              `UPDATE heptalogos.life_native_run SET document=jsonb_set(document,'{registration,providerPolicyState}','"unconfigured"'::jsonb) WHERE run_id=$1`,
              [runId],
            );
          }),
        ),
      );
      await expect(
        f.c.run(() =>
          f.bridge.prepare({
            ...input,
            contactRequestId: randomUUID(),
            invocationId: "forbidden-new-attempt",
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_provider_policy_unconfigured" },
      });
      expect(await f.bridge.readAppliedContext(runId)).toEqual(applied);
      await f.c.run(() => f.bridge.finishRun(runId, "completed"));
      expect((await f.bridge.readRun(runId))?.state).toBe("completed");
    } finally {
      await f.c.close();
    }
  }, 120000);
});
