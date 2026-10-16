// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Host Entity contracts; presentation labels never authorize identity linkage. @module contracts */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";
const key = Type.String({ minLength: 1, maxLength: 2048 });
const object = { additionalProperties: false } as const;
/** Stable opaque Host identifier, independent of any cognitive Subject identifier. */
export const entitySchema = Type.Object(
  {
    entityRef: Type.String({
      pattern:
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    }),
    kind: Type.Union([
      Type.Literal("person"),
      Type.Literal("group"),
      Type.Literal("subject"),
    ]),
  },
  object,
);
export type HostEntity = Static<typeof entitySchema>;
/** QQ account and UID may be formally linked by authenticated protocol evidence. */
export const resolveAccountInputSchema = Type.Object(
  { platform: key, accountId: key, uid: Type.Optional(key) },
  object,
);
export type ResolveAccountInput = Static<typeof resolveAccountInputSchema>;
/** Groups are independent entities; they are never person aliases. */
export const resolveGroupInputSchema = Type.Object(
  { platform: key, groupId: key },
  object,
);
export const subjectEntityInputSchema = Type.Object({ subjectId: key }, object);
export const subjectEntityResultSchema = Type.Object(
  { entity: Type.Union([entitySchema, Type.Null()]) },
  object,
);
/** Explicit subject-account linkage keeps one Subject Entity across account changes. */
export const bindSubjectAccountInputSchema = Type.Object(
  { ...resolveAccountInputSchema.properties, subjectId: key },
  object,
);
/** Explicit cross-platform linkage is an authorized operation, never nickname matching. */
export const linkAccountInputSchema = Type.Object(
  {
    ...resolveAccountInputSchema.properties,
    entityRef: Type.String({
      pattern:
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    }),
  },
  object,
);
/** Current-Activity persistence is injected; identity does not call a network or cognition provider. */
export interface IdentityServiceOptions {
  readonly persistence: PersistenceService;
}
/** One formal owner for external accounts, group entities and Subject self identity. */
export interface IdentityService {
  resolveAccount(input: ResolveAccountInput): Promise<HostEntity>;
  resolveGroup(input: Static<typeof resolveGroupInputSchema>): Promise<HostEntity>;
  ensureSubjectEntity(
    input: Static<typeof subjectEntityInputSchema>,
  ): Promise<HostEntity>;
  readSubjectEntity(
    input: Static<typeof subjectEntityInputSchema>,
  ): Promise<Static<typeof subjectEntityResultSchema>>;
  bindSubjectAccount(
    input: Static<typeof bindSubjectAccountInputSchema>,
  ): Promise<HostEntity>;
  linkAccount(input: Static<typeof linkAccountInputSchema>): Promise<HostEntity>;
}
