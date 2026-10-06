// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns branded Foundation identifiers and their UUID/content parsing rules so
 * higher packages preserve identity distinctions instead of passing strings.
 * @module identity
 */

import { validate as validateUuid, v7 as uuidv7, version as uuidVersion } from "uuid";
import type { Sha256Digest } from "./digest.js";

/** The UUID-v7 shape accepted by Foundation identity parsers. */
export const UUID_V7_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
/** The lowercase SHA-256 shape required for content digest values. */
export const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";

const uuidV7Shape = new RegExp(UUID_V7_PATTERN, "u");
const sha256HexShape = new RegExp(SHA256_HEX_PATTERN, "u");

/** Adds a compile-time brand to a structurally compatible value. */
export type Branded<T, TBrand extends string> = T & {
  readonly __brand: TBrand;
};
/** Represents a UUID-v7 value whose brand identifies its semantic owner. */
export type UuidV7Id<TBrand extends string> = Branded<string, `uuidv7:${TBrand}`>;
/** Represents a SHA-256 digest whose brand identifies the digested contract. */
export type ContentDigest<TBrand extends string> = Branded<string, `sha256:${TBrand}`>;

/** Identifies one installed Heptalogos installation. */
export type InstallationId = UuidV7Id<"InstallationId">;
/** Identifies one runtime instance within an installation. */
export type InstanceId = UuidV7Id<"InstanceId">;
/** Identifies one process boot and its recovery lineage. */
export type BootId = UuidV7Id<"BootId">;
/** Identifies one canonical continuity epoch. */
export type ContinuityEpochId = UuidV7Id<"ContinuityEpochId">;
/** Identifies the current Host ownership token. */
export type HostOwnershipToken = UuidV7Id<"HostOwnershipToken">;
/** Identifies one Foundation Activity. */
export type ActivityId = UuidV7Id<"ActivityId">;
/** Identifies one retained Evidence record. */
export type EvidenceId = UuidV7Id<"EvidenceId">;
/** Identifies the persistent logical Subject. */
export type SubjectId = UuidV7Id<"SubjectId">;
/** Identifies one canonical messaging account. */
export type MessagingAccountId = UuidV7Id<"MessagingAccountId">;
/** Identifies one canonical conversation. */
export type CanonicalConversationId = UuidV7Id<"CanonicalConversationId">;
/** Identifies one canonical message fact. */
export type CanonicalMessageId = UuidV7Id<"CanonicalMessageId">;
/** Identifies one durable Subject Reaction. */
export type ReactionId = UuidV7Id<"ReactionId">;
/** Identifies one immutable Subject CommunicationCommit. */
export type CommunicationCommitId = UuidV7Id<"CommunicationCommitId">;
/** Represents a normalized UTC instant with millisecond precision. */
export type Instant = Branded<string, "Instant">;

const canonicalInstantShape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Creates a new UUID-v7 value with the requested compile-time brand. */
export function createUuidV7Id<TBrand extends string>(brand: TBrand): UuidV7Id<TBrand> {
  void brand;
  return uuidv7() as UuidV7Id<TBrand>;
}

/** Creates an installation identity for a new installation. */
export const createInstallationId = (): InstallationId =>
  createUuidV7Id("InstallationId");
/** Creates an instance identity for a new runtime instance. */
export const createInstanceId = (): InstanceId => createUuidV7Id("InstanceId");
/** Creates a boot identity for the current process start. */
export const createBootId = (): BootId => createUuidV7Id("BootId");
/** Creates a continuity epoch identity for a canonical state lineage. */
export const createContinuityEpochId = (): ContinuityEpochId =>
  createUuidV7Id("ContinuityEpochId");
/** Creates the token published while a Host owns the database fence. */
export const createHostOwnershipToken = (): HostOwnershipToken =>
  createUuidV7Id("HostOwnershipToken");
/** Creates an Activity identity for a Foundation operation. */
export const createActivityId = (): ActivityId => createUuidV7Id("ActivityId");
/** Creates an Evidence identity for a retained record. */
export const createEvidenceId = (): EvidenceId => createUuidV7Id("EvidenceId");
/** Creates a persistent logical Subject identity. */
export const createSubjectId = (): SubjectId => createUuidV7Id("SubjectId");
/** Creates a canonical messaging account identity. */
export const createMessagingAccountId = (): MessagingAccountId =>
  createUuidV7Id("MessagingAccountId");
/** Creates a canonical conversation identity. */
export const createCanonicalConversationId = (): CanonicalConversationId =>
  createUuidV7Id("CanonicalConversationId");
/** Creates a canonical message identity. */
export const createCanonicalMessageId = (): CanonicalMessageId =>
  createUuidV7Id("CanonicalMessageId");
