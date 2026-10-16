// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Service-only channel boundaries; these contracts grant no model authority.
 * @module gateway-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { qqAuthorizationSchema } from "@heptalogos/management";
const object = { additionalProperties: false } as const;
const key = Type.String({ minLength: 1, maxLength: 2048 });
/** Current installation grants, resolved by Host rather than plugin model parameters. */
export const gatewayScopeSchema = Type.Object(
  {
    subjectId: key,
    revision: key,
    ...qqAuthorizationSchema.properties,
  },
  object,
);
/** Host-resolved grants are immutable snapshots, rechecked at the actual effect point. */
export type GatewayScope = Static<typeof gatewayScopeSchema>;
/** Raw protocol values are stored before interpretation and never returned by normal message reads. */
export const archiveEnvelopeInputSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("envelope"), Type.Literal("segment")]),
    value: Type.Unknown(),
  },
  object,
);
/** Protected raw reference, usable only by the trusted channel service. */
export const archiveEnvelopeResultSchema = Type.Object({ reference: key }, object);
/** Trusted forward expansion may retrieve the protected original envelope or segment. */
export const readArchiveInputSchema = Type.Object({ reference: key }, object);
/** Original protocol JSON, without transformation into a second message truth. */
export const readArchiveResultSchema = Type.Object({ value: Type.Unknown() }, object);
/** Content-addressed bytes returned after a complete bounded upload. */
export const uploadAttachmentResultSchema = Type.Object(
  {
    reference: key,
    sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    bytes: Type.Integer({ minimum: 0 }),
    mediaType: key,
  },
  object,
);
