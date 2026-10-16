// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Trusted native-input admission and actual cognition feedback, without an agent loop.
 * @module native-cognition
 */
import { createHash } from "node:crypto";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import type { PersistenceService } from "@heptalogos/persistence";
import {
  executeRepositorySql as sql,
  readRepositorySql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import { managementProblem } from "@heptalogos/management";
import {
  activitySchema,
  type LifeActivity,
  type createLifeService,
  type AgencyDeliveryFact,
} from "@heptalogos/subject";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { MessagingService } from "@heptalogos/messaging";
import type { NousClient } from "@nous-wave/client";
import {
  hostPrepareRequestSchema,
  hostAdmittedRequestSchema,
  hostHandoffRequestSchema,
  hostFeedbackRequestSchema,
  hostToolExecutionRequestSchema,
  hostContactIdentitySchema,
  decodeCognitionUsage,
  encodeCognitionUsage,
  decodeObservationInput,
  encodeObservationInput,
  decodeProjection,
  decodeAcceptedObservation,
  encodeAcceptedObservation,
  withHostObservationScope,
  withAcceptedContactRoots,
  timestampFromDate,
  type HostPrepareRequest,
  type HostPrepareResponse,
  type HostAdmittedRequest,
  type HostHandoffRequest,
} from "@nous-wave/client/host-bridge";
import type {
  NativeActivityParams,
  ActivityDispatchResult,
} from "./activity-dispatch-contracts.js";
import { hasAuthorizedNativeSources } from "./native-source-selection.js";
import type { GatewayCognitionBridge } from "./gateway-http.js";

/** Persisted exact native-run selection; only the trusted Host may construct it. */
export interface Registration {
  readonly subjectId: string;
  readonly activityId: string;
  readonly sessionKey: string;
  readonly nativeAgentId: string;
  readonly nativeRunId: string;
  readonly promptDigest: string;
  readonly role: "main" | "worker";
  readonly actorEntityRef: string;
  readonly workContextId: string;
  readonly usage: HostPrepareResponse["usage"];
  readonly sourceRefs: readonly string[];
  readonly messageRefs: readonly string[];
  readonly inheritedMessageSources?: readonly string[];
  readonly contacts: HostPrepareResponse["contacts"];
}
type NativeDispatchRecord = {
  requestId: string;
  requestDigest: string;
  params: NativeActivityParams;
  state: "dispatching" | "completed" | "failed" | "uncertain";
  result?: unknown;
  code?: string;
};
type StoredInput = {
  registration: Registration;
  prompt?: string;
  dispatch?: NativeDispatchRecord;
  firstContact?: {
    nousSessionId: string;
    contactRequestId: string;
    observedAt: string;
    contacts: HostPrepareResponse["contacts"];
  };
};
/** Root supervision and Agency consume this saved run; it grants no new permission. */
export interface NativeRunSnapshot {
  readonly runId: string;
  readonly state: string;
  readonly registration: Registration;
  readonly native: HostPrepareRequest["native"];
  readonly nousSessionId: string;
  readonly consumerId?: string;
  readonly appliedUsage?: HostPrepareResponse["usage"];
}
function dispatchResult(
  saved: StoredInput,
  replayed: boolean,
): ActivityDispatchResult & { requestDigest: string } {
  const dispatch = saved.dispatch!;
  return {
    requestId: dispatch.requestId,
    requestDigest: dispatch.requestDigest,
    nativeRunId: saved.registration.nativeRunId,
    sessionKey: saved.registration.sessionKey,
    promptDigest: saved.registration.promptDigest,
    state: dispatch.state,
    replayed,
    ...(dispatch.result === undefined ? {} : { result: dispatch.result }),
    ...(dispatch.code ? { code: dispatch.code } : {}),
  };
}
type Contact = {
  request: HostPrepareRequest;
  response: HostPrepareResponse;
  observedAt: string;
  messageContactId: string;
  messageRefs: readonly string[];
  admitted?: HostAdmittedRequest;
  appliedUsage?: HostPrepareResponse["usage"];
};
type Pending = {
  identity: Omit<HostPrepareRequest, "promptDigest">;
  observation: HostPrepareResponse["contacts"][number]["observation"];
  factsDigest: string;
};
type Handoff = { request: HostHandoffRequest; registration: Registration };
/** Product composition supplies real existing owners and explicit recovery opportunities. */
export interface NativeCognitionOptions {
  readonly persistence: PersistenceService;
  readonly life: Pick<ReturnType<typeof createLifeService>, "get">;
  readonly now: () => string;
  readonly authorizeInput: (
    registration: Readonly<Registration>,
    activity: LifeActivity,
  ) => Promise<void>;
  readonly recordContact: MessagingService["recordContact"];
  readonly nous: () => Promise<Pick<NousClient, "runtime">>;
}
const digest = (value: unknown) =>
  digestCanonicalJson(
    "host.native-cognition.v1",
    JSON.parse(JSON.stringify(value)) as CanonicalJsonValue,
  ).hex;
const identity = (value: unknown) =>
  validated(() => hostContactIdentitySchema.strip().parse(value));
function invalid(): never {
  throw managementProblem(
    "gateway.invalid_input",
    "Invalid native cognition input",
    "Inspect the public HostBridge schema and canonical protobuf JSON",
    "validation",
  );
}
function deny(code: string, detail: string): never {
  throw managementProblem(
    `gateway.${code}`,
    "Native cognition admission denied",
    detail,
    "conflict",
  );
}
function validated<T>(parse: () => T): T {
  try {
    return parse();
  } catch {
    invalid();
  }
}
const activityCodec = compileSchema<LifeActivity>(activitySchema);
function current(activity: LifeActivity, registration: Registration) {
  if (
    activity.subjectId !== registration.subjectId ||
    activity.activityId !== registration.activityId ||
    activity.state !== "active" ||
    activity.continuationRequired ||
    !activity.scope ||
    activity.adoptedBy !== registration.actorEntityRef
  )
    deny(
      "native_activity_unavailable",
      "The original adopted Activity must be active and explicitly continued",
    );
  if (!hasAuthorizedNativeSources(activity, registration))
    deny(
      "native_source_denied",
      "An actual source is outside the current adopted Activity",
    );
  const usage = validated(() => decodeCognitionUsage(registration.usage));
  if (
    !usage.audience?.conversationRef ||
    !activity.scope.conversations.some(
      (scope) =>
        scope.conversationRef === usage.audience!.conversationRef &&
        scope.operations.includes("observe"),
    )
  )
    deny(
      "native_audience_denied",
      "The registered audience is outside the Activity's observe scope",
    );
}
function actualFeedback(value: Pending["observation"]) {
  // A retry may discover the same event later; only its first actual observedAt
  // is retained. Event content and source identity still cannot change.
  const facts = { ...value };
  delete facts.observedAt;
  return digest(facts);
}

/** No polling, model calls, network sends, or parallel durable queue is created here. */
export function createNativeCognitionBridge(options: NativeCognitionOptions) {
  const mutate = <T>(run: (tx: PersistenceInternalTransaction) => Promise<T>) =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, run),
    );
  const sessionLock = (tx: PersistenceInternalTransaction, key: string) =>
    sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `native-session:${key}`,
    ]);
  const lockedActivity = async (
    tx: PersistenceInternalTransaction,
    subjectId: string,
    activityId: string,
  ) => {
    const rows = await sql<{ document: unknown }>(
      tx,
      "SELECT document FROM heptalogos.life_activity WHERE subject_id=$1 AND activity_id=$2 FOR UPDATE",
      [subjectId, activityId],
    );
    if (!rows[0])
      deny(
        "native_activity_unavailable",
        "The registered Activity no longer belongs to this Subject",
      );
    const value = activityCodec.validate(rows[0].document);
    if (!value.ok)
      deny(
        "native_state_invalid",
        "The saved Activity does not match its owning contract",
      );
    return value.value;
  };
  const contactIn = async (tx: PersistenceInternalTransaction, input: unknown) => {
    const claimed = identity(input);
    const rows = await sql<{ document: Contact }>(
      tx,
      "SELECT document FROM heptalogos.life_native_contact WHERE contact_request_id=$1 FOR UPDATE",
      [claimed.contactRequestId],
    );
    if (!rows[0] || digest(identity(rows[0].document.request)) !== digest(claimed))
      deny(
        "native_contact_changed",
        "The callback must retain the exact original native and Nous contact identity",
      );
    return rows[0].document;
  };
  const readRun = async (runId: string): Promise<NativeRunSnapshot | undefined> => {
    const rows = await readRepositorySql<{
      state: string;
      document: Omit<NativeRunSnapshot, "state">;
    }>(
      options.persistence,
      "SELECT state,document FROM heptalogos.life_native_run WHERE run_id=$1",
      [runId],
    );
    return rows[0] ? { ...rows[0].document, state: rows[0].state } : undefined;
  };
  const service: GatewayCognitionBridge & {
    registerInput(
      input: Omit<Registration, "promptDigest" | "usage"> & {
        readonly prompt: string;
        readonly usage: Parameters<typeof encodeCognitionUsage>[0];
      },
      dispatch?: Omit<NativeDispatchRecord, "state" | "result" | "code">,
    ): Promise<{
      sessionKey: string;
      nativeRunId: string;
      promptDigest: string;
      dispatch?: NativeDispatchRecord;
      claimed?: boolean;
    }>;
    readDispatch(
      subjectId: string,
      requestId: string,
    ): Promise<(ActivityDispatchResult & { requestDigest: string }) | undefined>;
    finishDispatch(
      subjectId: string,
      requestId: string,
      outcome: {
        state: "completed" | "failed" | "uncertain";
        result?: unknown;
        code?: string;
      },
    ): Promise<ActivityDispatchResult>;
    readRun: typeof readRun;
    recordDeliveryFact(fact: AgencyDeliveryFact): Promise<void>;
    finishRun(
      runId: string,
      state: "completed" | "cancelled" | "failed" | "uncertain",
    ): Promise<void>;
    flushPendingFeedback(limit: number): Promise<{ delivered: number }>;
  } = {
    async registerInput(input, dispatch) {
      const { prompt, usage, ...selection } = input;
      if (
        typeof prompt !== "string" ||
        !input.sessionKey ||
        !input.nativeAgentId ||
        !input.nativeRunId ||
        !["main", "worker"].includes(input.role) ||
        !input.actorEntityRef ||
        !Array.isArray(input.sourceRefs) ||
        !Array.isArray(input.messageRefs)
      )
        invalid();
      const canonicalUsage = validated(() =>
        encodeCognitionUsage(decodeCognitionUsage(encodeCognitionUsage(usage))),
      );
      validated(() =>
        withAcceptedContactRoots(
          decodeCognitionUsage(canonicalUsage),
          input.subjectId,
          [],
        ),
      );
      const contacts = selection.contacts.map((contact) => {
        const observation = validated(() =>
          decodeObservationInput(contact.observation),
        );
        if (
          observation.subjectId !== input.subjectId ||
          !observation.requestId ||
          !contact.contactRef
        )
          invalid();
        validated(() =>
          hostContactIdentitySchema.shape.contactRequestId.parse(observation.requestId),
        );
        return {
          contactRef: contact.contactRef,
          observation: encodeObservationInput(observation),
        };
      });
      const registration: Registration = {
        ...selection,
        contacts,
        usage: canonicalUsage,
        promptDigest: createHash("sha256").update(prompt).digest("hex"),
      };
      const selected = await mutate(async (tx) => {
        if (dispatch) {
          await sessionLock(tx, `dispatch-native-run:${dispatch.requestId}`);
          const previous = await sql<{ document: StoredInput }>(
            tx,
            "SELECT document FROM heptalogos.life_native_input WHERE native_run_id=$1 FOR UPDATE",
            [input.nativeRunId],
          );
          if (previous[0]) {
            if (
              previous.length !== 1 ||
              previous[0].document.registration.subjectId !== input.subjectId ||
              previous[0].document.dispatch?.requestDigest !== dispatch.requestDigest
            )
              deny(
                "native_dispatch_conflict",
                "The request identity already names another exact Activity selection",
              );
            return {
              registration: previous[0].document.registration,
              dispatch: previous[0].document.dispatch,
              claimed: false,
            };
          }
        }
        await sessionLock(tx, input.sessionKey);
        const activity = await lockedActivity(tx, input.subjectId, input.activityId);
        current(activity, registration);
        await options.authorizeInput(registration, activity);
        if (!activity.workContextId || activity.workContextId !== input.workContextId)
          deny(
            "native_work_context_changed",
            "Register the Activity's current formal Nous WorkContext",
          );
        const rows = await sql<{ document: StoredInput }>(
          tx,
          "SELECT document FROM heptalogos.life_native_input WHERE session_key=$1 AND native_run_id=$2 FOR UPDATE",
          [input.sessionKey, input.nativeRunId],
        );
        if (rows[0]) {
          if (digest(rows[0].document.registration) !== digest(registration))
            deny(
              "native_input_conflict",
              "The exact native input was already registered with another scope",
            );
          return;
        }
        await sql(
          tx,
          "INSERT INTO heptalogos.life_native_input(session_key,native_run_id,prompt_digest,subject_id,activity_id,document,recorded_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
          [
            input.sessionKey,
            input.nativeRunId,
            registration.promptDigest,
            input.subjectId,
            input.activityId,
            JSON.stringify({
              registration,
              ...(dispatch ? { prompt } : {}),
              ...(dispatch ? { dispatch: { ...dispatch, state: "dispatching" } } : {}),
            }),
            options.now(),
          ],
        );
        return {
          registration,
          dispatch: dispatch
            ? { ...dispatch, state: "dispatching" as const }
            : undefined,
          claimed: !!dispatch,
        };
      });
      return {
        sessionKey: selected?.registration.sessionKey ?? input.sessionKey,
        nativeRunId: selected?.registration.nativeRunId ?? input.nativeRunId,
        promptDigest: selected?.registration.promptDigest ?? registration.promptDigest,
        dispatch: selected?.dispatch,
        claimed: selected?.claimed,
      };
    },
    async readDispatch(subjectId, requestId) {
      const rows = await readRepositorySql<{ document: StoredInput }>(
        options.persistence,
        "SELECT document FROM heptalogos.life_native_input WHERE subject_id=$1 AND document#>>'{dispatch,requestId}'=$2",
        [subjectId, requestId],
      );
      const saved = rows[0]?.document;
      return saved?.dispatch ? dispatchResult(saved, true) : undefined;
    },
    async finishDispatch(subjectId, requestId, outcome) {
      return mutate(async (tx) => {
        const rows = await sql<{ document: StoredInput }>(
          tx,
          "SELECT document FROM heptalogos.life_native_input WHERE subject_id=$1 AND document#>>'{dispatch,requestId}'=$2 FOR UPDATE",
          [subjectId, requestId],
        );
        const saved = rows[0]?.document;
        if (!saved?.dispatch)
          deny("native_dispatch_unknown", "No original dispatch input exists");
        if (saved.dispatch.state !== "dispatching") return dispatchResult(saved, true);
        const document = { ...saved, dispatch: { ...saved.dispatch, ...outcome } };
        await sql(
          tx,
          "UPDATE heptalogos.life_native_input SET document=$3::jsonb WHERE subject_id=$1 AND document#>>'{dispatch,requestId}'=$2",
          [subjectId, requestId, JSON.stringify(document)],
        );
        await sql(
          tx,
          "UPDATE heptalogos.life_native_run SET state=$3,updated_at=$4 WHERE run_id=$1 AND subject_id=$2 AND state IN ('admitted','running')",
          [saved.registration.nativeRunId, subjectId, outcome.state, options.now()],
        );
        return dispatchResult(document, false);
      });
    },
    async prepare(value) {
      const input = validated(() => hostPrepareRequestSchema.parse(value));
      const prepared = await mutate(async (tx) => {
        await sessionLock(tx, input.native.sessionKey);
        const registered = await sql<{ document: StoredInput }>(
          tx,
          "SELECT document FROM heptalogos.life_native_input WHERE session_key=$1 AND native_run_id=$2",
          [input.native.sessionKey, input.native.runId],
        );
        if (
          registered[0]?.document.dispatch &&
          registered[0].document.dispatch.state !== "dispatching"
        )
          deny(
            "native_dispatch_stopped",
            "The saved native dispatch is terminal or requires explicit reconciliation; it cannot admit new model input",
          );
        let registration = registered[0]?.document.registration;
        if (registration && registration.promptDigest !== input.promptDigest)
          deny(
            "native_input_unregistered",
            "The exact native prompt was not registered",
          );
        let inheritedParent: string | undefined;
        if (!registration) {
          const handoffs = await sql<{ document: Handoff; parent_run_id: string }>(
            tx,
            "SELECT document,parent_run_id FROM heptalogos.life_handoff WHERE child_session_key=$1",
            [input.native.sessionKey],
          );
          const handoff = handoffs[0]?.document;
          if (
            !handoff ||
            input.native.parentSessionKey !== handoff.request.parentSessionKey ||
            input.native.sessionId !== handoff.request.childSessionId ||
            input.nousSessionId !== handoff.request.childNousSessionId
          )
            deny(
              "native_input_unregistered",
              "The exact prompt needs trusted Host registration or an exact isolated handoff",
            );
          inheritedParent = handoffs[0]!.parent_run_id;
          registration = {
            ...handoff.registration,
            sessionKey: input.native.sessionKey,
            nativeRunId: input.native.runId,
            promptDigest: input.promptDigest,
            role: "worker",
            messageRefs: [],
            contacts: [],
          };
        }
        if (input.native.agentId !== registration.nativeAgentId)
          deny(
            "native_agent_changed",
            "The real native agent must match the trusted account binding, including delegated workers",
          );
        if (input.subjectId !== registration.subjectId)
          deny(
            "native_subject_changed",
            "Native input cannot change the registered Subject",
          );
        const activity = await lockedActivity(
          tx,
          input.subjectId,
          registration.activityId,
        );
        current(activity, registration);
        await options.authorizeInput(registration, activity);
        if (registration.role === "main" && input.native.parentSessionKey)
          deny(
            "native_role_changed",
            "A delegated native session cannot acquire a main-run registration",
          );
        if (inheritedParent) {
          const parents = await sql<{ state: string }>(
            tx,
            "SELECT state FROM heptalogos.life_native_run WHERE run_id=$1 FOR SHARE",
            [inheritedParent],
          );
          if (
            !parents[0] ||
            ["cancelled", "failed", "uncertain"].includes(parents[0].state)
          )
            deny(
              "native_parent_changed",
              "The delegated parent has stopped or requires explicit recovery",
            );
        }
        if (!activity.workContextId)
          deny(
            "native_work_context_changed",
            "The Activity needs its current formal Nous WorkContext",
          );
        const runs = await sql<{ state: string; document: NativeRunSnapshot }>(
          tx,
          "SELECT state,document FROM heptalogos.life_native_run WHERE run_id=$1 FOR UPDATE",
          [input.native.runId],
        );
        const oldRun = runs[0];
        if (
          oldRun &&
          (digest(oldRun.document.native) !== digest(input.native) ||
            oldRun.document.nousSessionId !== input.nousSessionId ||
            digest(oldRun.document.registration) !== digest(registration) ||
            !["admitted", "running"].includes(oldRun.state))
        )
          deny(
            "native_run_changed",
            "The real native run identity and adopted scope cannot be rebound",
          );
        const saved = await sql<{ request_digest: string; document: Contact }>(
          tx,
          "SELECT request_digest,document FROM heptalogos.life_native_contact WHERE contact_request_id=$1 OR (run_id=$2 AND invocation_id=$3) FOR UPDATE",
          [input.contactRequestId, input.native.runId, input.invocationId],
        );
        if (saved[0]) {
          if (saved[0].request_digest !== digest(input))
            deny(
              "native_contact_changed",
              "The invocation already belongs to another exact contact request",
            );
          return saved[0].document.response;
        }
        const usage = validated(() => decodeCognitionUsage(registration.usage));
        usage.agentInstanceId = `${input.native.sessionId}:${input.native.runId}`;
        if (registration.role === "worker") usage.purpose = "worker";
        const at = options.now();
        const response: HostPrepareResponse = {
          version: 1,
          contactRequestId: input.contactRequestId,
          workContextId: activity.workContextId,
          allowedToolNames: [...activity.scope!.tools],
          usage: encodeCognitionUsage(usage),
          scope: {
            activityRef: registration.activityId,
            actorEntityRef: registration.actorEntityRef,
            context: { native_role: registration.role },
          },
          contacts:
            registered[0]?.document.firstContact?.contacts ??
            registration.contacts.map((contact) => {
              const observation = validated(() =>
                decodeObservationInput(contact.observation),
              );
              if (
                observation.sessionId &&
                observation.sessionId !== input.nousSessionId
              )
                deny(
                  "native_session_changed",
                  "A registered observation cannot be moved to another Nous Session",
                );
              observation.sessionId = input.nousSessionId;
              observation.observedAt = timestampFromDate(new Date(at));
              return {
                contactRef: contact.contactRef,
                observation: encodeObservationInput(
                  withHostObservationScope(observation, {
                    usage,
                    contactRequestId: input.contactRequestId,
                    activityRef: registration.activityId,
                  }),
                ),
              };
            }),
        };
        const firstContact = registered[0]?.document.firstContact;
        if (firstContact && firstContact.nousSessionId !== input.nousSessionId)
          deny(
            "native_session_changed",
            "Register a new native run and contact identity after native Session reset",
          );
        if (registered[0] && !firstContact)
          await sql(
            tx,
            "UPDATE heptalogos.life_native_input SET document=$3::jsonb WHERE session_key=$1 AND native_run_id=$2",
            [
              input.native.sessionKey,
              input.native.runId,
              JSON.stringify({
                ...registered[0]!.document,
                registration,
                firstContact: {
                  nousSessionId: input.nousSessionId,
                  contactRequestId: input.contactRequestId,
                  observedAt: at,
                  contacts: response.contacts,
                },
              }),
            ],
          );
        const run: Omit<NativeRunSnapshot, "state"> = {
          runId: input.native.runId,
          registration,
          native: input.native,
          nousSessionId: input.nousSessionId,
        };
        if (!oldRun)
          await sql(
            tx,
            "INSERT INTO heptalogos.life_native_run(run_id,subject_id,activity_id,session_key,session_id,parent_session_key,role,prompt_digest,state,document,recorded_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'running',$9::jsonb,$10,$10)",
            [
              input.native.runId,
              input.subjectId,
              registration.activityId,
              input.native.sessionKey,
              input.native.sessionId,
              input.native.parentSessionKey ?? null,
              registration.role,
              input.promptDigest,
              JSON.stringify(run),
              at,
            ],
          );
        const document: Contact = {
          request: input,
          response,
          observedAt: firstContact?.observedAt ?? at,
          messageContactId: firstContact?.contactRequestId ?? input.contactRequestId,
          messageRefs: registration.messageRefs,
        };
        await sql(
          tx,
          "INSERT INTO heptalogos.life_native_contact(contact_request_id,subject_id,run_id,invocation_id,request_digest,document,recorded_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
          [
            input.contactRequestId,
            input.subjectId,
            input.native.runId,
            input.invocationId,
            digest(input),
            JSON.stringify(document),
            at,
          ],
        );
        return response;
      });
      await service.flushPendingFeedback(32);
      return prepared;
    },
    async admitted(value) {
      const input = validated(() => hostAdmittedRequestSchema.parse(value));
      const selected = await mutate(async (tx) => {
        const runs = await sql<{ document: NativeRunSnapshot }>(
          tx,
          "SELECT document FROM heptalogos.life_native_run WHERE run_id=$1 FOR UPDATE",
          [input.native.runId],
        );
        const contact = await contactIn(tx, input);
        const projection = validated(() => decodeProjection(input.projection));
        if (
          projection.subjectId !== input.subjectId ||
          projection.sessionId !== input.nousSessionId ||
          !projection.projectionId ||
          !projection.consumerId ||
          projection.usage?.agentInstanceId !==
            `${input.native.sessionId}:${input.native.runId}`
        )
          deny(
            "native_projection_changed",
            "The actual projection must belong to this native and Nous invocation",
          );
        const expected = new Set(
          contact.response.contacts.map((entry) => entry.contactRef),
        );
        if (input.occurrences.length !== expected.size)
          deny(
            "native_receipt_changed",
            "Every actually selected contact needs its own accepted receipt",
          );
        for (const item of input.occurrences) {
          if (
            !expected.delete(item.contactRef) ||
            !validated(() => decodeAcceptedObservation(item.receipt)).occurrenceId
          )
            deny(
              "native_receipt_changed",
              "A receipt does not belong to the selected contacts",
            );
        }
        const appliedUsage = validated(() =>
          encodeCognitionUsage(
            withAcceptedContactRoots(
              decodeCognitionUsage(contact.response.usage),
              input.subjectId,
              input.occurrences.map((item) => decodeAcceptedObservation(item.receipt)),
            ),
          ),
        );
        if (
          !projection.usage ||
          digest(encodeCognitionUsage(projection.usage)) !== digest(appliedUsage)
        )
          deny(
            "native_scope_changed",
            "Projection scope must be exactly the registered scope and selected actual occurrence roots",
          );
        if (runs[0])
          await sql(
            tx,
            "UPDATE heptalogos.life_native_run SET document=$2::jsonb WHERE run_id=$1",
            [
              input.native.runId,
              JSON.stringify({
                ...runs[0].document,
                consumerId: projection.consumerId,
                appliedUsage,
              }),
            ],
          );
        if (contact.admitted && digest(contact.admitted) !== digest(input))
          deny(
            "native_receipt_changed",
            "An acknowledged actual projection or occurrence result cannot be overwritten",
          );
        if (!contact.admitted)
          await sql(
            tx,
            "UPDATE heptalogos.life_native_contact SET document=$2::jsonb WHERE contact_request_id=$1",
            [
              input.contactRequestId,
              JSON.stringify({ ...contact, admitted: input, appliedUsage }),
            ],
          );
        return contact;
      });
      if (selected.messageRefs.length)
        await options.recordContact({
          subjectId: input.subjectId,
          contactId: selected.messageContactId,
          messageRefs: [...selected.messageRefs],
          observedAt: selected.observedAt,
        });
      return { version: 1, accepted: true };
    },
    async toolExecution(value) {
      const input = validated(() => hostToolExecutionRequestSchema.parse(value));
      return mutate(async (tx) => {
        await sessionLock(tx, input.native.sessionKey);
        const contact = await contactIn(tx, input);
        const runs = await sql<{ state: string; document: NativeRunSnapshot }>(
          tx,
          "SELECT state,document FROM heptalogos.life_native_run WHERE run_id=$1 FOR UPDATE",
          [input.native.runId],
        );
        const run = runs[0];
        if (
          !run ||
          run.state !== "running" ||
          !contact.admitted ||
          !contact.appliedUsage
        )
          deny(
            "native_tool_unavailable",
            "Tools require the actual admitted running invocation",
          );
        const activity = await lockedActivity(
          tx,
          input.subjectId,
          run.document.registration.activityId,
        );
        current(activity, run.document.registration);
        await options.authorizeInput(run.document.registration, activity);
        if (
          !contact.response.allowedToolNames.includes(input.toolName) ||
          !activity.scope!.tools.includes(input.toolName)
        )
          deny(
            "native_tool_denied",
            "The actual tool is outside this invocation's current adopted scope",
          );
        return {
          version: 1,
          contactRequestId: input.contactRequestId,
          toolName: input.toolName,
          toolCallId: input.toolCallId,
          allowed: true,
          usage: contact.appliedUsage,
        };
      });
    },
    async handoff(value) {
      const input = validated(() => hostHandoffRequestSchema.parse(value));
      await mutate(async (tx) => {
        await sessionLock(tx, input.parentSessionKey);
        const matches = await sql<{ document: NativeRunSnapshot }>(
          tx,
          "SELECT document FROM heptalogos.life_native_run WHERE subject_id=$1 AND session_key=$2 AND session_id=$3 AND run_id=$4 AND state='running'",
          [
            input.subjectId,
            input.parentSessionKey,
            input.parentSessionId,
            input.parentRunId,
          ],
        );
        if (matches.length !== 1)
          deny(
            "native_parent_changed",
            "An isolated handoff requires its actual running parent run and exact session",
          );
        const parent = matches[0]!.document;
        const activity = await lockedActivity(
          tx,
          input.subjectId,
          parent.registration.activityId,
        );
        current(activity, parent.registration);
        const runs = await sql<{ state: string; document: NativeRunSnapshot }>(
          tx,
          "SELECT state, document FROM heptalogos.life_native_run WHERE run_id=$1 FOR UPDATE",
          [parent.runId],
        );
        if (
          runs[0]?.state !== "running" ||
          parent.nousSessionId !== input.parentNousSessionId
        )
          deny(
            "native_parent_changed",
            "The exact parent is no longer the running Nous binding",
          );
        const saved = await sql<{ document: Handoff }>(
          tx,
          "SELECT document FROM heptalogos.life_handoff WHERE child_session_key=$1 FOR UPDATE",
          [input.childSessionKey],
        );
        const document: Handoff = {
          request: input,
          registration: {
            ...parent.registration,
            usage: runs[0]!.document.appliedUsage ?? parent.registration.usage,
            inheritedMessageSources: parent.registration.sourceRefs.filter((ref) =>
              ref.startsWith("message:"),
            ),
            role: "worker",
            contacts: [],
            messageRefs: [],
          },
        };
        if (saved[0]) {
          if (digest(saved[0].document) !== digest(document))
            deny(
              "native_handoff_changed",
              "The child session already belongs to another exact handoff",
            );
          return;
        }
        await sql(
          tx,
          "INSERT INTO heptalogos.life_handoff(child_session_key,parent_run_id,activity_id,document,recorded_at) VALUES($1,$2,$3,$4::jsonb,$5)",
          [
            input.childSessionKey,
            parent.runId,
            parent.registration.activityId,
            JSON.stringify(document),
            options.now(),
          ],
        );
      });
      return { version: 1, accepted: true };
    },
    async feedback(value) {
      const input = validated(() => hostFeedbackRequestSchema.parse(value));
      return mutate(async (tx) => {
        const contact = await contactIn(tx, input);
        if (input.stage === "pending") {
          const observation = validated(() =>
            decodeObservationInput(input.observation),
          );
          if (
            observation.subjectId !== input.subjectId ||
            observation.sessionId !== input.nousSessionId ||
            !observation.observedAt ||
            !["tool", "generated", "host_event"].includes(observation.sourceClass)
          )
            deny(
              "native_feedback_changed",
              "Feedback must describe actual tool/model facts in the original Subject and Nous Session",
            );
          validated(() =>
            hostContactIdentitySchema.shape.contactRequestId.parse(
              observation.requestId,
            ),
          );
          observation.actorEntityRef = contact.response.scope.actorEntityRef;
          observation.context = {
            ...observation.context,
            ...contact.response.scope.context,
          };
          const normalized = encodeObservationInput(
            withHostObservationScope(observation, {
              usage: decodeCognitionUsage(
                contact.appliedUsage ?? contact.response.usage,
              ),
              activityRef: contact.response.scope.activityRef,
              contactRequestId: input.contactRequestId,
            }),
          );
          const rows = await sql<{ document: Pending }>(
            tx,
            "SELECT document FROM heptalogos.cognition_pending_feedback WHERE request_id=$1 FOR UPDATE",
            [observation.requestId],
          );
          if (rows[0]) {
            if (
              digest(rows[0].document.identity) !== digest(identity(input)) ||
              rows[0].document.factsDigest !== actualFeedback(normalized)
            )
              deny(
                "native_feedback_changed",
                "The actual event identity or result conflicts with its first durable fact",
              );
            return {
              version: 1,
              stage: "pending",
              accepted: true,
              observation: rows[0].document.observation,
            };
          }
          const document: Pending = {
            identity: identity(input),
            observation: normalized,
            factsDigest: actualFeedback(normalized),
          };
          await sql(
            tx,
            "INSERT INTO heptalogos.cognition_pending_feedback(request_id,subject_id,run_id,document,recorded_at) VALUES($1,$2,$3,$4::jsonb,$5)",
            [
              observation.requestId,
              input.subjectId,
              input.native.runId,
              JSON.stringify(document),
              options.now(),
            ],
          );
          return {
            version: 1,
            stage: "pending",
            accepted: true,
            observation: normalized,
          };
        }
        const receipt = validated(() =>
          encodeAcceptedObservation(decodeAcceptedObservation(input.receipt)),
        );
        if (!validated(() => decodeAcceptedObservation(receipt)).occurrenceId)
          invalid();
        const rows = await sql<{ document: Pending; receipt: unknown }>(
          tx,
          "SELECT document,receipt FROM heptalogos.cognition_pending_feedback WHERE request_id=$1 FOR UPDATE",
          [input.observationRequestId],
        );
        if (!rows[0] || digest(rows[0].document.identity) !== digest(identity(input)))
          deny(
            "native_feedback_changed",
            "No exact pending fact belongs to this contact",
          );
        if (rows[0].receipt && digest(rows[0].receipt) !== digest(receipt))
          deny(
            "native_receipt_changed",
            "An accepted feedback receipt cannot be overwritten",
          );
        await sql(
          tx,
          "UPDATE heptalogos.cognition_pending_feedback SET receipt=$2::jsonb,delivered_at=COALESCE(delivered_at,$3) WHERE request_id=$1",
          [input.observationRequestId, JSON.stringify(receipt), options.now()],
        );
        return { version: 1, stage: "committed", accepted: true };
      });
    },
    readRun,
    async recordDeliveryFact(fact) {
      const run = await readRun(fact.runId);
      if (
        !run ||
        run.registration.subjectId !== fact.subjectId ||
        run.registration.activityId !== fact.activityId
      )
        deny(
          "native_delivery_changed",
          "The physical fact must retain its actual registered producer",
        );
      const rows = await readRepositorySql<{ document: Contact }>(
        options.persistence,
        "SELECT document FROM heptalogos.life_native_contact WHERE run_id=$1 AND document ? 'admitted' ORDER BY recorded_at,contact_request_id LIMIT 1",
        [fact.runId],
      );
      const contact = rows[0]?.document;
      if (!contact?.admitted)
        deny(
          "native_delivery_changed",
          "The actual producer has no admitted cognition contact",
        );
      const hash = createHash("sha256")
        .update(
          JSON.stringify([
            fact.reference,
            fact.sourceIndex,
            fact.partIndex,
            fact.attemptId,
            fact.outcome.state,
          ]),
        )
        .digest();
      hash[6] = (hash[6]! & 15) | 128;
      hash[8] = (hash[8]! & 63) | 128;
      const hex = hash.subarray(0, 16).toString("hex");
      const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const usage = decodeCognitionUsage(
        contact.appliedUsage ?? contact.response.usage,
      );
      await service.feedback({
        ...identity(contact.request),
        stage: "pending",
        observation: encodeObservationInput({
          subjectId: fact.subjectId,
          sessionId: contact.request.nousSessionId,
          requestId,
          sourceClass: "host_event",
          externalObjectRef: "object:heptalogos:delivery:" + fact.attemptId,
          conversationRef: usage.audience!.conversationRef,
          actorEntityRef: run.registration.actorEntityRef,
          observedAt: timestampFromDate(new Date(fact.recordedAt)),
          ...(fact.outcome.state === "accepted"
            ? {
                occurredTime: {
                  value: {
                    case: "instant" as const,
                    value: timestampFromDate(new Date(fact.outcome.acceptedAt)),
                  },
                },
              }
            : {}),
          material: {
            case: "inlineText",
            value: { text: JSON.stringify(fact), mediaType: "application/json" },
          },
          context: {
            actual_producer: "heptalogos.agency",
            native_run_ref: fact.runId,
            native_intent_ref: fact.nativeIntentId,
            delivery_reference: fact.reference,
            source_index: fact.sourceIndex,
            part_index: fact.partIndex,
            outcome_state: fact.outcome.state,
          },
        }),
      });
      // A platform acknowledgement waits for local durability, not cognition
      // networking. The dispatch completion or next preparation drains this outbox.
    },
    async finishRun(runId, state) {
      await mutate(async (tx) => {
        const rows = await sql<{ state: string }>(
          tx,
          "SELECT state FROM heptalogos.life_native_run WHERE run_id=$1 FOR UPDATE",
          [runId],
        );
        if (!rows[0])
          deny("native_run_unknown", "The native run has not been admitted");
        if (!["admitted", "running", "uncertain", state].includes(rows[0].state))
          deny(
            "native_run_changed",
            "A terminal native run result cannot be overwritten",
          );
        await sql(
          tx,
          "UPDATE heptalogos.life_native_run SET state=$2,updated_at=$3 WHERE run_id=$1",
          [runId, state, options.now()],
        );
      });
    },
    async flushPendingFeedback(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) invalid();
      const pending = await readRepositorySql<{
        request_id: string;
        document: Pending;
      }>(
        options.persistence,
        "SELECT request_id,document FROM heptalogos.cognition_pending_feedback WHERE delivered_at IS NULL ORDER BY recorded_at,request_id LIMIT $1",
        [limit],
      );
      let delivered = 0;
      for (const row of pending) {
        const observation = validated(() =>
          decodeObservationInput(row.document.observation),
        );
        const receipt = await (
          await options.nous()
        ).runtime.recordObservation(observation);
        await service.feedback({
          ...row.document.identity,
          stage: "committed",
          observationRequestId: row.request_id,
          receipt: encodeAcceptedObservation(receipt),
        });
        delivered++;
      }
      return { delivered };
    },
  };
  return service;
}
