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

async function request<T>(
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
    getSubject: () => request(() => getBoundSubject(base)),
    bindSubject: (body: BindSubjectInput) =>
      request(() => bindProductSubject({ ...base, body })),
    createSubject: (body: CreateSubjectInput) =>
      request(() => createProductSubject({ ...base, body })),
    getDiscovery: () => request(() => getManagementDiscovery(base)),
    getStatus: () => request(() => getProductStatus(base)),
    claimFirstAdministrator: (body: ClaimFirstAdministratorInput) =>
      request(() => claimFirstAdministrator({ ...base, body })),
    login: (body: ManagementLoginInput) =>
      request(() => createManagementSession({ ...base, body })),
    logout: () => request(() => revokeCurrentManagementSession(base)),
    describeConfiguration: () => request(() => describeProductConfiguration(base)),
    getConfiguration: () => request(() => getProductConfiguration(base)),
    configure: (body: ProductConfigurationInput) =>
      request(() => configureProduct({ ...base, body })),
    checkConfiguration: (body: ProductSettings) =>
      request(() => checkProductConfiguration({ ...base, body })),
  });
}
