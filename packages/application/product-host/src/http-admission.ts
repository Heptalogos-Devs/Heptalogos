// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Defines the Product Host HTTP admission configuration and its defaults.
 * @module http-admission
 */

import type { CanonicalJsonValue } from "@heptalogos/foundation-contracts";
import type {
  ConfigurationDefinition,
  ConfigurationDefinitionId,
} from "@heptalogos/configuration";
import { Type } from "@heptalogos/schema-runtime/typebox";

/** Current Product Host HTTP body and authentication-admission values. */
export interface ManagementHttpAdmissionConfigV1 {
  readonly schemaVersion: 1;
  readonly bodyLimitBytes: number;
  readonly claimRateLimit: {
    readonly max: number;
    readonly windowMs: number;
  };
  readonly loginRateLimit: {
    readonly max: number;
    readonly windowMs: number;
  };
}

/** Stable current Product Host HTTP admission-definition identity. */
export const MANAGEMENT_HTTP_ADMISSION_DEFINITION_ID =
  "management.http.admission.v1" as ConfigurationDefinitionId;

/** JSON Schema for the bounded Product Host HTTP admission configuration. */
const managementHttpAdmissionConfigSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    bodyLimitBytes: Type.Integer({ minimum: 16 * 1024, maximum: 4 * 1024 * 1024 }),
    claimRateLimit: Type.Object(
      {
        max: Type.Integer({ minimum: 1, maximum: 20 }),
        windowMs: Type.Integer({ minimum: 1_000, maximum: 60 * 60 * 1_000 }),
      },
      { additionalProperties: false },
    ),
    loginRateLimit: Type.Object(
      {
        max: Type.Integer({ minimum: 1, maximum: 60 }),
        windowMs: Type.Integer({ minimum: 1_000, maximum: 60 * 60 * 1_000 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

/** Product Host owner-provided HTTP admission definition. */
export const managementHttpAdmissionConfigurationDefinition: ConfigurationDefinition =
  Object.freeze({
    schemaVersion: 1 as const,
    definitionId: MANAGEMENT_HTTP_ADMISSION_DEFINITION_ID,
    owner: "application.product-host",
    version: 1,
    scopeKind: "INSTALLATION" as const,
    valueSchema: managementHttpAdmissionConfigSchema as unknown as CanonicalJsonValue,
    classification: "INSTALLATION_CONFIG" as const,
    visibility: "EXPERT" as const,
    manageability: "EDITABLE" as const,
    activation: "RESTART_HOST" as const,
    sensitivity: "INTERNAL" as const,
    defaultAuthority: "PRODUCT_DEFAULT" as const,
    consumerRefs: Object.freeze(["application.product-host.http"]),
  });

/** Explicit Product default pinned on first installation materialization. */
export const DEFAULT_MANAGEMENT_HTTP_ADMISSION_CONFIG: ManagementHttpAdmissionConfigV1 =
  Object.freeze({
    schemaVersion: 1,
    bodyLimitBytes: 64 * 1024,
    claimRateLimit: Object.freeze({ max: 5, windowMs: 60_000 }),
    loginRateLimit: Object.freeze({ max: 10, windowMs: 60_000 }),
  });
