// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Trusted native-input admission and actual cognition feedback, without an agent loop.
 * @module native-cognition
 */
import { selectPerceivedMaterials } from "./perceived-materials.js";
import { createTaskPerceptionReader } from "./native-perceptions.js";
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
  type ForegroundQualification,
  type LifeActivity,
  type createLifeService,
  type AgencyDeliveryFact,
  type ActivityOpportunity,
  consumeActivityOpportunity,
} from "@heptalogos/subject";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { MessagingService } from "@heptalogos/messaging";
import type { NousClient } from "@nous-wave/client";
import {
  hostRunTerminalRequestSchema,
  type HostRunTerminalRequest,
  type HostRunTerminalResponse,
  hostPrepareRequestSchema,
  hostPrepareResponseSchema,
  hostPrepareResponseFields,
  hostAdmittedRequestSchema,
  hostHandoffRequestSchema,
  hostFeedbackRequestSchema,
  hostToolExecutionRequestSchema,
  hostCompletionRequestSchema,
  type HostCompletionRequest,
  type HostRoleScope,
  type HostTokenBudget,
  hostTokenBudgetSchema,
  hostRoleScopeSchema,
  hostResultReleaseRequestSchema,
  hostResultReleaseResponseSchema,
  type HostResultReleaseResponse,
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
  type ObservationInput,
  type HostHandoffRequest,
} from "@nous-wave/client/host-bridge";
import type {
  NativeActivityParams,
  ActivityDispatchResult,
} from "./activity-dispatch-contracts.js";
import { hasAuthorizedNativeSources } from "./native-source-selection.js";
import {
  nativeLifeRequestSchema,
  type NativeLifeRequest,
  type NativeLifeReadAction,
  type NativeLifeReadResponse,
} from "./native-life-contracts.js";
import {
  isNativeLifeReadAction,
  type BoundLifeReadBinding,
} from "./native-life-read.js";
import type { GatewayCognitionBridge } from "./gateway-http.js";

/** Persisted exact native-run selection; only the trusted Host may construct it. */
export interface Registration {
  readonly subjectId: string;
  readonly activityId: string;
  readonly sessionKey: string;
  readonly nativeAgentId: string;
  readonly nativeRunId: string;
  readonly promptDigest: string;
  readonly currentContextDigest?: string;
  readonly role: "main" | "worker";
  readonly roleScope: HostRoleScope;
  readonly tokenBudget: HostTokenBudget;
  readonly allowedToolNames: readonly string[];
  readonly responseFormat?: HostPrepareResponse["responseFormat"];
  readonly providerPolicyState?: "configured" | "unconfigured";
  readonly actorEntityRef: string;
  readonly workContextId: string;
  readonly usage: HostPrepareResponse["usage"];
  readonly sourceRefs: readonly string[];
  readonly messageRefs: readonly string[];
  readonly parentRunId?: string;
  /** Exact immutable Subject choice authorizing this professional task. Host-only. */
  readonly adoptedDecisionRef?: string;
  /** Internal revocable foreground capability; never derived from model arguments. */
  readonly foreground?: ForegroundQualification;
  /** Owner-derived exact inherited roots; callers cannot grant these fields. */
  readonly inheritedSourceRefs?: readonly string[];
  readonly inheritedMessageSources?: readonly string[];
  readonly contacts: HostPrepareResponse["contacts"];
  readonly opportunity?: ActivityOpportunity;
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
  readonly latestAppliedContactRequestId?: string;
}
/** Execution output for trusted Host orchestration, without Subject ingestion. */
export interface NativeRoleResults {
  readonly run: NativeRunSnapshot;
  readonly results: {
    resultId: string;
    observation: HostPrepareResponse["contacts"][number]["observation"];
  }[];
  readonly omitted: boolean;
}
/** Local interpretation failure of an actual retained provider response. */
export interface NativeRoleOutputProblem {
  readonly code: string;
  readonly detail: string;
}
/** Official admitted Projection wire and actual caller metadata; no second cognition DTO. */
export interface NativeAppliedContext {
  readonly runId: string;
  readonly contactRequestId: string;
  readonly invocationId: string;
  readonly roleScope: HostRoleScope;
  readonly projection: HostAdmittedRequest["projection"];
  readonly occurrences: HostAdmittedRequest["occurrences"];
  readonly usage: HostPrepareResponse["usage"];
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
  lifeReads?: Record<
    string,
    {
      requestDigest: string;
      action: NativeLifeReadAction["action"];
      sourceRefs: readonly string[];
      completed?: true;
    }
  >;
};
const lifeReadTrace = (contact: Contact, toolCallId: string) =>
  contact.lifeReads && Object.hasOwn(contact.lifeReads, toolCallId)
    ? contact.lifeReads[toolCallId]
    : undefined;
