// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Model-independent product Management, configuration and authentication.
 * @packageDocumentation
 */
export {
  FIRST_CLAIM_LIFETIME_MS,
  MANAGEMENT_API_BASE_PATH,
  MANAGEMENT_CONTRACT_VERSION,
  MANAGEMENT_DISCOVERY_PATH,
  SESSION_LIFETIME_MS,
  claimRequestSchema,
  claimResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  managementProblemSchema,
} from "./contracts.js";
export type {
  AdministratorId,
  FirstAdministratorClaimId,
  FirstClaimMaterial,
  ServerSession,
  ManagementDigest,
  ClaimRequest,
  ClaimResponse,
  LoginRequest,
  LoginResponse,
  ManagementProblemDetails,
} from "./contracts.js";
export {
  managementHttpStatus,
  managementProblem,
  toManagementProblemDetails,
  contractUnsupportedProblem,
  invalidInputProblem,
} from "./problems.js";

export { createManagementAuthentication } from "./authentication.js";
export type {
  ManagementAuthentication,
  ManagementAuthenticationOptions,
} from "./authentication.js";

export {
  ProductManagement,
  PRODUCT_SETTINGS_ID,
  productSettingsSchema,
  productSettingsDefinition,
  productStatusSchema,
  productConfigurationSchema,
  configureProductSchema,
} from "./product.js";
export type {
  ProductSettings,
  DependencyStatus,
  ProductStatus,
  ProductManagementOptions,
} from "./product.js";

export { productDiscoverySchema } from "./product.js";

export {
  managedSubjectSchema,
  createProductSubjectSchema,
  bindProductSubjectSchema,
  boundSubjectSchema,
} from "./product.js";
export type { ManagedSubject, CreateProductSubject, BoundSubject } from "./product.js";
