// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Host Entity contracts; presentation labels never authorize identity linkage.
 * @module contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";
const key = Type.String({ minLength: 1, maxLength: 2048 });
const object = { additionalProperties: false } as const;
/** Stable opaque Host identifier, independent of any cognitive Subject identifier. */
export const entitySchema = Type.Object(
  {
    entityRef: Type.String({
      pattern:
        "^entity:heptalogos:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    }),
    kind: Type.Union([
      Type.Literal("person"),
      Type.Literal("group"),
      Type.Literal("subject"),
    ]),
  },
  object,
);
/** The public opaque EntityRef and its Host-owned entity classification. */
export type HostEntity = Static<typeof entitySchema>;
/** QQ account and UID may be formally linked by authenticated protocol evidence. */
export const resolveAccountInputSchema = Type.Object(
  { platform: key, accountId: key, uid: Type.Optional(key) },
  object,
);
/** Authenticated native account and optional UID keys for formal person resolution. */
export type ResolveAccountInput = Static<typeof resolveAccountInputSchema>;
/** Groups are independent entities; they are never person aliases. */
export const resolveGroupInputSchema = Type.Object(
  { platform: key, groupId: key },
  object,
);
/** Selects the cognitive Subject whose independent Host self Entity is requested. */
export const subjectEntityInputSchema = Type.Object({ subjectId: key }, object);
/** Returns an established Subject Entity or an explicit absent result. */
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
    entityRef: entitySchema.properties.entityRef,
  },
  object,
);
/** A stable actor key belongs only to one virtual world; no platform account is inferred. */
export const resolveWorldActorInputSchema = Type.Object(
  {
    worldId: Type.String({
      pattern:
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    }),
    actorKey: key,
  },
  object,
);
/** Exact verification of an already adopted world actor identity. */
export const readWorldActorInputSchema = Type.Object(
  { ...resolveWorldActorInputSchema.properties },
  object,
);
/** Verifies a bounded batch of virtual actors against their exact world scope. */
export const readWorldActorsInputSchema = Type.Object(
  {
    worldId: resolveWorldActorInputSchema.properties.worldId,
    entityRefs: Type.Array(entitySchema.properties.entityRef, {
      maxItems: 128,
      uniqueItems: true,
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
  /** Resolves a virtual actor to a canonical world-scoped person Entity. */
  resolveWorldActor(
    input: Static<typeof resolveWorldActorInputSchema>,
  ): Promise<HostEntity>;
  /** Reads the same world actor without creating identity state. */
  readWorldActor(
    input: Static<typeof readWorldActorInputSchema>,
  ): Promise<{ entity: HostEntity | null }>;
  /** Returns only actual mappings in the requested world, for world-definition adoption. */
  readWorldActors(
    input: Static<typeof readWorldActorsInputSchema>,
  ): Promise<{ actors: { actorKey: string; entity: HostEntity }[] }>;
  /** Resolves formally authenticated account and UID keys to one Host Entity. */
  resolveAccount(input: ResolveAccountInput): Promise<HostEntity>;
  /** Resolves a native group as an Entity independent of person accounts. */
  resolveGroup(input: Static<typeof resolveGroupInputSchema>): Promise<HostEntity>;
  /** Creates or returns the stable Host self Entity of the existing cognitive Subject. */
  ensureSubjectEntity(
    input: Static<typeof subjectEntityInputSchema>,
  ): Promise<HostEntity>;
  /** Reads the Subject self Entity without creating identity state. */
  readSubjectEntity(
    input: Static<typeof subjectEntityInputSchema>,
  ): Promise<Static<typeof subjectEntityResultSchema>>;
  /** Associates a self account with the same Subject Entity across account changes. */
  bindSubjectAccount(
    input: Static<typeof bindSubjectAccountInputSchema>,
  ): Promise<HostEntity>;
  /** Links authenticated new account keys to an explicitly authorized existing Entity. */
  linkAccount(input: Static<typeof linkAccountInputSchema>): Promise<HostEntity>;
}
