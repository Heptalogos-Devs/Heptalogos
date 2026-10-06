// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines BootstrapState-owned runtime schemas for strict envelope and journal
 * validation while delegating validator mechanics to SchemaRuntime.
 * @module schemas
 */

import { SHA256_HEX_PATTERN } from "@heptalogos/foundation-contracts";
import { Type } from "@heptalogos/schema-runtime/typebox";

/** Schema for the digest fields shared by BootstrapState durable envelopes. */
export const bootstrapDigestSchema = Type.Object(
  {
    algorithm: Type.Literal("sha256"),
    canonicalization: Type.Literal("RFC8785-JCS"),
    domain: Type.String({ minLength: 1 }),
    hex: Type.String({ pattern: SHA256_HEX_PATTERN }),
  },
  { additionalProperties: false },
);