type Pending = {
  origin?: "agency_delivery" | "life_retrieval";
  identity: Omit<HostPrepareRequest, "promptDigest">;
  observation: HostPrepareResponse["contacts"][number]["observation"];
  factsDigest: string;
};
type Handoff = { request: HostHandoffRequest; registration: Registration };
/** Product composition supplies real existing owners and explicit recovery opportunities. */
export interface NativeCognitionOptions {
  readonly persistence: PersistenceService;
  readonly life: Pick<
    ReturnType<typeof createLifeService>,
    "get" | "worldNow" | "progressIn"
  >;
  readonly readLife?: (
    binding: BoundLifeReadBinding,
    request: NativeLifeReadAction,
  ) => Promise<NativeLifeReadResponse>;
  readonly captureObservedStamp: (
    subjectId: string,
  ) => Promise<NonNullable<ObservationInput["observedStamp"]>>;
  readonly now: () => string;
  /** Effective Product limit, read before entering a short task reservation transaction. */
  readonly workerConcurrency?: (
    transaction?: PersistenceInternalTransaction,
  ) => Promise<number>;
  /** Projects a normal native wake after terminal durability, never reads/releases results. */
  readonly onRunReady?: (input: {
    subjectId: string;
    activityId: string;
    runId: string;
  }) => Promise<void>;
  /** Existing product role configuration supplies the actual execution profile policy. */
  readonly resolveChildProviderPolicy?: (
    parent: NativeRunSnapshot,
    childNativeAgentId: string,
  ) => Promise<{ tokenBudget: HostTokenBudget; allowedToolNames: readonly string[] }>;
  /** Canonical Decision/World owners authorize exact adopted task sources before and inside registration. */
  readonly authorizeAdoptedTaskSources?: (
    registration: Readonly<Registration>,
    parent: NativeRunSnapshot,
    transaction?: PersistenceInternalTransaction,
  ) => Promise<void>;
  /** External cognition/Pursuit checks run before any fenced write transaction. */
  readonly checkInput?: (
    registration: Readonly<Registration>,
    activity: LifeActivity,
  ) => Promise<void>;
  /** Production Reactor checks provider/tool entry against the exact current foreground. */
  readonly assertForegroundIn?: (
    transaction: PersistenceInternalTransaction,
    registration: Readonly<Registration>,
  ) => Promise<void | { continuationSourceRef: string }>;
  /** Retained result viewing checks current source/Activity authority without granting a new provider attempt. */
  readonly authorizeRetainedResult?: (
    registration: Readonly<Registration>,
    activity: LifeActivity,
    transaction: PersistenceInternalTransaction,
  ) => Promise<void>;
  /** Rechecks only current local authority while holding the actual Activity/send-point fence. */
  readonly authorizeInput: (
    registration: Readonly<Registration>,
    activity: LifeActivity,
    transaction?: PersistenceInternalTransaction,
  ) => Promise<void>;
  /** Completes exact World owner handoffs only after the actual admitted occurrence receipt. */
  readonly onWorldContactsAdmitted?: (
    input: HostAdmittedRequest,
    registration: Readonly<Registration>,
  ) => Promise<void>;
  readonly recordContact: MessagingService["recordContact"];
  readonly nous: () => Promise<Pick<NousClient, "runtime" | "material">>;
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
/** Product role is supplied only by the trusted caller, independently of native position. */
function roleScope(registration: Registration): HostRoleScope {
  return validated(() => hostRoleScopeSchema.parse(registration.roleScope));
}
function providerPolicy(registration: Registration) {
  if (registration.providerPolicyState !== "configured")
    deny(
      "native_provider_policy_unconfigured",
      "This retained run has no configured provider budget/tool policy; preserve its result and start a newly configured invocation",
    );
  const tokenBudget = validated(() =>
    hostTokenBudgetSchema.parse(registration.tokenBudget),
  );
  const allowedToolNames = validated(() =>
    hostPrepareResponseFields.allowedToolNames.parse(registration.allowedToolNames),
  );
  const responseFormat = validated(() =>
    hostPrepareResponseFields.responseFormat.parse(registration.responseFormat),
  );
  return { tokenBudget, allowedToolNames, responseFormat };
}
function current(activity: LifeActivity, registration: Registration) {
  if (
    activity.subjectId !== registration.subjectId ||
    activity.activityId !== registration.activityId ||
    ((registration.roleScope.role !== "narrative.review" || registration.foreground) &&
      (activity.state !== "active" || activity.continuationRequired)) ||
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
    (!usage.audience?.conversationRef && usage.audience?.visibility !== "internal") ||
    (usage.audience?.conversationRef &&
      !activity.scope.conversations.some(
        (scope) =>
          scope.conversationRef === usage.audience!.conversationRef &&
          scope.operations.includes("observe"),
      ))
  )
    deny(
      "native_audience_denied",
      "The registered audience is outside the Activity's observe scope",
    );
}
function actualFeedback(value: Pending["observation"]) {
  // A retry may discover the same event later; the first actual observedAt and
  // observedStamp stay with the pending fact. Canonical worldObserved remains
  // event content and cannot change or be backfilled by a retry.
  const facts = { ...value };
  delete facts.observedAt;
  delete facts.observedStamp;
  return digest(facts);
}

/** Replays compare actual event facts, while the first Host envelope stays authoritative. */
function assertFeedbackReplay(
  saved: Pending,
  incoming: Pending["observation"],
  claimed: ReturnType<typeof identity>,
) {
  if (digest(saved.identity) !== digest(claimed))
    deny(
      "native_feedback_changed",
      "The callback must retain its first native contact identity",
    );
  const previous = validated(() => decodeObservationInput(saved.observation));
  const proposed = validated(() => decodeObservationInput(incoming));
  previous.context ??= {};
  proposed.context ??= {};
  // The SDK may omit the actor selected by the first Host admission.
  proposed.actorEntityRef ??= previous.actorEntityRef;
  for (const key of [
    "activity_ref",
    "contact_request_id",
    "cognition_usage",
    "native_role",
  ]) {
    delete previous.context[key];
    delete proposed.context[key];
  }
  for (const key of ["native_model", "native_provider", "native_api"]) {
    if (
      previous.context[key] !== undefined &&
      proposed.context[key] !== undefined &&
      digest(previous.context[key]) !== digest(proposed.context[key])
    )
      deny(
        "native_feedback_changed",
        "An existing native audit fact cannot be contradicted",
      );
    // A newer diagnostic does not backfill an originally unknown snapshot.
    delete previous.context[key];
    delete proposed.context[key];
  }
  if (
    actualFeedback(encodeObservationInput(previous)) !==
    actualFeedback(encodeObservationInput(proposed))
  )
    deny(
      "native_feedback_changed",
      "The actual event content conflicts with its first durable fact",
    );
}

/** No polling, model calls, network sends, or parallel durable queue is created here. */
export function createNativeCognitionBridge(options: NativeCognitionOptions) {
  const readTaskPerceptions = createTaskPerceptionReader(options);
  const mutate = <T>(run: (tx: PersistenceInternalTransaction) => Promise<T>) =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, run),
    );
  const assertTaskCapacityIn = async (
    tx: PersistenceInternalTransaction,
    subjectId: string,
    limit: number | undefined,
  ) => {
    limit = (await options.workerConcurrency?.(tx)) ?? limit;
    if (limit === undefined) return;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) invalid();
    const rows = await sql<{ count: string }>(
      tx,
      `SELECT count(*)::text AS count FROM (
      SELECT i.native_run_id AS id FROM heptalogos.life_native_input i
      LEFT JOIN heptalogos.life_native_run r ON r.run_id=i.native_run_id
      WHERE i.subject_id=$1 AND i.document#>>'{registration,roleScope,role}'='subject.execution'
      AND COALESCE(r.state,'registered') NOT IN ('completed','failed','cancelled')
      UNION
      SELECT r.run_id FROM heptalogos.life_native_run r WHERE r.subject_id=$1
      AND r.document#>>'{registration,roleScope,role}'='subject.execution' AND r.state NOT IN ('completed','failed','cancelled')
      UNION
      SELECT h.child_session_key FROM heptalogos.life_handoff h
      WHERE h.document#>>'{registration,subjectId}'=$1::text
      AND NOT EXISTS(SELECT 1 FROM heptalogos.life_native_run r WHERE r.session_key=h.child_session_key)
    ) active_tasks`,
      [subjectId],
    );
    if (Number(rows[0]!.count) >= limit)
      deny(
        "native_worker_capacity",
        "The actual concurrent native task budget is occupied; retain ready/unknown tasks without rerunning",
      );
  };
  const captureObservedStamp = async (subjectId: string) => {
    const stamp = await options.captureObservedStamp(subjectId);
    if (!stamp?.at || !stamp.recordedAt || !stamp.timeDomainRef)
      deny(
        "native_clock_unavailable",
        "Actual contact requires the official Subject clock capture",
      );
    return stamp;
  };
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
  const checkInput = async (registration: Registration) => {
    const activity = await options.life.get(
      registration.subjectId,
      registration.activityId,
    );
    if (!activity)
      deny("native_activity_unavailable", "The registered Activity no longer exists");
    current(activity, registration);
    await options.checkInput?.(registration, activity);
  };
  const matchesHandoff = (
    handoff: Handoff | undefined,
    input: HostPrepareRequest,
  ): handoff is Handoff =>
    !!handoff &&
    input.native.parentSessionKey === handoff.request.parentSessionKey &&
    input.native.sessionId === handoff.request.childSessionId &&
    input.native.agentId === handoff.request.childNativeAgentId &&
    input.nousSessionId === handoff.request.childNousSessionId;
  const delegatedRegistration = (
    source: Registration,
    input: HostPrepareRequest,
  ): Registration => ({
    ...source,
    sessionKey: input.native.sessionKey,
    nativeAgentId: input.native.agentId,
    nativeRunId: input.native.runId,
    promptDigest: input.promptDigest,
    role: "worker",
    roleScope: {
      role: "subject.execution",
      purpose: "professional_execution",
      view: "worker",
      contactNature: "execution_only",
    },
    messageRefs: [],
    contacts: [],
  });
  const prepareRegistration = async (
    input: HostPrepareRequest,
  ): Promise<Registration> => {
    const rows = await readRepositorySql<{ document: StoredInput }>(
      options.persistence,
      "SELECT document FROM heptalogos.life_native_input WHERE session_key=$1 AND native_run_id=$2",
      [input.native.sessionKey, input.native.runId],
    );
    let registration = rows[0]?.document.registration;
    if (!registration) {
      const handoffs = await readRepositorySql<{ document: Handoff }>(
        options.persistence,
        "SELECT document FROM heptalogos.life_handoff WHERE child_session_key=$1",
        [input.native.sessionKey],
      );
      const handoff = handoffs[0]?.document;
      if (!matchesHandoff(handoff, input))
        deny(
          "native_input_unregistered",
          "The exact native input has no trusted registration or isolated handoff",
        );
      registration = delegatedRegistration(handoff.registration, input);
    }
    if (registration.subjectId !== input.subjectId)
      deny(
        "native_subject_changed",
        "Native input cannot change the registered Subject",
      );
    if (registration.nativeAgentId !== input.native.agentId)
      deny(
        "native_agent_changed",
        "The real native agent must match the trusted account binding, including delegated workers",
      );
    if (registration.promptDigest !== input.promptDigest)
      deny("native_input_unregistered", "The exact native prompt was not registered");
    providerPolicy(registration);
    await checkInput(registration);
    return registration;
  };
  const readRun = async (
    runId: string,
    transaction?: PersistenceInternalTransaction,
  ): Promise<NativeRunSnapshot | undefined> => {
    const statement =
      "SELECT state,document FROM heptalogos.life_native_run WHERE run_id=$1";
    const rows = transaction
      ? await sql<{ state: string; document: Omit<NativeRunSnapshot, "state"> }>(
          transaction,
          statement,
          [runId],
        )
      : await readRepositorySql<{
          state: string;
          document: Omit<NativeRunSnapshot, "state">;
        }>(
          options.persistence,
          "SELECT state,document FROM heptalogos.life_native_run WHERE run_id=$1",
          [runId],
        );
    return rows[0] ? { ...rows[0].document, state: rows[0].state } : undefined;
  };
  const readResultParent = async (
    subjectId: string,
    childRunId: string,
    transaction?: PersistenceInternalTransaction,
  ): Promise<string> => {
    const child = await readRun(childRunId, transaction);
    if (
      !child ||
      child.registration.subjectId !== subjectId ||
      !child.consumerId ||
      roleScope(child.registration).role !== "subject.execution" ||
      roleScope(child.registration).contactNature !== "execution_only"
    )
      deny(
        "native_result_release_denied",
        "An execution result requires its exact Subject and retained native binding",
      );
    const read = <T>(statement: string, parameters: readonly unknown[]) =>
      transaction
        ? sql<T>(transaction, statement, parameters)
        : readRepositorySql<T>(options.persistence, statement, parameters);
    const links = await read<{ parent_run_id: string; document: Handoff }>(
      "SELECT parent_run_id,document FROM heptalogos.life_handoff WHERE child_session_key=$1" +
        (transaction ? " FOR SHARE" : ""),
      [child.native.sessionKey],
    );
    const link = links[0];
    const parentRunId = link?.parent_run_id ?? child.registration.parentRunId;
    const parent = parentRunId ? await readRun(parentRunId, transaction) : undefined;
    if (
      !parent ||
      parent.registration.subjectId !== subjectId ||
      parent.registration.activityId !== child.registration.activityId ||
      !parent.consumerId
    )
      deny(
        "native_result_release_denied",
        "The execution result must retain its exact same-Subject Activity parent",
      );
    if (link) {
      const handoff = link.document.request;
      if (
        child.registration.role !== "worker" ||
        handoff.subjectId !== subjectId ||
        link.document.registration.subjectId !== subjectId ||
        link.document.registration.activityId !== child.registration.activityId ||
        (child.registration.parentRunId !== undefined &&
          child.registration.parentRunId !== parent.runId) ||
        link.parent_run_id !== parent.runId ||
        handoff.parentRunId !== parent.runId ||
        handoff.parentSessionKey !== parent.native.sessionKey ||
        handoff.parentSessionId !== parent.native.sessionId ||
        handoff.parentNousSessionId !== parent.nousSessionId ||
        handoff.childSessionKey !== child.native.sessionKey ||
        handoff.childSessionId !== child.native.sessionId ||
        handoff.childNousSessionId !== child.nousSessionId ||
        handoff.childNativeAgentId !== child.native.agentId ||
        child.native.parentSessionKey !== parent.native.sessionKey
      )
        deny(
          "native_result_release_denied",
          "The worker must retain its exact immutable native handoff",
        );
    } else {
      const selected = await read<{ document: StoredInput }>(
        "SELECT document FROM heptalogos.life_native_input WHERE session_key=$1 AND native_run_id=$2" +
          (transaction ? " FOR SHARE" : ""),
        [child.native.sessionKey, child.runId],
      );
      if (
        child.native.parentSessionKey ||
        child.registration.parentRunId !== parent.runId ||
        !selected[0] ||
        digest(selected[0].document.registration) !== digest(child.registration)
      )
        deny(
          "native_result_release_denied",
          "A direct execution RoleRun requires its original exact registered parent",
        );
    }
    return parent.runId;
  };
  const readOperatorRuns = async (
    subjectId: string,
    activityId: string,
    includeInputs: boolean,
    before?: string,
    runId?: string,
  ) => {
    const rows = await readRepositorySql<{
      run_id: string;
      recorded_at: string;
      document: StoredInput;
      run: NativeRunSnapshot | null;
    }>(
      options.persistence,
      `SELECT i.native_run_id AS run_id,i.recorded_at::text,i.document,r.document AS run
        FROM heptalogos.life_native_input i LEFT JOIN heptalogos.life_native_run r ON r.run_id=i.native_run_id
        WHERE i.subject_id=$1 AND i.activity_id=$2 AND ($4::text IS NULL OR i.native_run_id=$4)
        AND ($3::text IS NULL OR (i.recorded_at,i.native_run_id)<(SELECT recorded_at,native_run_id FROM heptalogos.life_native_input WHERE subject_id=$1 AND activity_id=$2 AND native_run_id=$3))
        ORDER BY i.recorded_at DESC,i.native_run_id DESC LIMIT 33`,
      [subjectId, activityId, before ?? null, runId ?? null],
    );
    return {
      runs: rows.slice(0, 32).map((row) => ({
        runId: row.run_id,
        role: row.document.registration.roleScope?.role ?? "unknown",
        purpose: row.document.registration.roleScope?.purpose ?? "unknown",
        recordedAt: row.recorded_at,
        dispatchState: row.document.dispatch?.state ?? "registered",
        outputProblem: (() => {
          const result = row.document.dispatch?.result;
          if (!result || typeof result !== "object" || !("outputProblem" in result))
            return null;
          const problem = result.outputProblem;
          return problem &&
            typeof problem === "object" &&
            "code" in problem &&
            typeof problem.code === "string" &&
            "detail" in problem &&
            typeof problem.detail === "string"
            ? { code: problem.code, detail: problem.detail }
            : null;
        })(),
        native: row.run
          ? {
              subjectId,
              runId: row.run_id,
              agentId: row.document.registration.nativeAgentId,
              sessionId: row.run.native.sessionId,
              sessionKey: row.document.registration.sessionKey,
            }
          : null,
        ...(includeInputs
          ? {
              hostInput: {
                message: row.document.prompt ?? "",
                extraSystemPrompt:
                  row.document.dispatch?.params.extraSystemPrompt ?? "",
              },
            }
          : {}),
      })),
      nextRunId: rows.length > 32 ? rows[31]!.run_id : null,
    };
  };
  const service: GatewayCognitionBridge & {
    operatorRuns: typeof readOperatorRuns;
    /** Reads saved execution metering without provider calls or result release. */
    operatorUsage(subjectId: string): Promise<
      {
        role: string;
        purpose: string;
        activityId: string;
        recordedRuns: number;
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        missingUsage: number;
        cost: null;
      }[]
    >;
    registerInput(
      input: Omit<
        Registration,
        | "promptDigest"
        | "usage"
        | "inheritedMessageSources"
        | "inheritedSourceRefs"
        | "providerPolicyState"
        | "currentContextDigest"
      > & {
        readonly prompt: string;
        readonly extraSystemPrompt?: string;
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
    /** Actual unadopted local choices remain task material for a later current decision. */
    unadoptedDecisions(
      subjectId: string,
      activityId: string,
    ): Promise<{ runId: string; sourceRefs: readonly string[]; decision: unknown }[]>;
    /** Records only derived interpretation; original registration and provider result stay immutable. */
    recordRoleOutput(
      subjectId: string,
      runId: string,
      output: { structuredOutput?: unknown; outputProblem?: NativeRoleOutputProblem },
    ): Promise<void>;
    /** Bounded terminal execution directory. Bodies remain in RoleRun until explicit viewing. */
    readyResults(input: {
      subjectId: string;
      limit: number;
      afterRunId?: string;
    }): Promise<{
      runs: {
        runId: string;
        role: string;
        activityId: string;
        terminalAt: string;
        resultCount: number;
        adoptedDecisionRef?: string;
      }[];
      more: boolean;
      nextRunId?: string;
    }>;
    /** Resolves a worker handoff or direct RoleRun parent without rewriting its registration. */
    readResultParent: typeof readResultParent;
    /** Trusted Host reads execution output; this operation creates no Subject contact. */
    readRoleResults(subjectId: string, runId: string): Promise<NativeRoleResults>;
    /** Reads the immutable release receipt before a retry selects any newly arrived output. */
    readResultRelease(
      subjectId: string,
      requestId: string,
    ): Promise<HostResultReleaseResponse | undefined>;
    /** Trusted Host reads what Nous actually applied, including its official EpistemicView. */
    readAppliedContext(runId: string): Promise<NativeAppliedContext>;
    /** Metadata receipt lookup never reads source bodies or synthesizes experience. */
    hasAcceptedSource(
      subjectId: string,
      sourceRef: string,
      transaction?: PersistenceInternalTransaction,
    ): Promise<boolean>;
    readTaskPerceptions: typeof readTaskPerceptions;
    readRun: typeof readRun;
    /** Trusted recovery checks whether the original input ever crossed Host prepare. */
    readInputState(
      subjectId: string,
      runId: string,
      transaction?: PersistenceInternalTransaction,
    ): Promise<
      | { registration: Registration; prepared: boolean; extraSystemPrompt?: string }
      | undefined
    >;
    recordDeliveryFact(fact: AgencyDeliveryFact): Promise<void>;
    finishRun(
      runId: string,
      state: "completed" | "cancelled" | "failed" | "uncertain",
    ): Promise<void>;
    flushPendingFeedback(limit: number): Promise<{ delivered: number }>;
  } = {
    operatorRuns: readOperatorRuns,
    async operatorUsage(subjectId) {
      const rows = await readRepositorySql<{
        role: string;
        purpose: string;
        activity_id: string;
        metadata: {
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
          };
        } | null;
      }>(
        options.persistence,
        "SELECT document#>>'{registration,roleScope,role}' AS role, document#>>'{registration,roleScope,purpose}' AS purpose, activity_id, document#>'{dispatch,result,nativeResult,result,meta,agentMeta}' AS metadata FROM heptalogos.life_native_input WHERE subject_id=$1",
        [subjectId],
      );
      const groups = new Map<
        string,
        {
          role: string;
          purpose: string;
          activityId: string;
          recordedRuns: number;
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
          missingUsage: number;
          cost: null;
        }
      >();
      for (const row of rows) {
        const key = `${row.role}:${row.purpose}:${row.activity_id}`;
        const group = groups.get(key) ?? {
          role: row.role ?? "unknown",
          purpose: row.purpose ?? "unknown",
          activityId: row.activity_id,
          recordedRuns: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          missingUsage: 0,
          cost: null,
        };
        group.recordedRuns++;
        const usage = row.metadata?.usage;
        if (!usage) group.missingUsage++;
        else
          for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const)
            group[field] += usage[field] ?? 0;
        groups.set(key, group);
      }
      return [...groups.values()];
    },
    async registerInput(input, dispatch) {
      const taskLimit =
        input.roleScope.role === "subject.execution"
          ? await options.workerConcurrency?.()
          : undefined;
      const { prompt, usage, extraSystemPrompt, ...selection } = input;
      if (
        "inheritedMessageSources" in input ||
        "inheritedSourceRefs" in input ||
        "providerPolicyState" in input ||
        "currentContextDigest" in input
      )
        invalid();
      const sourceParent = input.parentRunId
        ? await readRun(input.parentRunId)
        : undefined;
      const retainedExpressionParent =
        input.roleScope.role === "narrative.review" &&
        sourceParent?.registration.roleScope.role === "subject.render" &&
        !!sourceParent.consumerId;
      if (
        input.parentRunId &&
        (!sourceParent ||
          sourceParent.registration.subjectId !== input.subjectId ||
          sourceParent.registration.activityId !== input.activityId ||
          (!["running", "completed"].includes(sourceParent.state) &&
            !retainedExpressionParent))
      )
        deny(
          "native_parent_sources_denied",
          "Role inheritance requires its exact same-Subject/Activity parent",
        );
      const expandedTaskSources =
        !!sourceParent &&
        input.sourceRefs.some(
          (ref) => !sourceParent.registration.sourceRefs.includes(ref),
        );
      if (
        (expandedTaskSources || input.adoptedDecisionRef) &&
        (!sourceParent ||
          input.roleScope.role !== "subject.execution" ||
          !input.adoptedDecisionRef ||
          !options.authorizeAdoptedTaskSources)
      )
        deny(
          "native_parent_sources_denied",
          "Additional professional sources require the exact adopted task and canonical owner authorization",
        );
      if (sourceParent) await checkInput(sourceParent.registration);
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
      validated(() => hostRoleScopeSchema.parse(input.roleScope));
      validated(() => hostTokenBudgetSchema.parse(input.tokenBudget));
      validated(() =>
        hostPrepareResponseFields.responseFormat.parse(input.responseFormat),
      );
      validated(() =>
        hostPrepareResponseFields.allowedToolNames.parse(input.allowedToolNames),
      );
      for (const contact of input.contacts) {
        if (!contact.contactRef.startsWith("role-result-release:")) continue;
        const releaseRef = contact.contactRef.slice("role-result-release:".length);
        validated(() =>
          hostContactIdentitySchema.shape.contactRequestId.parse(releaseRef),
        );
        const releases = await readRepositorySql<{
          subject_id: string;
          document: { response: HostResultReleaseResponse };
        }>(
          options.persistence,
          "SELECT subject_id,document FROM heptalogos.role_result_release WHERE request_id=$1",
          [releaseRef],
        );
        const canonical = releases[0];
        if (
          !canonical ||
          canonical.subject_id !== input.subjectId ||
          canonical.document.response.activityRef !== input.activityId ||
          !canonical.document.response.contacts.some(
            (saved) => digest(saved) === digest(contact),
          )
        )
          deny(
            "native_result_release_changed",
            "A Subject contact must use the exact canonical release, not replacement result text",
          );
      }
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
      const known =
        !sourceParent && input.roleScope.view === "subject"
          ? await readTaskPerceptions({
              subjectId: input.subjectId,
              activityId: input.activityId,
              workContextId: input.workContextId,
              conversationRef:
                decodeCognitionUsage(canonicalUsage).audience?.conversationRef,
              sourceRefs: input.sourceRefs,
            })
          : undefined;
      const registration: Registration = {
        ...selection,
        providerPolicyState: "configured",
        ...(sourceParent
          ? {
              inheritedSourceRefs: [...input.sourceRefs],
              inheritedMessageSources: input.sourceRefs.filter((ref) =>
                ref.startsWith("message:"),
              ),
            }
          : {}),
        ...(!sourceParent && known?.sourceRefs.length
          ? {
              inheritedMessageSources: known.sourceRefs.filter((ref) =>
                ref.startsWith("message:"),
              ),
            }
          : {}),
        contacts,
        usage: canonicalUsage,
        promptDigest: createHash("sha256").update(prompt).digest("hex"),
        ...(extraSystemPrompt !== undefined
          ? {
              currentContextDigest: createHash("sha256")
                .update(extraSystemPrompt)
                .digest("hex"),
            }
          : {}),
      };
      if (registration.adoptedDecisionRef)
        await options.authorizeAdoptedTaskSources!(registration, sourceParent!);
      await checkInput(registration);
      const selected = await mutate(async (tx) => {
        await sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          input.subjectId,
        ]);
        if (sourceParent) {
          await sql(
            tx,
            "SELECT run_id FROM heptalogos.life_native_run WHERE run_id=$1 FOR SHARE",
            [sourceParent.runId],
          );
          const actualParent = await readRun(sourceParent.runId, tx);
          if (
            !actualParent ||
            !["running", "completed"].includes(actualParent.state) ||
            digest(actualParent.registration) !== digest(sourceParent.registration)
          )
            deny(
              "native_parent_sources_denied",
              "The exact source parent changed before role registration",
            );
          if (registration.adoptedDecisionRef)
            await options.authorizeAdoptedTaskSources!(registration, actualParent, tx);
        }
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
        await assertTaskCapacityIn(tx, input.subjectId, taskLimit);
        await sessionLock(tx, input.sessionKey);
        const activity = await lockedActivity(tx, input.subjectId, input.activityId);
        current(activity, registration);
        await options.assertForegroundIn?.(tx, registration);
        if (!sourceParent && known?.sourceRefs.length) {
          const actualKnown = await readTaskPerceptions(
            {
              subjectId: input.subjectId,
              activityId: input.activityId,
              workContextId: input.workContextId,
              conversationRef:
                decodeCognitionUsage(canonicalUsage).audience?.conversationRef,
              sourceRefs: input.sourceRefs,
            },
            tx,
          );
          if (known.sourceRefs.some((ref) => !actualKnown.sourceRefs.includes(ref)))
            deny(
              "native_perception_scope_changed",
              "The Task's previously admitted material scope changed",
            );
        }
        await options.authorizeInput(registration, activity, tx);
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
        if (registration.opportunity)
          await consumeActivityOpportunity(
            tx,
            activity,
            registration.opportunity,
            options.now(),
          );
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
    async unadoptedDecisions(subjectId, activityId) {
      const activity = await options.life.get(subjectId, activityId);
      if (!activity?.scope) return [];
      const rows = await readRepositorySql<{ run_id: string; document: StoredInput }>(
        options.persistence,
        "SELECT i.native_run_id AS run_id,i.document FROM heptalogos.life_native_input i WHERE i.subject_id=$1 AND i.activity_id=$2 AND i.document#>>'{registration,roleScope,role}'='subject.deliberation' AND i.document#>>'{dispatch,state}'='completed' AND i.document#>'{dispatch,result,structuredOutput}' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM heptalogos.subject_decision d WHERE d.subject_id=i.subject_id AND d.source_run_id=i.native_run_id) ORDER BY i.recorded_at DESC LIMIT 4",
        [subjectId, activityId],
      );
      return rows.flatMap((row) => {
        if (
          row.document.registration.actorEntityRef !== activity.adoptedBy ||
          !hasAuthorizedNativeSources(activity, row.document.registration)
        )
          return [];
        const result = row.document.dispatch?.result;
        return result && typeof result === "object" && "structuredOutput" in result
          ? [
              {
                runId: row.run_id,
                sourceRefs: row.document.registration.sourceRefs,
                decision: result.structuredOutput,
              },
            ]
          : [];
      });
    },
    async recordRoleOutput(subjectId, runId, output) {
      await mutate(async (tx) => {
        const rows = await sql<{ document: StoredInput }>(
          tx,
          "SELECT document FROM heptalogos.life_native_input WHERE subject_id=$1 AND native_run_id=$2 FOR UPDATE",
          [subjectId, runId],
        );
        const saved = rows[0]?.document;
        const result = saved?.dispatch?.result;
        if (
          !saved?.dispatch ||
          saved.dispatch.state !== "completed" ||
          !result ||
          typeof result !== "object" ||
          !("kind" in result) ||
          result.kind !== "subject_role_result"
        )
          deny(
            "native_role_output_unavailable",
            "Only an original completed role response can be interpreted",
          );
        if ("structuredOutput" in result && result.structuredOutput !== undefined)
          return;
        const { outputProblem: _oldProblem, ...original } = result as Record<
          string,
          unknown
        >;
        await sql(
          tx,
          "UPDATE heptalogos.life_native_input SET document=$3::jsonb WHERE subject_id=$1 AND native_run_id=$2",
          [
            subjectId,
            runId,
            JSON.stringify({
              ...saved,
              dispatch: { ...saved.dispatch, result: { ...original, ...output } },
            }),
          ],
        );
      });
    },
    async prepare(value) {
      const input = validated(() => hostPrepareRequestSchema.parse(value));
      const preflight = await prepareRegistration(input);
      const prior = await readRepositorySql<{ document: StoredInput }>(
        options.persistence,
        "SELECT document FROM heptalogos.life_native_input WHERE session_key=$1 AND native_run_id=$2",
        [input.native.sessionKey, input.native.runId],
      );
      const observedStamp =
        !prior[0]?.document.firstContact &&
        roleScope(preflight).contactNature === "subject_experience" &&
        preflight.contacts.some(
          (contact) => !decodeObservationInput(contact.observation).worldRealized,
        )
          ? await captureObservedStamp(input.subjectId)
          : undefined;
      const known = await readTaskPerceptions({
        subjectId: preflight.subjectId,
        activityId: preflight.activityId,
        workContextId: preflight.workContextId,
        conversationRef: decodeCognitionUsage(preflight.usage).audience
          ?.conversationRef,
        sourceRefs: preflight.sourceRefs,
      });
      const currentSources = known.accepted.length
        ? await selectPerceivedMaterials(
            preflight.subjectId,
            known,
            (await options.nous()).material,
          )
        : [];
      if (input.currentContextDigest !== preflight.currentContextDigest)
        deny(
          "native_context_changed",
          "The actual ephemeral context differs from this trusted registered input",
        );
      const prepared = await mutate(async (tx) => {
        await sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          input.subjectId,
        ]);
        await sessionLock(tx, input.native.sessionKey);
        const foreignRole = await sql<{ run_id: string }>(
          tx,
          "SELECT run_id FROM heptalogos.life_native_run WHERE subject_id=$1 AND session_key=$2 AND document#>>'{native,sessionId}'=$3 AND document#>>'{native,historyGeneration}'=$4 AND (document#>'{registration,roleScope}'<>$5::jsonb OR document#>'{registration,usage,audience}'<>$6::jsonb) LIMIT 1 FOR SHARE",
          [
            input.subjectId,
            input.native.sessionKey,
            input.native.sessionId,
            input.native.historyGeneration,
            JSON.stringify(preflight.roleScope),
            JSON.stringify(preflight.usage.audience),
          ],
        );
        if (foreignRole[0])
          deny(
            "native_role_history_changed",
            "This native history contains another execution view or audience; create a clean role Session or explicitly reset its history",
          );
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
          if (!matchesHandoff(handoff, input))
            deny(
              "native_input_unregistered",
              "The exact prompt needs trusted Host registration or an exact isolated handoff",
            );
          inheritedParent = handoffs[0]!.parent_run_id;
          registration = delegatedRegistration(handoff.registration, input);
        }
        if (digest(registration) !== digest(preflight))
          deny(
            "native_input_changed",
            "The trusted input changed during external checks",
          );
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
        const continuation = await options.assertForegroundIn?.(tx, registration);
        await options.authorizeInput(registration, activity, tx);
        if (known.accepted.length) {
          const fresh = await readTaskPerceptions(
            {
              subjectId: registration.subjectId,
              activityId: registration.activityId,
              workContextId: registration.workContextId,
              conversationRef: decodeCognitionUsage(registration.usage).audience
                ?.conversationRef,
              sourceRefs: registration.sourceRefs,
            },
            tx,
          );
          const allowed = new Set(
            fresh.accepted.map(
              (item) => decodeAcceptedObservation(item.receipt).occurrenceId,
            ),
          );
          if (
            known.accepted.some(
              (item) =>
                !allowed.has(decodeAcceptedObservation(item.receipt).occurrenceId),
            )
          )
            deny(
              "native_perception_scope_changed",
              "The selected actual Task material is no longer in its current scope",
            );
        }
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
        usage.purpose = roleScope(registration).purpose;
        usage.role = roleScope(registration).role;
        usage.view = roleScope(registration).view;
        usage.contactNature = roleScope(registration).contactNature;
        // Worker results enter this scope only through an explicit bounded
        // release contact. Terminal completion never imports child transcript.
        const scopedUsage = usage;

        const at = options.now();
        const users = input.historyUsers ?? [];
        const history = users.length
          ? await sql<{ run_id: string; prompt_digest: string }>(
              tx,
              `SELECT r.run_id,r.prompt_digest FROM heptalogos.life_native_run r WHERE r.subject_id=$1 AND r.activity_id=$2 AND r.session_key=$3 AND r.document#>>'{native,sessionId}'=$4 AND r.run_id=ANY($5::text[]) AND EXISTS(SELECT 1 FROM heptalogos.life_native_contact c WHERE c.run_id=r.run_id AND c.document ? 'admitted')`,
              [
                input.subjectId,
                activity.activityId,
                input.native.sessionKey,
                input.native.sessionId,
                users.map((user) => user.nativeRunId),
              ],
            )
          : [];
        const allowedHistoryUserKeys = users
          .filter(
            (user) =>
              user.key === `${user.nativeRunId}:user` &&
              (user.nativeRunId === input.native.runId
                ? user.promptDigest === registration.promptDigest
                : history.some(
                    (row) =>
                      row.run_id === user.nativeRunId &&
                      row.prompt_digest === user.promptDigest,
                  )),
          )
          .map((user) => user.key);
        const response = validated(() =>
          hostPrepareResponseSchema.parse({
            version: 1,
            contactRequestId: input.contactRequestId,
            ...(continuation
              ? { continuationSourceRef: continuation.continuationSourceRef }
              : { workContextId: activity.workContextId }),
            roleScope: roleScope(registration),
            tokenBudget: providerPolicy(registration).tokenBudget,
            ...(providerPolicy(registration).responseFormat
              ? { responseFormat: providerPolicy(registration).responseFormat }
              : {}),
            allowedToolNames: ["subject.render", "narrative.review"].includes(
              roleScope(registration).role,
            )
              ? []
              : activity.scope!.tools.filter(
                  (name) =>
                    providerPolicy(registration).allowedToolNames.includes(name) &&
                    !["message", "sessions_send", "cron"].includes(name),
                ),
            allowedHistoryUserKeys,
            currentSources,
            usage: encodeCognitionUsage(scopedUsage),
            scope: {
              activityRef: registration.activityId,
              actorEntityRef: registration.actorEntityRef,
              context: { native_role: registration.role },
            },
            contacts:
              roleScope(registration).contactNature === "execution_only"
                ? []
                : (registered[0]?.document.firstContact?.contacts ??
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
                    observation.observedAt =
                      observation.worldRealized || !observedStamp?.recordedAt
                        ? timestampFromDate(new Date(at))
                        : observedStamp.recordedAt;
                    if (!observation.worldRealized && observedStamp)
                      observation.observedStamp = observedStamp;
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
                  })),
          }),
        );
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
      return prepared;
    },
    async admitted(value) {
      const input = validated(() => hostAdmittedRequestSchema.parse(value));
      const selected = await mutate(async (tx) => {
        await sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          input.subjectId,
        ]);
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
        if (runs[0] && !contact.admitted)
          await sql(
            tx,
            "UPDATE heptalogos.life_native_run SET document=$2::jsonb WHERE run_id=$1",
            [
              input.native.runId,
              JSON.stringify({
                ...runs[0].document,
                consumerId: projection.consumerId,
                latestAppliedContactRequestId: input.contactRequestId,
                appliedUsage,
              }),
            ],
          );
        if (contact.admitted && digest(contact.admitted) !== digest(input))
          deny(
            "native_receipt_changed",
            "An acknowledged actual projection or occurrence result cannot be overwritten",
          );
        if (!contact.admitted) {
          const registered = runs[0]?.document.registration;
          if (!registered)
            deny(
              "native_run_unknown",
              "The exact admitted input registration is missing",
            );
          const activity = await lockedActivity(
            tx,
            input.subjectId,
            registered.activityId,
          );
          current(activity, registered);
          await options.assertForegroundIn?.(tx, registered);
          await options.authorizeInput(registered, activity, tx);
        }
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
      const actualRun = await readRun(input.native.runId);
      if (actualRun)
        await options.onWorldContactsAdmitted?.(input, actualRun.registration);
      return { version: 1, accepted: true };
    },
    async readResultRelease(subjectId, requestId) {
      const rows = await readRepositorySql<{ response: unknown }>(
        options.persistence,
        "SELECT document->'response' AS response FROM heptalogos.role_result_release WHERE subject_id=$1 AND request_id=$2",
        [subjectId, requestId],
      );
      return rows[0]
        ? validated(() => hostResultReleaseResponseSchema.parse(rows[0]!.response))
        : undefined;
    },
    async releaseResult(value) {
      const input = validated(() => hostResultReleaseRequestSchema.parse(value));
      if (new Set(input.resultIds).size !== input.resultIds.length) invalid();
      const parent = await readRun(input.parentRunId),
        child = await readRun(input.childRunId);
      if (
        !parent ||
        !child ||
        parent.registration.subjectId !== input.subjectId ||
        child.registration.subjectId !== input.subjectId ||
        child.registration.activityId !== parent.registration.activityId ||
        !["completed", "failed", "cancelled"].includes(child.state) ||
        !parent.consumerId ||
        !child.consumerId ||
        roleScope(child.registration).role !== "subject.execution" ||
        roleScope(child.registration).contactNature !== "execution_only"
      )
        deny(
          "native_result_release_denied",
          "Release requires an exact terminal execution-only child of this Subject",
        );
      await checkInput(parent.registration);
      return mutate(async (tx) => {
        await sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          input.subjectId,
        ]);
        await sessionLock(tx, parent.native.sessionKey);
        await sql(
          tx,
          "SELECT run_id FROM heptalogos.life_native_run WHERE run_id=ANY($1::text[]) ORDER BY run_id FOR SHARE",
          [[input.parentRunId, input.childRunId]],
        );
        const actualParent = await readRun(input.parentRunId, tx);
        const actualChild = await readRun(input.childRunId, tx);
        if (
          !actualParent ||
          !actualChild ||
          digest(actualParent.registration) !== digest(parent.registration) ||
          digest(actualChild.registration) !== digest(child.registration) ||
          digest(actualParent.native) !== digest(parent.native) ||
          digest(actualChild.native) !== digest(child.native) ||
          actualParent.nousSessionId !== parent.nousSessionId ||
          actualChild.nousSessionId !== child.nousSessionId ||
          actualChild.state !== child.state ||
          !actualParent.consumerId ||
          actualChild.consumerId !== child.consumerId
        )
          deny(
            "native_result_release_denied",
            "The admitted parent/terminal child binding changed during external checks",
          );
        const activity = await lockedActivity(
          tx,
          input.subjectId,
          parent.registration.activityId,
        );
        current(activity, parent.registration);
        await (options.authorizeRetainedResult ?? options.authorizeInput)(
          parent.registration,
          activity,
          tx,
        );
        if (
          (await readResultParent(input.subjectId, input.childRunId, tx)) !==
          input.parentRunId
        )
          deny(
            "native_result_release_denied",
            "The selected parent must be the exact retained execution parent",
          );
        const existing = await sql<{
          document: { input: typeof input; response: HostResultReleaseResponse };
        }>(
          tx,
          "SELECT document FROM heptalogos.role_result_release WHERE request_id=$1 FOR UPDATE",
          [input.requestId],
        );
        if (existing[0]) {
          if (digest(existing[0].document.input) !== digest(input))
            deny(
              "native_result_release_changed",
              "Release identity already selects different results",
            );
          return existing[0].document.response;
        }
        const results = await sql<{ result_id: string; document: Pending }>(
          tx,
          "SELECT result_id,document FROM heptalogos.role_run_result WHERE run_id=$1 AND subject_id=$2 AND result_id=ANY($3::uuid[]) ORDER BY recorded_at,result_id FOR SHARE",
          [input.childRunId, input.subjectId, input.resultIds],
        );
        if (
          results.length !== input.resultIds.length ||
          results.some((row) => row.document.origin === "life_retrieval") ||
          Buffer.byteLength(JSON.stringify(results)) > 1048576
        )
          deny(
            "native_result_release_denied",
            "Selected results are unavailable or exceed the bounded release budget",
          );
        const response: HostResultReleaseResponse = {
          version: 1,
          accepted: true,
          activityRef: activity.activityId,
          contactNature: "subject_experience",
          contacts: [
            {
              contactRef: `role-result-release:${input.requestId}`,
              observation: encodeObservationInput({
                subjectId: input.subjectId,
                requestId: input.requestId,
                sourceClass: "host_event",
                externalObjectRef: `object:heptalogos:role-result:${input.childRunId}:${digest([...input.resultIds].sort())}`,
                observedAt: timestampFromDate(new Date(options.now())),
                material: {
                  case: "inlineText",
                  value: {
                    mediaType: "application/json",
                    text: JSON.stringify({
                      outcome: child.state,
                      results: results.map((row) => ({
                        resultId: row.result_id,
                        observation: row.document.observation,
                      })),
                    }),
                  },
                },
                admit: true,
                actorEntityRef: parent.registration.actorEntityRef,
                context: {
                  contact_nature: "subject_experience",
                  source_nature: "execution_result_release",
                  parent_run_id: input.parentRunId,
                  child_run_id: input.childRunId,
                  release_ref: input.requestId,
                  result_ids: input.resultIds,
                },
              }),
            },
          ],
          opportunity: {
            kind: "activity_result",
            parentRunId: input.parentRunId,
            childRunId: input.childRunId,
            releaseRef: input.requestId,
          },
        };
        await sql(
          tx,
          "INSERT INTO heptalogos.role_result_release(request_id,subject_id,child_run_id,document,recorded_at) VALUES($1,$2,$3,$4::jsonb,$5)",
          [
            input.requestId,
            input.subjectId,
            input.childRunId,
            JSON.stringify({ input, response }),
            options.now(),
          ],
        );
        return response;
      });
    },
    async completion(value: HostCompletionRequest) {
      const input = validated(() => hostCompletionRequestSchema.parse(value));
      const handoffs = await readRepositorySql<{ document: Handoff }>(
        options.persistence,
        "SELECT document FROM heptalogos.life_handoff WHERE child_session_key=$1",
        [input.childSessionKey],
      );
      const prior = handoffs[0]?.document;
      if (
        !prior ||
        prior.request.subjectId !== input.subjectId ||
        prior.request.parentSessionKey !== input.parentSessionKey ||
        (input.parentSessionId &&
          prior.request.parentSessionId !== input.parentSessionId) ||
        (input.parentNousSessionId &&
          prior.request.parentNousSessionId !== input.parentNousSessionId) ||
        prior.request.childSessionId !== input.childSessionId ||
        prior.request.childNousSessionId !== input.childNousSessionId ||
        (input.parentRunId && prior.request.parentRunId !== input.parentRunId)
      )
        deny(
          "native_completion_changed",
          "The actual completion does not match its exact durable isolated handoff",
        );
      const parentRunId = prior.request.parentRunId;
      const parent = await readRun(parentRunId),
        child = await readRun(input.childRunId);
      if (
        !parent ||
        !child ||
        child.registration.role !== "worker" ||
        parent.registration.subjectId !== input.subjectId ||
        child.registration.subjectId !== input.subjectId ||
        child.registration.activityId !== parent.registration.activityId ||
        child.native.sessionKey !== input.childSessionKey ||
        child.native.sessionId !== input.childSessionId ||
        child.nousSessionId !== input.childNousSessionId ||
        parent.native.sessionKey !== input.parentSessionKey ||
        (input.parentSessionId && parent.native.sessionId !== input.parentSessionId) ||
        (input.parentNousSessionId &&
          parent.nousSessionId !== input.parentNousSessionId)
      )
        deny(
          "native_completion_changed",
          "The exact parent and actual worker invocation are unavailable",
        );
      return mutate(async (tx) => {
        await sessionLock(tx, input.parentSessionKey);
        const locked = await sql<{
          run_id: string;
          state: string;
          document: NativeRunSnapshot;
        }>(
          tx,
          "SELECT run_id,state,document FROM heptalogos.life_native_run WHERE run_id=ANY($1::text[]) ORDER BY run_id FOR UPDATE",
          [[parentRunId, input.childRunId]],
        );
        const p = locked.find((row) => row.run_id === parentRunId),
          c = locked.find((row) => row.run_id === input.childRunId);
        if (
          !p ||
          !c ||
          digest(p.document.registration) !== digest(parent.registration) ||
          digest(p.document.native) !== digest(parent.native) ||
          p.document.nousSessionId !== parent.nousSessionId ||
          digest(c.document.registration) !== digest(child.registration) ||
          c.document.nousSessionId !== child.nousSessionId ||
          digest(c.document.native) !== digest(child.native) ||
          (c.state !== "running" &&
            c.state !== input.outcome &&
            !(input.recover === true && c.state === "uncertain"))
        )
          deny(
            "native_completion_changed",
            "The actual completion changed during external checks",
          );
        const links = await sql<{ document: Handoff }>(
          tx,
          "SELECT document FROM heptalogos.life_handoff WHERE child_session_key=$1 FOR SHARE",
          [input.childSessionKey],
        );
        if (!links[0] || digest(links[0].document) !== digest(prior))
          deny("native_completion_changed", "The isolated handoff changed");
        const terminal = {
          ...input,
          recover: undefined,
          parentRunId,
        };
        const priorTerminal = (
          c.document as NativeRunSnapshot & { terminalCompletion?: unknown }
        ).terminalCompletion;
        if (priorTerminal && digest(priorTerminal) !== digest(terminal))
          deny(
            "native_completion_changed",
            "The original terminal outcome and endedAt cannot be overwritten",
          );
        await sql(
          tx,
          "UPDATE heptalogos.life_native_run SET state=$2,updated_at=$3,document=document||jsonb_build_object('terminalCompletion',$4::jsonb) WHERE run_id=$1",
          [input.childRunId, input.outcome, options.now(), JSON.stringify(terminal)],
        );
        const retained = await sql<{ result_id: string }>(
          tx,
          "SELECT result_id FROM heptalogos.role_run_result WHERE run_id=$1 ORDER BY recorded_at DESC,result_id LIMIT 65",
          [input.childRunId],
        );
        return {
          version: 1 as const,
          accepted: true as const,
          activityRef: parent.registration.activityId,
          parentRunId,
          resultIds: retained.slice(0, 64).map((row) => row.result_id),
          resultsOmitted: retained.length > 64,
          resultRetained: true as const,
        };
      });
    },
    async life(value: NativeLifeRequest) {
      const parsed = compileSchema<NativeLifeRequest>(nativeLifeRequestSchema).validate(
        value,
      );
      if (!parsed.ok) invalid();
      const input = parsed.value;
      const preflight = await readRun(input.nativeRunId);
      if (
        !preflight ||
        preflight.state !== "running" ||
        preflight.registration.activityId !== input.activityRef ||
        preflight.native.agentId !== input.nativeAgentId ||
        preflight.native.sessionKey !== input.sessionKey ||
        preflight.native.sessionId !== input.sessionId
      )
        deny(
          "native_life_unavailable",
          "The actual running invocation and Activity binding must match",
        );
      await checkInput(preflight.registration);
      const world = await options.life.worldNow(preflight.registration.subjectId);
      const readAction = isNativeLifeReadAction(input.request)
        ? input.request
        : undefined;
      const readActivity = readAction
        ? await options.life.get(preflight.registration.subjectId, input.activityRef)
        : undefined;
      const readContacts = readAction
        ? await readRepositorySql<{ document: Contact }>(
            options.persistence,
            "SELECT document FROM heptalogos.life_native_contact WHERE run_id=$1 AND contact_request_id=$2",
            [input.nativeRunId, preflight.latestAppliedContactRequestId ?? null],
          )
        : [];
      const readContact = readContacts[0]?.document;
      let readResult: NativeLifeReadResponse | undefined;
      if (readAction) {
        if (
          !options.readLife ||
          !readActivity?.scope ||
          !readContact?.admitted ||
          !readContact.appliedUsage ||
          !readContact.response.allowedToolNames.some(
            (name) => name === "heptalogos_life",
          ) ||
          !readActivity.scope.tools.includes("heptalogos_life")
        )
          deny(
            "native_life_unavailable",
            "Life reads require an actual admitted invocation and configured owner reader",
          );
        await options.authorizeInput(preflight.registration, readActivity);
        // Save the actual owner action before querying, so even a failed read is
        // derived retrieval rather than fresh external testimony. No result body
        // is published until the current authority is checked again below.
        await mutate(async (tx) => {
          await sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            preflight.registration.subjectId,
          ]);
          await options.assertForegroundIn?.(tx, preflight.registration);
          const contact = await contactIn(tx, readContact.request);
          const trace = {
            requestDigest: digest(readAction),
            action: readAction.action,
            sourceRefs: [],
          };
          const previous = lifeReadTrace(contact, input.toolCallId);
          if (previous && previous.requestDigest !== trace.requestDigest)
            deny(
              "native_life_changed",
              "The actual Life tool call changed its owner read action",
            );
          const lifeReads = {
            ...contact.lifeReads,
            [input.toolCallId]: previous ?? trace,
          };
          if (Object.keys(lifeReads).length > 256)
            deny(
              "native_life_limit",
              "This admitted invocation exhausted its bounded Life reads",
            );
          await sql(
            tx,
            "UPDATE heptalogos.life_native_contact SET document=jsonb_set(document,'{lifeReads}',$2::jsonb) WHERE contact_request_id=$1",
            [contact.request.contactRequestId, JSON.stringify(lifeReads)],
          );
        });
        const usage = decodeCognitionUsage(readContact.appliedUsage);
        readResult = await options.readLife(
          {
            subjectId: preflight.registration.subjectId,
            activityId: input.activityRef,
            nativeRunId: input.nativeRunId,
            role: roleScope(preflight.registration).role,
            ...(usage.audience?.conversationRef
              ? { audienceConversationRef: usage.audience.conversationRef }
              : {}),
            sourceRefs: preflight.registration.sourceRefs.filter(
              (ref) =>
                !ref.startsWith("world:") ||
                readActivity.scope!.sourceRefs.includes(ref),
            ),
            world,
            admittedProjection: readContact.admitted.projection,
          },
          readAction,
        );
      }
      return mutate(async (tx) => {
        await sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          preflight.registration.subjectId,
        ]);
        await options.assertForegroundIn?.(tx, preflight.registration);
        await sessionLock(tx, input.sessionKey);
        const rows = await sql<{ state: string; document: NativeRunSnapshot }>(
          tx,
          "SELECT state,document FROM heptalogos.life_native_run WHERE run_id=$1 FOR UPDATE",
          [input.nativeRunId],
        );
        const run = rows[0];
        if (
          !run ||
          run.state !== "running" ||
          digest(run.document.registration) !== digest(preflight.registration) ||
          digest(run.document.native) !== digest(preflight.native)
        )
          deny(
            "native_life_unavailable",
            "The current native invocation changed during external checks",
          );
        const activity = await lockedActivity(
          tx,
          preflight.registration.subjectId,
          input.activityRef,
        );
        current(activity, run.document.registration);
        await options.authorizeInput(run.document.registration, activity, tx);
        if (!activity.scope!.tools.includes("heptalogos_life"))
          deny("native_tool_denied", "Life is outside this Activity's adopted tools");
        const contacts = await sql<{ document: Contact }>(
          tx,
          "SELECT document FROM heptalogos.life_native_contact WHERE run_id=$1 AND contact_request_id=$2 FOR UPDATE",
          [input.nativeRunId, run.document.latestAppliedContactRequestId ?? null],
        );
        const contact = contacts[0]?.document;
        if (
          !contact?.admitted ||
          !contact.appliedUsage ||
          !contact.response.allowedToolNames.some((name) => name === "heptalogos_life")
        )
          deny(
            "native_life_unavailable",
            "Life requires the actual admitted controlled invocation",
          );
        if (readAction && readResult) {
          if (
            digest(activity.scope) !== digest(readActivity?.scope) ||
            contact.request.contactRequestId !==
              readContact?.request.contactRequestId ||
            digest(contact.appliedUsage) !== digest(readContact?.appliedUsage)
          )
            deny(
              "native_life_scope_changed",
              "The actual admitted contact or Activity scope changed while reading",
            );
          const trace = {
            requestDigest: digest(readAction),
            action: readAction.action,
            sourceRefs: readResult.sourceRefs,
            completed: true as const,
          };
          const previous = lifeReadTrace(contact, input.toolCallId);
          if (previous?.completed && digest(previous) !== digest(trace))
            deny(
              "native_life_changed",
              "An actual Life tool call cannot change its read request or canonical sources",
            );
          const lifeReads = { ...contact.lifeReads, [input.toolCallId]: trace };
          if (Object.keys(lifeReads).length > 256)
            deny(
              "native_life_limit",
              "This admitted provider invocation has exhausted its bounded Life reads",
            );
          await sql(
            tx,
            "UPDATE heptalogos.life_native_contact SET document=jsonb_set(document,'{lifeReads}',$2::jsonb) WHERE contact_request_id=$1",
            [contact.request.contactRequestId, JSON.stringify(lifeReads)],
          );
          return readResult;
        }
        if (
          input.request.action === "progress" &&
          roleScope(run.document.registration).role !== "subject.deliberation"
        )
          deny(
            "native_life_role_denied",
            "Only the Subject deliberation role may change its Activity",
          );
        if (isNativeLifeReadAction(input.request))
          deny(
            "native_life_unavailable",
            "The owner read did not produce a guarded result",
          );
        // Only real committed feedback can support progress; the note remains a Subject statement.
        const feedback = await sql<{
          receipt: ReturnType<typeof encodeAcceptedObservation>;
        }>(
          tx,
          "SELECT receipt FROM heptalogos.cognition_pending_feedback WHERE run_id=$1 AND receipt IS NOT NULL AND delivered_at IS NOT NULL ORDER BY recorded_at DESC,request_id DESC LIMIT 65",
          [input.nativeRunId],
        );
        const receipts = feedback
          .slice(0, 64)
          .map((r) => decodeAcceptedObservation(r.receipt));
        const next =
          input.request.action === "inspect"
            ? activity
            : await options.life.progressIn(
                tx,
                {
                  subjectId: activity.subjectId,
                  activityId: activity.activityId,
                  expectedRevision: input.request.expectedRevision,
                  mode: input.request.mode,
                  nextOpportunity: input.request.nextOpportunity,
                  progress: {
                    note: "Subject progress statement: " + input.request.note,
                    sourceRefs: [...new Set(run.document.registration.sourceRefs)],
                    artifactRefs: [
                      ...new Set(
                        receipts
                          .map((r) => (r.artifactId ? "artifact:" + r.artifactId : ""))
                          .filter(Boolean),
                      ),
                    ],
                    resultRefs: [
                      ...new Set(
                        receipts
                          .map((r) =>
                            r.occurrenceId ? "occurrence:" + r.occurrenceId : "",
                          )
                          .filter(Boolean),
                      ),
                    ],
                  },
                },
                world,
              );
        return {
          revision: next.revision,
          purpose: next.purpose,
          state: next.state,
          mode: next.mode,
          world,
          nextOpportunity: next.nextOpportunity,
          progress: next.progress,
          feedbackOmitted: feedback.length > 64,
        };
      });
    },
    async toolExecution(value) {
      const input = validated(() => hostToolExecutionRequestSchema.parse(value));
      const preflight = await readRun(input.native.runId);
      if (
        !preflight ||
        preflight.registration.subjectId !== input.subjectId ||
        preflight.state !== "running"
      )
        deny(
          "native_tool_unavailable",
          "The actual admitted running invocation is unavailable",
        );
      providerPolicy(preflight.registration);
      await checkInput(preflight.registration);
      return mutate(async (tx) => {
        await sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          input.subjectId,
        ]);
        await options.assertForegroundIn?.(tx, preflight.registration);
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
        if (digest(preflight.registration) !== digest(run.document.registration))
          deny("native_input_changed", "The actual run changed during external checks");
        current(activity, run.document.registration);
        await options.authorizeInput(run.document.registration, activity, tx);
        if (
          !contact.response.allowedToolNames.some((name) => name === input.toolName) ||
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
      const taskLimit = await options.workerConcurrency?.();
      const input = validated(() => hostHandoffRequestSchema.parse(value));
      const preflight = await readRun(input.parentRunId);
      if (
        !preflight ||
        preflight.state !== "running" ||
        preflight.registration.subjectId !== input.subjectId ||
        preflight.native.sessionKey !== input.parentSessionKey ||
        preflight.native.sessionId !== input.parentSessionId ||
        preflight.nousSessionId !== input.parentNousSessionId
      )
        deny("native_parent_changed", "The exact running parent is unavailable");
      if (!options.resolveChildProviderPolicy)
        deny(
          "native_provider_policy_unconfigured",
          "New delegated execution needs its explicitly configured child profile policy",
        );
      const childPolicy = await options.resolveChildProviderPolicy(
        preflight,
        input.childNativeAgentId,
      );
      validated(() => hostTokenBudgetSchema.parse(childPolicy.tokenBudget));
      validated(() =>
        hostPrepareResponseFields.allowedToolNames.parse(childPolicy.allowedToolNames),
      );
      await checkInput(preflight.registration);

      await mutate(async (tx) => {
        await sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          input.subjectId,
        ]);
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
        if (digest(parent.registration) !== digest(preflight.registration))
          deny("native_parent_changed", "The parent changed during external checks");
        current(activity, parent.registration);
        await options.authorizeInput(parent.registration, activity, tx);
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
            parentRunId: parent.runId,
            providerPolicyState: "configured",
            tokenBudget: childPolicy.tokenBudget,
            allowedToolNames: [...childPolicy.allowedToolNames],
            inheritedSourceRefs: [...parent.registration.sourceRefs],
            inheritedMessageSources: parent.registration.sourceRefs.filter((ref) =>
              ref.startsWith("message:"),
            ),
            role: "worker",
            currentContextDigest: input.childCurrentContextDigest,
            nativeAgentId: input.childNativeAgentId,
            roleScope: {
              role: "subject.execution",
              purpose: "professional_execution",
              view: "worker",
              contactNature: "execution_only",
            },
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
        await assertTaskCapacityIn(tx, input.subjectId, taskLimit);
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
    async runTerminal(value) {
      const input = validated(() => hostRunTerminalRequestSchema.parse(value));
      const response = await mutate(async (tx) => {
        await sql(tx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          input.subjectId,
        ]);
        const contact = await contactIn(tx, input);
        const rows = await sql<{
          state: string;
          document: NativeRunSnapshot & {
            terminal?: {
              request: HostRunTerminalRequest;
              response: HostRunTerminalResponse;
            };
          };
        }>(
          tx,
          "SELECT state,document FROM heptalogos.life_native_run WHERE run_id=$1 AND subject_id=$2 FOR UPDATE",
          [input.native.runId, input.subjectId],
        );
        const run = rows[0];
        if (
          !run ||
          !contact.admitted ||
          !run.document.consumerId ||
          contact.request.native.runId !== input.native.runId ||
          run.document.registration.roleScope.contactNature !== "execution_only"
        )
          deny(
            "native_terminal_denied",
            "A terminal marker needs its exact registered execution-only run and actual admitted contact",
          );
        if (run.document.terminal) {
          if (digest(run.document.terminal.request) !== digest(input))
            deny(
              "native_terminal_changed",
              "A terminal marker cannot change its original identity, outcome or time",
            );
          return run.document.terminal.response;
        }
        if (
          ["completed", "failed", "cancelled"].includes(run.state) &&
          run.state !== input.outcome
        )
          deny(
            "native_terminal_changed",
            "The retained actual run terminal outcome cannot be overwritten",
          );
        const receipt: HostRunTerminalResponse = {
          version: 1,
          accepted: true,
          runId: input.native.runId,
          activityRef: run.document.registration.activityId,
          resultRetained: true,
          ready: true,
        };
        await sql(
          tx,
          "UPDATE heptalogos.life_native_run SET state=$2,document=$3::jsonb,updated_at=$4 WHERE run_id=$1",
          [
            input.native.runId,
            input.outcome,
            JSON.stringify({
              ...run.document,
              terminal: { request: input, response: receipt },
            }),
            options.now(),
          ],
        );
        return receipt;
      });
      await options.onRunReady?.({
        subjectId: input.subjectId,
        activityId: response.activityRef,
        runId: response.runId,
      });
      return response;
    },
    async feedback(value) {
      const input = validated(() => hostFeedbackRequestSchema.parse(value));
      const incoming =
        input.stage === "pending"
          ? validated(() => decodeObservationInput(input.observation))
          : undefined;
      const savedFeedback = incoming
        ? await readRepositorySql<{ document: Pending }>(
            options.persistence,
            "SELECT document FROM heptalogos.cognition_pending_feedback WHERE request_id=$1 UNION ALL SELECT document FROM heptalogos.role_run_result WHERE result_id=$1",
            [incoming.requestId],
          )
        : [];
      const observedStamp =
        incoming && !savedFeedback.length && !incoming.worldRealized
          ? await captureObservedStamp(input.subjectId)
          : undefined;
      return mutate(async (tx) => {
        const contact = await contactIn(tx, input);
        if (input.stage === "pending") {
          const observation = validated(() =>
            decodeObservationInput(input.observation),
          );
          if (observedStamp?.recordedAt) {
            observation.observedAt = observedStamp.recordedAt;
            observation.observedStamp = observedStamp;
          }
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
          const retained = await sql<{ document: Pending }>(
            tx,
            "SELECT document FROM heptalogos.role_run_result WHERE result_id=$1 FOR UPDATE",
            [observation.requestId],
          );
          const pending = await sql<{
            document: Pending;
            receipt: Parameters<typeof decodeAcceptedObservation>[0] | null;
            delivered_at: unknown;
          }>(
            tx,
            "SELECT document,receipt,delivered_at FROM heptalogos.cognition_pending_feedback WHERE request_id=$1 FOR UPDATE",
            [observation.requestId],
          );
          const saved = retained[0] ?? pending[0];
          if (retained[0] && pending[0]) {
            // Custody promotion may retain the original committed receipt row.
            // It is one canonical event only when the complete snapshots agree.
            const receipt = pending[0].receipt
              ? validated(() => decodeAcceptedObservation(pending[0]!.receipt))
              : undefined;
            if (
              !receipt?.occurrenceId ||
              !pending[0].delivered_at ||
              digest(retained[0].document.identity) !==
                digest(pending[0].document.identity) ||
              digest(retained[0].document.observation) !==
                digest(pending[0].document.observation)
            )
              deny(
                "native_feedback_changed",
                "Two feedback records require one exact original envelope and committed receipt",
              );
          }
          if (saved) {
            assertFeedbackReplay(
              saved.document,
              encodeObservationInput(observation),
              identity(input),
            );
            return {
              version: 1,
              stage: "pending",
              accepted: true,
              retainedOnly: !!retained.length,
              observation: saved.document.observation,
            };
          }
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
          const retrieval =
            observation.sourceClass === "tool" &&
            observation.context?.tool_name === "heptalogos_life" &&
            typeof observation.context.tool_call_id === "string" &&
            !!lifeReadTrace(contact, observation.context.tool_call_id);
          if (
            contact.response.roleScope.contactNature === "execution_only" ||
            retrieval
          ) {
            const document: Pending = {
              ...(retrieval ? { origin: "life_retrieval" as const } : {}),
              identity: identity(input),
              observation: normalized,
              factsDigest: actualFeedback(normalized),
            };
            await sql(
              tx,
              "INSERT INTO heptalogos.role_run_result(result_id,subject_id,run_id,document,recorded_at) VALUES($1,$2,$3,$4::jsonb,$5)",
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
              retainedOnly: true,
              observation: normalized,
            };
          }
          const document: Pending = {
            identity: identity(input),
            observation: normalized,
            factsDigest: actualFeedback(normalized),
          };
          const retainedOnly = false;
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
            retainedOnly,
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
        if (
          contact.response.roleScope.contactNature === "execution_only" &&
          rows[0]?.document.origin !== "agency_delivery" &&
          !rows[0]?.receipt
        )
          deny(
            "native_execution_result_only",
            "An execution-only RoleRun result cannot become a Subject observation receipt",
          );
        if (!rows[0] || digest(rows[0].document.identity) !== digest(identity(input)))
          deny(
            "native_feedback_changed",
            "No exact pending fact belongs to this contact",
          );
        if (rows[0].receipt) {
          if (digest(rows[0].receipt) !== digest(receipt))
            deny(
              "native_receipt_changed",
              "An accepted feedback receipt cannot be overwritten",
            );
          return { version: 1, stage: "committed", accepted: true };
        }
        await sql(
          tx,
          "UPDATE heptalogos.cognition_pending_feedback SET receipt=$2::jsonb,delivered_at=COALESCE(delivered_at,$3) WHERE request_id=$1",
          [input.observationRequestId, JSON.stringify(receipt), options.now()],
        );
        return { version: 1, stage: "committed", accepted: true };
      });
    },
    async hasAcceptedSource(subjectId, sourceRef, transaction) {
      const query = `SELECT 1 AS accepted FROM heptalogos.life_native_contact c JOIN heptalogos.life_native_run r ON r.run_id=c.run_id CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.document#>'{admitted,occurrences}','[]'::jsonb)) occurrence WHERE c.subject_id=$1 AND occurrence->>'contactRef'=$2 AND r.document#>>'{registration,roleScope,contactNature}'='subject_experience' LIMIT 1`;
      const rows = transaction
        ? await sql(transaction, query, [subjectId, sourceRef])
        : await readRepositorySql(options.persistence, query, [subjectId, sourceRef]);
      return rows.length > 0;
    },
    async readInputState(subjectId, runId, transaction) {
      const query =
        "SELECT document FROM heptalogos.life_native_input WHERE subject_id=$1 AND native_run_id=$2";
      const rows = transaction
        ? await sql<{ document: StoredInput }>(transaction, query, [subjectId, runId])
        : await readRepositorySql<{ document: StoredInput }>(
            options.persistence,
            query,
            [subjectId, runId],
          );
      return rows[0]
        ? {
            registration: rows[0].document.registration,
            prepared: !!rows[0].document.firstContact,
            extraSystemPrompt: rows[0].document.dispatch?.params.extraSystemPrompt,
          }
        : undefined;
    },
    async readyResults(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 128)
        invalid();
      const rows = await readRepositorySql<{
        run_id: string;
        activity_id: string;
        role: string;
        terminal_at: string;
        result_count: string;
        decision_ref: string | null;
      }>(
        options.persistence,
        `
        SELECT r.run_id,r.activity_id,r.document#>>'{registration,roleScope,role}' AS role,
        r.updated_at::text AS terminal_at,
        (SELECT count(*) FROM heptalogos.role_run_result x WHERE x.run_id=r.run_id)::text AS result_count,
        r.document#>>'{registration,adoptedDecisionRef}' AS decision_ref
        FROM heptalogos.life_native_run r
        WHERE r.subject_id=$1 AND ($2::text IS NULL OR (r.updated_at,r.run_id)>(SELECT cursor.updated_at,cursor.run_id FROM heptalogos.life_native_run cursor WHERE cursor.subject_id=$1 AND cursor.run_id=$2))
        AND r.state IN ('completed','failed','cancelled')
        AND r.document#>>'{registration,roleScope,role}'='subject.execution'
        AND r.document->>'consumerId' IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM heptalogos.role_result_release rel
          JOIN heptalogos.life_native_contact c ON c.subject_id=rel.subject_id
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.document#>'{admitted,occurrences}','[]'::jsonb)) receipt
          WHERE rel.child_run_id=r.run_id AND receipt->>'contactRef'='role-result-release:'||rel.request_id::text
        )
        ORDER BY r.updated_at,r.run_id LIMIT $3`,
        [input.subjectId, input.afterRunId ?? null, input.limit + 1],
      );
      const selected = rows.slice(0, input.limit);
      return {
        runs: selected.map((row) => ({
          runId: row.run_id,
          role: row.role,
          activityId: row.activity_id,
          terminalAt: new Date(row.terminal_at).toISOString(),
          resultCount: Number(row.result_count),
          ...(row.decision_ref ? { adoptedDecisionRef: row.decision_ref } : {}),
        })),
        more: rows.length > input.limit,
        ...(rows.length > input.limit ? { nextRunId: selected.at(-1)!.run_id } : {}),
      };
    },
    readResultParent,
    async readRoleResults(subjectId, runId) {
      const run = await readRun(runId);
      if (
        !run ||
        run.registration.subjectId !== subjectId ||
        roleScope(run.registration).contactNature !== "execution_only"
      )
        deny(
          "native_role_result_denied",
          "Execution results require their exact Subject and RoleRun",
        );
      const rows = await readRepositorySql<{ result_id: string; document: Pending }>(
        options.persistence,
        "SELECT result_id,document FROM heptalogos.role_run_result WHERE subject_id=$1 AND run_id=$2 ORDER BY recorded_at DESC,result_id LIMIT 65",
        [subjectId, runId],
      );
      const selected = rows.slice(0, 64);
      if (Buffer.byteLength(JSON.stringify(selected)) > 1048576)
        deny(
          "native_role_result_budget",
          "Retained execution output exceeds the 1 MiB Host read budget",
        );
      return {
        run,
        results: selected.map((row) => ({
          resultId: row.result_id,
          observation: row.document.observation,
        })),
        omitted: rows.length > 64,
      };
    },
    async readAppliedContext(runId) {
      const rows = await readRepositorySql<{ document: Contact }>(
        options.persistence,
        "SELECT c.document FROM heptalogos.life_native_run r JOIN heptalogos.life_native_contact c ON c.contact_request_id=(r.document->>'latestAppliedContactRequestId')::uuid AND c.run_id=r.run_id WHERE r.run_id=$1",
        [runId],
      );
      const contact = rows[0]?.document;
      if (
        !contact?.admitted ||
        !contact.appliedUsage ||
        contact.request.native.runId !== runId
      )
        deny(
          "native_applied_context_unavailable",
          "This exact RoleRun has no actual admitted Nous Projection",
        );
      return {
        runId,
        contactRequestId: contact.request.contactRequestId,
        invocationId: contact.request.invocationId,
        roleScope: contact.response.roleScope,
        projection: contact.admitted.projection,
        occurrences: contact.admitted.occurrences,
        usage: contact.appliedUsage,
      };
    },
    readRun,
    readTaskPerceptions,
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
      const priorFeedback = await readRepositorySql<{ document: Pending }>(
        options.persistence,
        "SELECT document FROM heptalogos.cognition_pending_feedback WHERE request_id=$1",
        [requestId],
      );
      const observedStamp = !priorFeedback.length
        ? await captureObservedStamp(fact.subjectId)
        : undefined;
      const usage = decodeCognitionUsage(
        contact.appliedUsage ?? contact.response.usage,
      );
      usage.contactNature = "subject_experience";
      const observation = encodeObservationInput(
        withHostObservationScope(
          {
            subjectId: fact.subjectId,
            sessionId: contact.request.nousSessionId,
            requestId,
            sourceClass: "host_event",
            externalObjectRef: "object:heptalogos:delivery:" + fact.attemptId,
            conversationRef: usage.audience!.conversationRef,
            actorEntityRef: run.registration.actorEntityRef,
            observedAt:
              observedStamp?.recordedAt ?? timestampFromDate(new Date(fact.recordedAt)),
            ...(observedStamp ? { observedStamp } : {}),
            ...(fact.outcome.state === "accepted"
              ? {
                  occurredTime: {
                    timeDomainRef: "time:real",
                    extent: {
                      value: {
                        case: "instant" as const,
                        value: timestampFromDate(new Date(fact.outcome.acceptedAt)),
                      },
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
              contact_nature: "subject_experience",
              native_run_ref: fact.runId,
              native_intent_ref: fact.nativeIntentId,
              delivery_reference: fact.reference,
              source_index: fact.sourceIndex,
              part_index: fact.partIndex,
              outcome_state: fact.outcome.state,
            },
          },
          {
            usage,
            activityRef: fact.activityId,
            contactRequestId: contact.request.contactRequestId,
          },
        ),
      );
      const document: Pending = {
        origin: "agency_delivery",
        identity: identity(contact.request),
        observation,
        factsDigest: actualFeedback(observation),
      };
      await mutate(async (tx) => {
        const saved = await sql<{ document: Pending }>(
          tx,
          "SELECT document FROM heptalogos.cognition_pending_feedback WHERE request_id=$1 FOR UPDATE",
          [requestId],
        );
        if (saved[0]) {
          if (
            saved[0].document.origin !== "agency_delivery" ||
            saved[0].document.factsDigest !== document.factsDigest ||
            digest(saved[0].document.identity) !== digest(document.identity)
          )
            deny(
              "native_delivery_changed",
              "The actual Agency delivery identity or outcome cannot change",
            );
          return;
        }
        await sql(
          tx,
          "INSERT INTO heptalogos.cognition_pending_feedback(request_id,subject_id,run_id,document,recorded_at) VALUES($1,$2,$3,$4::jsonb,$5)",
          [
            requestId,
            fact.subjectId,
            fact.runId,
            JSON.stringify(document),
            options.now(),
          ],
        );
      });
      // A platform acknowledgement waits for local durability, not cognition
      // networking. An existing background opportunity drains this outbox.
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
