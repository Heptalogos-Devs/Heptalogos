// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Typed service-only client over schema-generated Host operations.
 * @module gateway-client
 */
import * as api from "./generated/index.js";
import type * as wire from "./generated/types.gen.js";
import { createClient } from "./generated/client/index.js";
import { requestHostData } from "./client.js";
/** A gateway service credential is distinct from an administrator session. */
export interface GatewayHostClientOptions {
  readonly origin: string;
  readonly serviceToken: string;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}
/** Creates the first-party Channel client; every payload type comes from the Host OpenAPI owner. */
export function createGatewayHostClient(options: GatewayHostClientOptions) {
  const url = new URL(options.origin);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error(
      "The Gateway Host must be an explicitly configured loopback HTTP origin",
    );
  if (!options.serviceToken)
    throw new Error("A Gateway service credential is required");
  const transport = createClient({
    baseUrl: url.origin,
    auth: options.serviceToken,
    fetch: (input, init) =>
      (options.fetch ?? fetch)(input, { ...init, redirect: "error" }),
  });
  const base = {
    client: transport,
    throwOnError: true as const,
    responseStyle: "fields" as const,
    signal: options.signal,
  };
  return Object.freeze({
    registerChannelRoute: (body: wire.RegisterChannelRouteData["body"]) =>
      requestHostData(() => api.registerChannelRoute({ ...base, body })),

    uploadAttachment: (
      body: wire.UploadAttachmentData["body"],
      mediaType: wire.UploadAttachmentData["headers"]["x-media-type"],
    ) =>
      requestHostData(() =>
        api.uploadAttachment({ ...base, body, headers: { "x-media-type": mediaType } }),
      ),
    gatewayScope: () => requestHostData(() => api.gatewayScope({ ...base, body: {} })),
    archiveEnvelope: (body: wire.ArchiveEnvelopeData["body"]) =>
      requestHostData(() => api.archiveEnvelope({ ...base, body })),
    readArchive: (body: wire.ReadArchiveData["body"]) =>
      requestHostData(() => api.readArchive({ ...base, body })),
    acceptFacts: (body: wire.AcceptFactsData["body"]) =>
      requestHostData(() => api.acceptFacts({ ...base, body })),
    prepareRead: (body: wire.PrepareReadData["body"]) =>
      requestHostData(() => api.prepareRead({ ...base, body })),
    pendingFacts: (body: wire.PendingFactsData["body"]) =>
      requestHostData(() => api.pendingFacts({ ...base, body })),
    completePending: (body: wire.CompletePendingData["body"]) =>
      requestHostData(() => api.completePending({ ...base, body })),
    pendingAttachments: (body: wire.PendingAttachmentsData["body"]) =>
      requestHostData(() => api.pendingAttachments({ ...base, body })),
    updateAttachment: (body: wire.UpdateAttachmentData["body"]) =>
      requestHostData(() => api.updateAttachment({ ...base, body })),
    pendingReferences: (body: wire.PendingReferencesData["body"]) =>
      requestHostData(() => api.pendingReferences({ ...base, body })),
    updateReference: (body: wire.UpdateReferenceData["body"]) =>
      requestHostData(() => api.updateReference({ ...base, body })),
    readEvents: (body: wire.ReadEventsData["body"]) =>
      requestHostData(() => api.readEvents({ ...base, body })),
    readHistoryCoverage: (body: wire.ReadHistoryCoverageData["body"]) =>
      requestHostData(() => api.readHistoryCoverage({ ...base, body })),
    updateHistoryCoverage: (body: wire.UpdateHistoryCoverageData["body"]) =>
      requestHostData(() => api.updateHistoryCoverage({ ...base, body })),
    resolveAccount: (body: wire.ResolveAccountData["body"]) =>
      requestHostData(() => api.resolveAccount({ ...base, body })),
    resolveGroup: (body: wire.ResolveGroupData["body"]) =>
      requestHostData(() => api.resolveGroup({ ...base, body })),
    bindSubjectAccount: (body: wire.BindSubjectAccountData["body"]) =>
      requestHostData(() => api.bindSubjectAccount({ ...base, body })),
    adoptDelivery: (body: wire.AdoptDeliveryData["body"]) =>
      requestHostData(() => api.adoptDelivery({ ...base, body })),
    authorizeDelivery: (body: wire.AuthorizeDeliveryData["body"]) =>
      requestHostData(() => api.authorizeDelivery({ ...base, body })),
    beginDelivery: (body: wire.BeginDeliveryData["body"]) =>
      requestHostData(() => api.beginDelivery({ ...base, body })),
    recordDelivery: (body: wire.RecordDeliveryData["body"]) =>
      requestHostData(() => api.recordDelivery({ ...base, body })),
    proposeActivity: (body: wire.ProposeActivityData["body"]) =>
      requestHostData(() => api.proposeActivity({ ...base, body })),
    adoptActivity: (body: wire.AdoptActivityData["body"]) =>
      requestHostData(() => api.adoptActivity({ ...base, body })),
    transitionActivity: (body: wire.TransitionActivityData["body"]) =>
      requestHostData(() => api.transitionActivity({ ...base, body })),
    progressActivity: (body: wire.ProgressActivityData["body"]) =>
      requestHostData(() => api.progressActivity({ ...base, body })),
    scheduleActivities: (body: wire.ScheduleActivitiesData["body"]) =>
      requestHostData(() => api.scheduleActivities({ ...base, body })),
    takeAttention: (body: wire.TakeAttentionData["body"]) =>
      requestHostData(() => api.takeAttention({ ...base, body })),
    prepareCognition: (body: wire.PrepareCognitionData["body"]) =>
      requestHostData(() => api.prepareCognition({ ...base, body })),
    admitCognition: (body: wire.AdmitCognitionData["body"]) =>
      requestHostData(() => api.admitCognition({ ...base, body })),
    handoffCognition: (body: wire.HandoffCognitionData["body"]) =>
      requestHostData(() => api.handoffCognition({ ...base, body })),
    feedbackCognition: (body: wire.FeedbackCognitionData["body"]) =>
      requestHostData(() => api.feedbackCognition({ ...base, body })),
  });
}
/** The complete generated service facade used by the independently installed Channel plugin. */
export type GatewayHostClient = ReturnType<typeof createGatewayHostClient>;
