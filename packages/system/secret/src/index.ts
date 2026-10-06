// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public normal Product Secret contracts and service construction.
 * @packageDocumentation
 */

export {
  secretMetadataSchema,
  secretRefSchema,
  secretReplaceInputSchema,
  secretResolutionContextSchema,
  secretRevokeInputSchema,
  secretScopeRefSchema,
  secretSetInputSchema,
  type ResolvedSecretMaterial,
  type SecretId,
  type SecretMetadata,
  type SecretRef,
  type SecretResolutionContext,
  type SecretScopeRef,
  type SecretService,
  type SecretServiceOptions,
  type SecretWriteInput,
} from "./contracts.js";
export { createSecretService } from "./service.js";
