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
  type ActivityOpportunity,
  consumeActivityOpportunity,
} from "@heptalogos/subject";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { MessagingService } from "@heptalogos/messaging";
import type { NousClient } from "@nous-wave/client";
import {
  hostPrepareRequestSchema,
  hostPrepareResponseSchema,
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
} from "./native-life-contracts.js";
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
  readonly roleScope: HostRoleScope;
  readonly tokenBudget: HostTokenBudget;
  readonly allowedToolNames: readonly string[];
  readonly providerPolicyState?: "configured" | "unconfigured";
  readonly actorEntityRef: string;
  readonly workContextId: string;
  readonly usage: HostPrepareResponse["usage"];
  readonly sourceRefs: readonly string[];
  readonly messageRefs: readonly string[];
  readonly parentRunId?: string;
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
    observation: Record<string, CanonicalJsonValue>;
  }[];
  readonly omitted: boolean;
}
/** Official admitted Projection wire and actual caller metadata; no second cognition DTO. */
export interface NativeAppliedContext {
  readonly runId: string;
  readonly contactRequestId: string;
  readonly invocationId: string;
  readonly roleScope: HostRoleScope;
  readonly projection: HostAdmittedRequest["projection"];
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
};
type Pending = {
  origin?: "agency_delivery";
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
  readonly now: () => string;
  /** Existing product role configuration supplies the actual execution profile policy. */
  readonly resolveChildProviderPolicy?: (
    parent: NativeRunSnapshot,
    childNativeAgentId: string,
  ) => Promise<{ tokenBudget: HostTokenBudget; allowedToolNames: readonly string[] }>;
  /** External cognition/Pursuit checks run before any fenced write transaction. */
  readonly checkInput?: (
    registration: Readonly<Registration>,
    activity: LifeActivity,
  ) => Promise<void>;
  /** Rechecks only current local authority while holding the actual Activity/send-point fence. */
  readonly authorizeInput: (
    registration: Readonly<Registration>,
    activity: LifeActivity,
    transaction?: PersistenceInternalTransaction,
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
    hostPrepareResponseSchema.shape.allowedToolNames.parse(
      registration.allowedToolNames,
    ),
  );
  return { tokenBudget, allowedToolNames };
}
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
  const service: GatewayCognitionBridge & {
    registerInput(
      input: Omit<
        Registration,
        | "promptDigest"
        | "usage"
        | "inheritedMessageSources"
        | "inheritedSourceRefs"
        | "providerPolicyState"
      > & {
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
    /** Trusted Host reads execution output; this operation creates no Subject contact. */
    readRoleResults(subjectId: string, runId: string): Promise<NativeRoleResults>;
    /** Trusted Host reads what Nous actually applied, including its official EpistemicView. */
    readAppliedContext(runId: string): Promise<NativeAppliedContext>;
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
        "inheritedMessageSources" in input ||
        "inheritedSourceRefs" in input ||
        "providerPolicyState" in input
      )
        invalid();
      const sourceParent = input.parentRunId
        ? await readRun(input.parentRunId)
        : undefined;
      if (
        input.parentRunId &&
        (!sourceParent ||
          sourceParent.registration.subjectId !== input.subjectId ||
          sourceParent.registration.activityId !== input.activityId ||
          !["running", "completed"].includes(sourceParent.state) ||
          input.sourceRefs.some(
            (ref) => !sourceParent.registration.sourceRefs.includes(ref),
          ))
      )
        deny(
          "native_parent_sources_denied",
          "Role inheritance requires the exact same-Subject/Activity parent and a subset of its authorized roots",
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
        hostPrepareResponseSchema.shape.allowedToolNames.parse(input.allowedToolNames),
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
        contacts,
        usage: canonicalUsage,
        promptDigest: createHash("sha256").update(prompt).digest("hex"),
      };
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
        await sessionLock(tx, input.sessionKey);
        const activity = await lockedActivity(tx, input.subjectId, input.activityId);
        current(activity, registration);
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
    async prepare(value) {
      const input = validated(() => hostPrepareRequestSchema.parse(value));
      const preflight = await prepareRegistration(input);
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
        await options.authorizeInput(registration, activity, tx);
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
        const response: HostPrepareResponse = {
          version: 1,
          contactRequestId: input.contactRequestId,
          workContextId: activity.workContextId,
          roleScope: roleScope(registration),
          tokenBudget: providerPolicy(registration).tokenBudget,
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
          currentSources: [],
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
                })),
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
        const activity = await lockedActivity(
          tx,
          input.subjectId,
          parent.registration.activityId,
        );
        current(activity, parent.registration);
        await options.authorizeInput(parent.registration, activity, tx);
        const links = await sql<{ parent_run_id: string }>(
          tx,
          "SELECT parent_run_id FROM heptalogos.life_handoff WHERE child_session_key=$1 FOR SHARE",
          [child.native.sessionKey],
        );
        if (links[0]?.parent_run_id !== input.parentRunId)
          deny(
            "native_result_release_denied",
            "The child belongs to another immutable parent binding",
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
          digest(c.document.native) !== digest(child.native) ||
          (c.state !== "running" && c.state !== input.outcome)
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
      return mutate(async (tx) => {
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
          "SELECT document FROM heptalogos.life_native_contact WHERE run_id=$1 AND document ? 'admitted' ORDER BY recorded_at DESC,contact_request_id DESC LIMIT 1",
          [input.nativeRunId],
        );
        const contact = contacts[0]?.document;
        if (
          !contact?.admitted ||
          !contact.appliedUsage ||
          !contact.response.allowedToolNames.includes("heptalogos_life")
        )
          deny(
            "native_life_unavailable",
            "Life requires the actual admitted controlled invocation",
          );
        if (
          input.request.action === "progress" &&
          run.document.registration.role !== "main"
        )
          deny(
            "native_life_role_denied",
            "A worker may inspect but cannot change the parent Activity",
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
        hostPrepareResponseSchema.shape.allowedToolNames.parse(
          childPolicy.allowedToolNames,
        ),
      );
      await checkInput(preflight.registration);

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
          if (contact.response.roleScope.contactNature === "execution_only") {
            const document: Pending = {
              identity: identity(input),
              observation: normalized,
              factsDigest: actualFeedback(normalized),
            };
            const saved = await sql<{ document: Pending }>(
              tx,
              "SELECT document FROM heptalogos.role_run_result WHERE result_id=$1 FOR UPDATE",
              [observation.requestId],
            );
            if (
              saved[0] &&
              (digest(saved[0].document.identity) !== digest(document.identity) ||
                saved[0].document.factsDigest !== document.factsDigest)
            )
              deny(
                "native_feedback_changed",
                "A retained RoleRun result cannot change identity or actual content",
              );
            if (!saved[0])
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
              observation: saved[0]?.document.observation ?? normalized,
            };
          }
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
              retainedOnly: false,
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
          rows[0]?.document.origin !== "agency_delivery"
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
        usage: contact.appliedUsage,
      };
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
