// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Typed service-only client over schema-generated Host operations.
 * @module gateway-client
 */
export { nativeLifeActionSchema } from "./generated/native-life-schema.gen.js";
import { createPursuitOperations } from "./pursuit-operations.js";
import * as api from "./generated/index.js";
import type * as wire from "./generated/types.gen.js";
import { createClient } from "./generated/client/index.js";
import { requestHostData } from "./client.js";
import { createLocalManagementEndpointReader } from "./discovery.js";
/** A gateway service credential is distinct from an administrator session. */
export interface GatewayHostClientOptions {
  readonly hostAnchorRoot: string;
  readonly serviceToken: string;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}
/** Creates the first-party Channel client; every payload type comes from the Host OpenAPI owner. */
export function createGatewayHostClient(options: GatewayHostClientOptions) {
  if (!options.serviceToken) throw Error("A Gateway service credential is required");
  const reader = createLocalManagementEndpointReader({
    anchorRoot: options.hostAnchorRoot,
    fetch: options.fetch,
    signal: options.signal,
  });
  const baseFor = (origin: string) => ({
    client: createClient({
      baseUrl: origin,
      auth: options.serviceToken,
      fetch: (input, init) =>
        (options.fetch ?? fetch)(input, { ...init, redirect: "error" }),
    }),
    throwOnError: true as const,
    responseStyle: "fields" as const,
    signal: options.signal,
  });
  const requestGateway = async <T>(
    operation: (base: ReturnType<typeof baseFor>) => Promise<{ readonly data: T }>,
  ): Promise<T> => {
    const current = await reader.read();
    return requestHostData(() => operation(baseFor(current.endpoint.origin)));
  };
  return Object.freeze({
    ...createPursuitOperations(requestGateway),
    nativeLife: (body: wire.NativeLifeData["body"]) =>
      requestGateway((base) => api.nativeLife({ ...base, body })),
    registerChannelRoute: (body: wire.RegisterChannelRouteData["body"]) =>
      requestGateway((base) => api.registerChannelRoute({ ...base, body })),

    uploadAttachment: (
      body: wire.UploadAttachmentData["body"],
      mediaType: wire.UploadAttachmentData["headers"]["x-media-type"],
    ) =>
      requestGateway((base) =>
        api.uploadAttachment({ ...base, body, headers: { "x-media-type": mediaType } }),
      ),
    gatewayScope: () =>
      requestGateway((base) => api.gatewayScope({ ...base, body: {} })),
    archiveEnvelope: (body: wire.ArchiveEnvelopeData["body"]) =>
      requestGateway((base) => api.archiveEnvelope({ ...base, body })),
    readArchive: (body: wire.ReadArchiveData["body"]) =>
      requestGateway((base) => api.readArchive({ ...base, body })),
    acceptFacts: (body: wire.AcceptFactsData["body"]) =>
      requestGateway((base) => api.acceptFacts({ ...base, body })),
    prepareRead: (body: wire.PrepareReadData["body"]) =>
      requestGateway((base) => api.prepareRead({ ...base, body })),
    pendingFacts: (body: wire.PendingFactsData["body"]) =>
      requestGateway((base) => api.pendingFacts({ ...base, body })),
    completePending: (body: wire.CompletePendingData["body"]) =>
      requestGateway((base) => api.completePending({ ...base, body })),
    pendingAttachments: (body: wire.PendingAttachmentsData["body"]) =>
      requestGateway((base) => api.pendingAttachments({ ...base, body })),
    updateAttachment: (body: wire.UpdateAttachmentData["body"]) =>
      requestGateway((base) => api.updateAttachment({ ...base, body })),
    pendingReferences: (body: wire.PendingReferencesData["body"]) =>
      requestGateway((base) => api.pendingReferences({ ...base, body })),
    updateReference: (body: wire.UpdateReferenceData["body"]) =>
      requestGateway((base) => api.updateReference({ ...base, body })),
    readEvents: (body: wire.ReadEventsData["body"]) =>
      requestGateway((base) => api.readEvents({ ...base, body })),
    readHistoryCoverage: (body: wire.ReadHistoryCoverageData["body"]) =>
      requestGateway((base) => api.readHistoryCoverage({ ...base, body })),
    updateHistoryCoverage: (body: wire.UpdateHistoryCoverageData["body"]) =>
      requestGateway((base) => api.updateHistoryCoverage({ ...base, body })),
    resolveAccount: (body: wire.ResolveAccountData["body"]) =>
      requestGateway((base) => api.resolveAccount({ ...base, body })),
    resolveGroup: (body: wire.ResolveGroupData["body"]) =>
      requestGateway((base) => api.resolveGroup({ ...base, body })),
    bindSubjectAccount: (body: wire.BindSubjectAccountData["body"]) =>
      requestGateway((base) => api.bindSubjectAccount({ ...base, body })),
    adoptDelivery: (body: wire.AdoptDeliveryData["body"]) =>
      requestGateway((base) => api.adoptDelivery({ ...base, body })),
    authorizeDelivery: (body: wire.AuthorizeDeliveryData["body"]) =>
      requestGateway((base) => api.authorizeDelivery({ ...base, body })),
    beginDelivery: (body: wire.BeginDeliveryData["body"]) =>
      requestGateway((base) => api.beginDelivery({ ...base, body })),
    recordDelivery: (body: wire.RecordDeliveryData["body"]) =>
      requestGateway((base) => api.recordDelivery({ ...base, body })),
    readActivity: (body: wire.ReadActivityData["body"]) =>
      requestGateway((base) => api.readActivity({ ...base, body })),
    proposeActivity: (body: wire.ProposeActivityData["body"]) =>
      requestGateway((base) => api.proposeActivity({ ...base, body })),
    adoptActivity: (body: wire.AdoptActivityData["body"]) =>
      requestGateway((base) => api.adoptActivity({ ...base, body })),
    transitionActivity: (body: wire.TransitionActivityData["body"]) =>
      requestGateway((base) => api.transitionActivity({ ...base, body })),
    progressActivity: (body: wire.ProgressActivityData["body"]) =>
      requestGateway((base) => api.progressActivity({ ...base, body })),
    scheduleActivities: (body: wire.ScheduleActivitiesData["body"]) =>
      requestGateway((base) => api.scheduleActivities({ ...base, body })),
    dispatchActivity: (body: wire.DispatchActivityData["body"]) =>
      requestGateway((base) => api.dispatchActivity({ ...base, body })),
    takeActivityOpportunity: (body: wire.TakeActivityOpportunityData["body"]) =>
      requestGateway((base) => api.takeActivityOpportunity({ ...base, body })),
    authorizeToolExecution: (body: wire.AuthorizeToolExecutionData["body"]) =>
      requestGateway((base) => api.authorizeToolExecution({ ...base, body })),
    takeAttention: (body: wire.TakeAttentionData["body"]) =>
      requestGateway((base) => api.takeAttention({ ...base, body })),
    prepareCognition: (body: wire.PrepareCognitionData["body"]) =>
      requestGateway((base) => api.prepareCognition({ ...base, body })),
    admitCognition: (body: wire.AdmitCognitionData["body"]) =>
      requestGateway((base) => api.admitCognition({ ...base, body })),
    handoffCognition: (body: wire.HandoffCognitionData["body"]) =>
      requestGateway((base) => api.handoffCognition({ ...base, body })),
    feedbackCognition: (body: wire.FeedbackCognitionData["body"]) =>
      requestGateway((base) => api.feedbackCognition({ ...base, body })),
  });
}
/** The complete generated service facade used by the independently installed Channel plugin. */
export type GatewayHostClient = ReturnType<typeof createGatewayHostClient>;
