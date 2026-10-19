// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Typed facade over the sole generated Management transport.
 * @module client
 */
import {
  getManagementDiscovery,
  getProductStatus,
  claimFirstAdministrator,
  createManagementSession,
  revokeCurrentManagementSession,
  describeProductConfiguration,
  getProductConfiguration,
  configureProduct,
  checkProductConfiguration,
  getBoundSubject,
  bindProductSubject,
  createProductSubject,
  getOperatorOverview,
  getSubjectDocuments,
  importSubjectDocument,
  getDefaultCalendar,
  getSchoolTimeTemplate,
  getCalendarMoment,
  getTaskDetails,
  resumeTask,
} from "./generated/index.js";
import { createClient } from "./generated/client/index.js";
import type {
  ClaimFirstAdministratorData,
  ClaimFirstAdministratorErrors,
  ClaimFirstAdministratorResponses,
  CreateManagementSessionData,
  CreateManagementSessionResponses,
  GetManagementDiscoveryResponses,
  GetProductStatusResponses,
  GetProductConfigurationResponses,
  ConfigureProductData,
  CheckProductConfigurationData,
  BindProductSubjectData,
  CreateProductSubjectData,
  ImportSubjectDocumentData,
} from "./generated/types.gen.js";

/** Canonical generated Problem response. */
export type ManagementProblemDetails = ClaimFirstAdministratorErrors[400];
/** Public installed Host identity. */
export type ManagementDiscoveryResult = GetManagementDiscoveryResponses[200];
/** Input for consuming the local first claim. */
export type ClaimFirstAdministratorInput = ClaimFirstAdministratorData["body"];
/** Claim result without the administrator password. */
export type ClaimFirstAdministratorResult = ClaimFirstAdministratorResponses[201];
/** Administrator login input. */
export type ManagementLoginInput = CreateManagementSessionData["body"];
/** One-time session token and expiry. */
export type ManagementLoginResult = CreateManagementSessionResponses[200];
/** Management and dependency status. */
export type ProductStatusResult = GetProductStatusResponses[200];
/** Current settings and CAS revision. */
export type ProductConfigurationResult = GetProductConfigurationResponses[200];
/** Exact settings replacement with expected revision. */
export type ProductConfigurationInput = ConfigureProductData["body"];
/** Schema-generated product settings. */
export type ProductSettings = CheckProductConfigurationData["body"];
/** Explicit Subject binding with expected revision. */
export type BindSubjectInput = BindProductSubjectData["body"];
/** Idempotent Subject creation with optional Seed. */
export type CreateSubjectInput = CreateProductSubjectData["body"];

/** A transport or canonical Management failure surfaced by the client. */
export class ManagementClientError extends Error {
  readonly problem?: ManagementProblemDetails;
  readonly status?: number;

  /** Creates a redacted client error from a generated response failure. */
  constructor(error: unknown) {
    const problem = problemDetails(error);
    super(
      problem?.detail ??
        "The Management Host could not complete the requested operation",
    );
    this.name = "ManagementClientError";
    this.problem = problem;
    this.status = problem?.status;
  }
}

function problemDetails(value: unknown): ManagementProblemDetails | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.type !== "string" ||
    typeof record.title !== "string" ||
    typeof record.status !== "number" ||
    typeof record.detail !== "string" ||
    typeof record.problemCode !== "string" ||
    typeof record.category !== "string" ||
    typeof record.retryClass !== "string" ||
    record.schemaVersion !== 1
  ) {
    return undefined;
  }
  return value as ManagementProblemDetails;
}

/** One authenticated, cancellable client for an installed Management origin. */
export interface ManagementClientOptions {
  readonly origin: string;
  readonly sessionToken?: string;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}
/** Public client shape is inferred from the generated operations it exposes. */
export type ManagementClient = ReturnType<typeof createManagementClient>;
type ClientFieldsResponse<T> = { readonly data: T };

/** Shares generated Host response and Problem handling across authentication domains. */
export async function requestHostData<T>(
  operation: () => Promise<ClientFieldsResponse<T>>,
): Promise<T> {
  try {
    return (await operation()).data;
  } catch (error) {
    if (error instanceof ManagementClientError) throw error;
    throw new ManagementClientError(error);
  }
}

/** Creates the same portable client consumed by CLI and external callers. */
export function createManagementClient(options: ManagementClientOptions) {
  const transport = createClient({
    baseUrl: options.origin,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.sessionToken ? { auth: options.sessionToken } : {}),
  });
  const base = {
    client: transport,
    throwOnError: true as const,
    responseStyle: "fields" as const,
    signal: options.signal,
  };
  return Object.freeze({
    getOverview: () => requestHostData(() => getOperatorOverview(base)),
    getSubjectDocuments: () => requestHostData(() => getSubjectDocuments(base)),
    importSubjectDocument: (body: ImportSubjectDocumentData["body"]) =>
      requestHostData(() => importSubjectDocument({ ...base, body })),
    getSchoolTimeTemplate: () => requestHostData(() => getSchoolTimeTemplate(base)),
    getCalendarMoment: (query: { at: string; to?: string }) =>
      requestHostData(() => getCalendarMoment({ ...base, query })),
    getTaskDetails: (
      activityId: string,
      query: { inputs?: "true"; before?: string; runId?: string } = {},
    ) =>
      requestHostData(() => getTaskDetails({ ...base, path: { activityId }, query })),
    resumeTask: (activityId: string) =>
      requestHostData(() => resumeTask({ ...base, path: { activityId } })),
    getCalendar: (
      query: { period?: "today" | "week" | "range"; from?: string; to?: string } = {},
    ) => requestHostData(() => getDefaultCalendar({ ...base, query })),
    getSubject: () => requestHostData(() => getBoundSubject(base)),
    bindSubject: (body: BindSubjectInput) =>
      requestHostData(() => bindProductSubject({ ...base, body })),
    createSubject: (body: CreateSubjectInput) =>
      requestHostData(() => createProductSubject({ ...base, body })),
    getDiscovery: () => requestHostData(() => getManagementDiscovery(base)),
    getStatus: () => requestHostData(() => getProductStatus(base)),
    claimFirstAdministrator: (body: ClaimFirstAdministratorInput) =>
      requestHostData(() => claimFirstAdministrator({ ...base, body })),
    login: (body: ManagementLoginInput) =>
      requestHostData(() => createManagementSession({ ...base, body })),
    logout: () => requestHostData(() => revokeCurrentManagementSession(base)),
    describeConfiguration: () =>
      requestHostData(() => describeProductConfiguration(base)),
    getConfiguration: () => requestHostData(() => getProductConfiguration(base)),
    configure: (body: ProductConfigurationInput) =>
      requestHostData(() => configureProduct({ ...base, body })),
    checkConfiguration: (body: ProductSettings) =>
      requestHostData(() => checkProductConfiguration({ ...base, body })),
  });
}