/** Creates a durable Subject Reaction identity. */
export const createReactionId = (): ReactionId => createUuidV7Id("ReactionId");
/** Creates an immutable Subject CommunicationCommit identity. */
export const createCommunicationCommitId = (): CommunicationCommitId =>
  createUuidV7Id("CommunicationCommitId");

/** Accepts only genuine UUID-v7 strings, not merely UUID-shaped text. */
export function isUuidV7(value: unknown): value is UuidV7Id<string> {
  return (
    typeof value === "string" &&
    uuidV7Shape.test(value) &&
    validateUuid(value) &&
    uuidVersion(value) === 7
  );
}

/** Parses a UUID-v7 value into the caller's requested semantic brand. */
export function parseUuidV7Id<TBrand extends string>(
  brand: TBrand,
  value: unknown,
): UuidV7Id<TBrand> | undefined {
  void brand;
  return isUuidV7(value) ? (value as UuidV7Id<TBrand>) : undefined;
}

/** Parses an installation identity without accepting another UUID brand. */
export const parseInstallationId = (value: unknown): InstallationId | undefined =>
  parseUuidV7Id("InstallationId", value);
/** Parses an instance identity without accepting another UUID brand. */
export const parseInstanceId = (value: unknown): InstanceId | undefined =>
  parseUuidV7Id("InstanceId", value);
/** Parses a boot identity without accepting another UUID brand. */
export const parseBootId = (value: unknown): BootId | undefined =>
  parseUuidV7Id("BootId", value);
/** Parses a continuity epoch identity without accepting another UUID brand. */
export const parseContinuityEpochId = (value: unknown): ContinuityEpochId | undefined =>
  parseUuidV7Id("ContinuityEpochId", value);
/** Parses the current Host token without accepting another UUID brand. */
export const parseHostOwnershipToken = (
  value: unknown,
): HostOwnershipToken | undefined => parseUuidV7Id("HostOwnershipToken", value);
/** Parses an Activity identity without accepting another UUID brand. */
export const parseActivityId = (value: unknown): ActivityId | undefined =>
  parseUuidV7Id("ActivityId", value);
/** Parses an Evidence identity without accepting another UUID brand. */
export const parseEvidenceId = (value: unknown): EvidenceId | undefined =>
  parseUuidV7Id("EvidenceId", value);
/** Parses a Subject identity without accepting another UUID brand. */
export const parseSubjectId = (value: unknown): SubjectId | undefined =>
  parseUuidV7Id("SubjectId", value);
/** Parses a canonical messaging account identity. */
export const parseMessagingAccountId = (
  value: unknown,
): MessagingAccountId | undefined => parseUuidV7Id("MessagingAccountId", value);
/** Parses a canonical conversation identity. */
export const parseCanonicalConversationId = (
  value: unknown,
): CanonicalConversationId | undefined =>
  parseUuidV7Id("CanonicalConversationId", value);
/** Parses a canonical message identity. */
export const parseCanonicalMessageId = (
  value: unknown,
): CanonicalMessageId | undefined => parseUuidV7Id("CanonicalMessageId", value);
/** Parses a durable Subject Reaction identity. */
export const parseReactionId = (value: unknown): ReactionId | undefined =>
  parseUuidV7Id("ReactionId", value);
/** Parses an immutable Subject CommunicationCommit identity. */
export const parseCommunicationCommitId = (
  value: unknown,
): CommunicationCommitId | undefined => parseUuidV7Id("CommunicationCommitId", value);

/** Parses the canonical UTC instant representation used by durable records. */
export const parseInstant = (value: unknown): Instant | undefined => {
  if (typeof value !== "string" || !canonicalInstantShape.test(value)) {
    return undefined;
  }

  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;

  const normalized = new Date(milliseconds).toISOString();
  return normalized === value ? (value as Instant) : undefined;
};

/** Formats a Date into the canonical millisecond-precision UTC instant. */
export const formatInstant = (value: Date): Instant => {
  const formatted = value.toISOString();
  return formatted as Instant;
};

/** Checks whether a value is a lowercase hexadecimal SHA-256 digest. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && sha256HexShape.test(value);
}

/** Parses a digest into the caller's semantic content-digest brand. */
export function parseContentDigest<TBrand extends string>(
  brand: TBrand,
  value: unknown,
): ContentDigest<TBrand> | undefined {
  void brand;
  return isSha256Hex(value) ? (value as ContentDigest<TBrand>) : undefined;
}

/** Brands a validated SHA-256 digest for a specific content contract. */
export function asContentDigest<TBrand extends string>(
  brand: TBrand,
  digest: Sha256Digest,
): ContentDigest<TBrand> {
  void brand;
  if (!isSha256Hex(digest.hex)) {
    throw new TypeError("Content digest must be a lowercase SHA-256 hex value");
  }
  return digest.hex as ContentDigest<TBrand>;
}
