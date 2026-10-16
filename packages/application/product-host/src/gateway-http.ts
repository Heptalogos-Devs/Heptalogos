// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Trusted channel transport generated from current semantic-owner contracts.
 * @module gateway-http
 */
import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { compileSchema } from "@heptalogos/schema-runtime";
import { Type, type TSchema, type Static } from "@heptalogos/schema-runtime/typebox";
import * as messaging from "@heptalogos/messaging";
import * as identity from "@heptalogos/identity";
import * as subject from "@heptalogos/subject";
import {
  HOST_BRIDGE_PATHS,
  HOST_BRIDGE_JSON_SCHEMAS,
  type HostPrepareRequest,
  type HostPrepareResponse,
  type HostAdmittedRequest,
  type HostHandoffRequest,
  type HostFeedbackRequest,
  type HostFeedbackResponse,
  type HostToolExecutionRequest,
  type HostToolExecutionResponse,
} from "@nous-wave/client/host-bridge";
import { managementProblem, managementProblemSchema } from "@heptalogos/management";
import { tokenFromRequest } from "./http-auth.js";
import {
  activityDispatchInputSchema,
  activityDispatchResultSchema,
} from "./activity-dispatch-contracts.js";
import {
  activityOpportunityInputSchema,
  activityOpportunityResultSchema,
  type createActivityOpportunity,
} from "./activity-opportunity.js";
import type { createActivityDispatcher } from "./activity-dispatch.js";
import * as contracts from "./gateway-contracts.js";
import type { createArchiveStore } from "./archive-store.js";
import { channelRouteSchema, type createChannelRouteStore } from "./channel-routes.js";
const ack = Type.Object(
  { accepted: Type.Literal(true) },
  { additionalProperties: false },
);
const empty = Type.Object({}, { additionalProperties: false });
/** Managed cognition uses the official Client's public wire, with no parallel observation DTO. */
export interface GatewayCognitionBridge {
  /** Admits actual Host-selected material to one native invocation. */
  prepare(input: HostPrepareRequest): Promise<HostPrepareResponse>;
  /** Records the actual projection and accepted material receipts. */
  admitted(input: HostAdmittedRequest): Promise<{ version: 1; accepted: true }>;
  /** Rechecks the actual invocation and current adopted tools immediately before execution. */
  toolExecution(input: HostToolExecutionRequest): Promise<HostToolExecutionResponse>;
  /** Authorizes a restricted child before its first model input. */
  handoff(input: HostHandoffRequest): Promise<{ version: 1; accepted: true }>;
  /** Preserves original actual outcomes before submitting them to cognition. */
  feedback(input: HostFeedbackRequest): Promise<HostFeedbackResponse>;
}
/** Service credential and semantic owners are resolved in the Host composition. */
export interface GatewayHttpOptions {
  readonly authenticate: (token: string | undefined) => Promise<void>;
  readonly runMutation: <T>(kind: string, operation: () => Promise<T>) => Promise<T>;
  readonly scope: () => Promise<contracts.GatewayScope>;
  readonly messaging: messaging.MessagingService;
  readonly identity: identity.IdentityService;
  readonly life: ReturnType<typeof subject.createLifeService>;
  readonly agency: ReturnType<typeof subject.createAgencyService>;
  readonly archive: ReturnType<typeof createArchiveStore>;
  readonly routes: ReturnType<typeof createChannelRouteStore>;
  readonly cognition: GatewayCognitionBridge;
  readonly opportunity: ReturnType<typeof createActivityOpportunity>;
  readonly activities: ReturnType<typeof createActivityDispatcher>;
}
/** Registers schema-owned service endpoints on the existing local Host listener. */
export function registerGatewayHttp(
  app: FastifyInstance,
  options?: GatewayHttpOptions,
) {
  const unavailable = () => {
    throw managementProblem(
      "gateway.unconfigured",
      "Gateway is not configured",
      "Initialize the installed gateway service binding",
      "unavailable",
    );
  };
  const owners = () => options ?? unavailable();
  const endpoint = <T extends TSchema>(
    name: string,
    path: string,
    input: T,
    output: TSchema,
    operation: (value: Static<T>) => Promise<unknown>,
    mutation = false,
  ) => {
    app.post(
      path,
      {
        bodyLimit: 16 * 1024 * 1024,
        onRequest: async (request) => {
          await owners().authenticate(tokenFromRequest(request));
        },
        schema: {
          operationId: name,
          body: input,
          security: [{ gatewayService: [] }],
          response: {
            200: output,
            400: managementProblemSchema,
            401: managementProblemSchema,
            403: managementProblemSchema,
            409: managementProblemSchema,
            503: managementProblemSchema,
            500: managementProblemSchema,
          },
        },
      },
      async (request, reply) => {
        // The authenticated native call has its own Activity deadline. A quiet
        // model/tool turn must not inherit the short upload inactivity timer.
        if (name === "dispatchActivity" || name === "takeActivityOpportunity")
          reply.raw.setTimeout(0);
        return mutation
          ? owners().runMutation("gateway." + name, () =>
              operation(request.body as Static<T>),
            )
          : operation(request.body as Static<T>);
      },
    );
  };
  const receive = async (conversation: messaging.NativeConversation) => {
    const scope = await owners().scope();
    if (
      conversation.platform !== "qq" ||
      conversation.accountId !== scope.accountId ||
      !scope.conversations.some(
        (grant) =>
          grant.kind === conversation.kind &&
          grant.conversationId === conversation.conversationId &&
          grant.receive,
      )
    )
      throw managementProblem(
        "gateway.scope_denied",
        "Conversation reception is not authorized",
        "The current Host account and receive scope must permit this conversation",
        "authorization",
      );
    return scope;
  };
  const permitted = async (observe: boolean) => {
    const scope = await owners().scope();
    const { conversationIds } = await owners().messaging.resolveConversations({
      conversations: scope.conversations
        .filter((grant) => grant.receive && (!observe || grant.observe))
        .map((grant) => ({
          platform: "qq",
          accountId: scope.accountId,
          kind: grant.kind,
          conversationId: grant.conversationId,
        })),
    });
    return { scope, conversationIds };
  };
  const p = "/gateway/v1/";
  endpoint(
    "takeActivityOpportunity",
    p + "activity/opportunity",
    activityOpportunityInputSchema,
    activityOpportunityResultSchema,
    (v) => owners().opportunity(v),
    true,
  );
  endpoint(
    "dispatchActivity",
    p + "activity/dispatch",
    activityDispatchInputSchema,
    activityDispatchResultSchema,
    (v) => owners().activities.dispatch(v),
    true,
  );
  endpoint(
    "registerChannelRoute",
    p + "route",
    channelRouteSchema,
    Type.Object({ registered: Type.Literal(true) }, { additionalProperties: false }),
    (v) => owners().routes.register(v),
    true,
  );

  app.addContentTypeParser("application/octet-stream", (_request, payload, done) =>
    done(null, payload),
  );
  app.post(
    p + "media",
    {
      bodyLimit: 64 * 1024 * 1024,
      onRequest: async (request) => {
        await owners().authenticate(tokenFromRequest(request));
      },
      schema: {
        operationId: "uploadAttachment",
        consumes: ["application/octet-stream"],
        body: { type: "string", format: "binary" },
        headers: Type.Object(
          {
            "x-media-type": Type.String({
              pattern: "^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$",
            }),
          },
          { additionalProperties: true },
        ),
        security: [{ gatewayService: [] }],
        response: {
          200: contracts.uploadAttachmentResultSchema,
          401: managementProblemSchema,
          503: managementProblemSchema,
        },
      },
      // The raw parser supplies a bounded stream rather than a JSON string. The
      // archive owner enforces the streaming byte limit and content address.
      validatorCompiler: ({ httpPart, schema }) => {
        if (httpPart === "body")
          return (value: unknown) =>
            value instanceof Readable
              ? { value }
              : { error: new Error("Expected a raw media stream") };
        const validator = compileSchema(schema);
        return (value: unknown) =>
          validator.validate(value).ok
            ? { value }
            : { error: new Error("Invalid media request headers") };
      },
    },
    (request) => {
      const mediaType = request.headers["x-media-type"];
      if (typeof mediaType !== "string")
        throw managementProblem(
          "gateway.invalid_media_type",
          "Media type is required",
          "Provide the verified x-media-type header",
          "validation",
        );
      return owners().archive.uploadAttachmentStream(
        request.body as Readable,
        mediaType,
      );
    },
  );

  endpoint("gatewayScope", p + "scope", empty, contracts.gatewayScopeSchema, () =>
    owners().scope(),
  );
  endpoint(
    "archiveEnvelope",
    p + "archive",
    contracts.archiveEnvelopeInputSchema,
    contracts.archiveEnvelopeResultSchema,
    (v) => owners().archive.archiveEnvelope(v),
  );
  endpoint(
    "readArchive",
    p + "archive/read",
    contracts.readArchiveInputSchema,
    contracts.readArchiveResultSchema,
    (v) => owners().archive.readArchive(v),
  );
  endpoint(
    "acceptFacts",
    p + "messaging/accept",
    messaging.acceptFactsInputSchema,
    messaging.acceptFactsResultSchema,
    async (v) => {
      const scope = await owners().scope();
      for (const fact of v.facts) {
        const c = fact.conversation;
        if (
          c.platform !== "qq" ||
          c.accountId !== scope.accountId ||
          !scope.conversations.some(
            (grant) =>
              grant.kind === c.kind &&
              grant.conversationId === c.conversationId &&
              grant.receive,
          )
        )
          throw managementProblem(
            "gateway.scope_denied",
            "Conversation reception is not authorized",
            "The current Host account and receive scope must permit every accepted fact",
            "authorization",
          );
      }
      return owners().messaging.accept(v);
    },
    true,
  );
  endpoint(
    "prepareRead",
    p + "messaging/read",
    messaging.prepareReadInputSchema,
    messaging.prepareReadResultSchema,
    async (v) => {
      const allowed = await permitted(true);
      if (v.audience.subjectId !== allowed.scope.subjectId)
        throw managementProblem(
          "gateway.scope_denied",
          "Subject read is not authorized",
          "Use the current bound Subject",
          "authorization",
        );
      return owners().messaging.prepareRead({
        ...v,
        audience: {
          subjectId: allowed.scope.subjectId,
          conversationIds: v.audience.conversationIds.filter((id) =>
            allowed.conversationIds.includes(id),
          ),
        },
      });
    },
  );
  endpoint(
    "pendingFacts",
    p + "messaging/pending",
    messaging.listPendingInputSchema,
    messaging.listPendingResultSchema,
    async (v) =>
      owners().messaging.listPending({
        ...v,
        conversationIds: (await permitted(false)).conversationIds,
      }),
  );
  endpoint(
    "completePending",
    p + "messaging/complete",
    messaging.completePendingInputSchema,
    ack,
    async (v) => {
      await owners().messaging.completePending(v);
      return { accepted: true };
    },
    true,
  );
  endpoint(
    "pendingAttachments",
    p + "messaging/attachments",
    messaging.pendingAttachmentsInputSchema,
    messaging.pendingAttachmentsResultSchema,
    async (v) =>
      owners().messaging.listAttachments({
        ...v,
        conversationIds: (await permitted(false)).conversationIds,
      }),
  );
  endpoint(
    "updateAttachment",
    p + "messaging/attachment",
    messaging.updateAttachmentInputSchema,
    messaging.attachmentSchema,
    (v) => owners().messaging.updateAttachment(v),
    true,
  );
  endpoint(
    "pendingReferences",
    p + "messaging/references",
    messaging.listPendingInputSchema,
    messaging.pendingReferencesResultSchema,
    async (v) =>
      owners().messaging.listReferences({
        ...v,
        conversationIds: (await permitted(false)).conversationIds,
      }),
  );
  endpoint(
    "updateReference",
    p + "messaging/reference",
    messaging.updateReferenceInputSchema,
    messaging.messageReferenceSchema,
    (v) => owners().messaging.updateReference(v),
    true,
  );
  endpoint(
    "readEvents",
    p + "messaging/events",
    messaging.readEventsInputSchema,
    messaging.readEventsResultSchema,
    async (v) =>
      owners().messaging.readEvents({
        ...v,
        conversationIds: (await permitted(false)).conversationIds,
      }),
  );
  endpoint(
    "readHistoryCoverage",
    p + "messaging/history/read",
    messaging.readHistoryCoverageInputSchema,
    messaging.readHistoryCoverageResultSchema,
    async (v) => {
      await receive(v.conversation);
      return owners().messaging.readHistoryCoverage(v);
    },
  );
  endpoint(
    "updateHistoryCoverage",
    p + "messaging/history/update",
    messaging.updateHistoryCoverageInputSchema,
    messaging.historyCoverageSchema,
    async (v) => {
      await receive(v.conversation);
      return owners().messaging.updateHistoryCoverage(v);
    },
    true,
  );
  endpoint(
    "resolveAccount",
    p + "identity/account",
    identity.resolveAccountInputSchema,
    identity.entitySchema,
    (v) => owners().identity.resolveAccount(v),
    true,
  );
  endpoint(
    "resolveGroup",
    p + "identity/group",
    identity.resolveGroupInputSchema,
    identity.entitySchema,
    (v) => owners().identity.resolveGroup(v),
    true,
  );
  endpoint(
    "bindSubjectAccount",
    p + "identity/subject-account",
    identity.bindSubjectAccountInputSchema,
    identity.entitySchema,
    async (v) => {
      const scope = await owners().scope();
      if (
        v.platform !== "qq" ||
        v.accountId !== scope.accountId ||
        v.subjectId !== scope.subjectId
      )
        throw managementProblem(
          "gateway.scope_denied",
          "Subject account binding is not authorized",
          "Use the current Host Subject and protocol account",
          "authorization",
        );
      return owners().identity.bindSubjectAccount(v);
    },
    true,
  );
  endpoint(
    "adoptDelivery",
    p + "agency/adopt",
    subject.preparedDeliverySchema,
    subject.adoptedDeliverySchema,
    (v) => owners().agency.adoptDelivery(v),
    true,
  );
  endpoint(
    "authorizeDelivery",
    p + "agency/authorize",
    subject.authorizeDeliverySchema,
    Type.Object({ authorized: Type.Literal(true) }),
    (v) => owners().agency.authorizeDelivery(v),
  );
  endpoint(
    "beginDelivery",
    p + "agency/begin",
    subject.authorizeDeliverySchema,
    subject.beginDeliveryResultSchema,
    (v) => owners().agency.beginDelivery(v),
    true,
  );
  endpoint(
    "recordDelivery",
    p + "agency/record",
    subject.recordDeliverySchema,
    Type.Object({ recorded: Type.Literal(true) }),
    (v) => owners().agency.recordDelivery(v),
    true,
  );
  endpoint(
    "proposeActivity",
    p + "life/propose",
    subject.proposeActivitySchema,
    subject.activitySchema,
    (v) => owners().life.propose(v),
    true,
  );
  endpoint(
    "adoptActivity",
    p + "life/adopt",
    subject.adoptActivitySchema,
    subject.activitySchema,
    (v) => owners().life.adopt(v),
    true,
  );
  endpoint(
    "transitionActivity",
    p + "life/transition",
    subject.transitionActivitySchema,
    subject.activitySchema,
    (v) => owners().life.transition(v),
    true,
  );
  endpoint(
    "progressActivity",
    p + "life/progress",
    subject.progressActivitySchema,
    subject.activitySchema,
    (v) => owners().life.progress(v),
    true,
  );
  endpoint(
    "scheduleActivities",
    p + "life/schedule",
    subject.scheduleQuerySchema,
    Type.Object({
      activities: Type.Array(subject.activitySchema),
      nextId: Type.Union([Type.String(), Type.Null()]),
    }),
    (v) => owners().life.schedule(v),
  );
  endpoint(
    "takeAttention",
    p + "life/attention",
    subject.takeAttentionSchema,
    subject.attentionResultSchema,
    (v) => owners().life.takeAttention(v),
  );
  // The original Client schemas own these JSON boundaries; no field list is copied here.
  const wire = HOST_BRIDGE_JSON_SCHEMAS;
  endpoint(
    "prepareCognition",
    HOST_BRIDGE_PATHS.prepare,
    wire.prepareRequest as TSchema,
    wire.prepareResponse as TSchema,
    (v) => owners().cognition.prepare(v as HostPrepareRequest),
    true,
  );
  endpoint(
    "admitCognition",
    HOST_BRIDGE_PATHS.admitted,
    wire.admittedRequest as TSchema,
    wire.acknowledgement as TSchema,
    (v) => owners().cognition.admitted(v as HostAdmittedRequest),
    true,
  );
  endpoint(
    "authorizeToolExecution",
    HOST_BRIDGE_PATHS.toolExecution,
    wire.toolExecutionRequest as TSchema,
    wire.toolExecutionResponse as TSchema,
    (v) => owners().cognition.toolExecution(v as HostToolExecutionRequest),
    true,
  );
  endpoint(
    "handoffCognition",
    HOST_BRIDGE_PATHS.handoff,
    wire.handoffRequest as TSchema,
    wire.acknowledgement as TSchema,
    (v) => owners().cognition.handoff(v as HostHandoffRequest),
    true,
  );
  endpoint(
    "feedbackCognition",
    HOST_BRIDGE_PATHS.feedback,
    wire.feedbackRequest as TSchema,
    wire.feedbackResponse as TSchema,
    (v) => owners().cognition.feedback(v as HostFeedbackRequest),
    true,
  );
}
