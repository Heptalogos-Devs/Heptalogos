// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Portable public Management client, generated types and classified errors.
 * @packageDocumentation
 */
export { createManagementClient, ManagementClientError } from "./client.js";
export type {
  ManagementClient,
  ManagementClientOptions,
  ManagementProblemDetails,
  ManagementDiscoveryResult,
  ClaimFirstAdministratorInput,
  ClaimFirstAdministratorResult,
  ManagementLoginInput,
  ManagementLoginResult,
  ProductStatusResult,
  ProductConfigurationResult,
  ProductConfigurationInput,
  ProductSettings,
} from "./client.js";

export type { BindSubjectInput, CreateSubjectInput } from "./client.js";

export {
  createGatewayHostClient,
  type GatewayHostClient,
  type GatewayHostClientOptions,
} from "./gateway-client.js";
