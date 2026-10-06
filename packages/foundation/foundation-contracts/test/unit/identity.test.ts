// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { validate as validateUuid, version as uuidVersion } from "uuid";
import { describe, expect, it } from "vitest";
import { digestCanonicalJson } from "../../src/digest.js";
import {
  asContentDigest,
  createBootId,
  createContinuityEpochId,
  createActivityId,
  createEvidenceId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  createUuidV7Id,
  parseContentDigest,
  parseBootId,
  parseContinuityEpochId,
  parseHostOwnershipToken,
  parseInstallationId,
  parseInstanceId,
  parseActivityId,
  parseEvidenceId,
  parseInstant,
  parseUuidV7Id,
  formatInstant,
} from "../../src/identity.js";

describe("identity primitives", () => {
  it("creates RFC 9562 UUIDv7 generated identities", () => {
    const id = createUuidV7Id("ActivityId");
    expect(validateUuid(id)).toBe(true);
    expect(uuidVersion(id)).toBe(7);
  });

  it("represents content generation as a digest rather than generating a UUID", () => {
    const digest = digestCanonicalJson("product-generation/v1", { manifest: "x" });
    const generation = asContentDigest("ProductGenerationId", digest);
    expect(generation).toBe(digest.hex);
    expect(validateUuid(generation)).toBe(false);
  });

  it("parses only RFC 9562 UUIDv7 values at a runtime boundary", () => {
    const id = createUuidV7Id("BootId");

    expect(parseUuidV7Id("BootId", id)).toBe(id);
    expect(parseUuidV7Id("BootId", "00000000-0000-4000-8000-000000000000")).toBe(
      undefined,
    );
    expect(parseUuidV7Id("BootId", "banana")).toBeUndefined();
  });

  it("parses HostOwnershipToken at a runtime boundary", () => {
    const token = createHostOwnershipToken();

    expect(parseHostOwnershipToken(token)).toBe(token);
    expect(parseHostOwnershipToken("00000000-0000-4000-8000-000000000000")).toBe(
      undefined,
    );
  });

  it("creates and parses ContinuityEpochId as UUIDv7", () => {
    const value = createContinuityEpochId();

    expect(uuidVersion(value)).toBe(7);
    expect(parseContinuityEpochId(value)).toBe(value);
    expect(parseContinuityEpochId("not-a-uuid")).toBeUndefined();
  });

  it("parses only lowercase SHA-256 content digest values", () => {
    const digest = digestCanonicalJson("product-generation/v1", { manifest: "x" });

    expect(parseContentDigest("ProductGenerationId", digest.hex)).toBe(digest.hex);
    expect(parseContentDigest("ProductGenerationId", "A".repeat(64))).toBeUndefined();
    expect(parseContentDigest("ProductGenerationId", "banana")).toBeUndefined();
  });

  it("keeps installation, instance, and boot identities distinct while using UUIDv7", () => {
    const installationId = createInstallationId();
    const instanceId = createInstanceId();
    const bootId = createBootId();

    expect(parseInstallationId(installationId)).toBe(installationId);
    expect(parseInstanceId(instanceId)).toBe(instanceId);
    expect(parseBootId(bootId)).toBe(bootId);
    expect(new Set([installationId, instanceId, bootId]).size).toBe(3);
    expect(uuidVersion(installationId)).toBe(7);
    expect(uuidVersion(instanceId)).toBe(7);
    expect(uuidVersion(bootId)).toBe(7);
  });

  it("creates a fresh UUIDv7 HostOwnershipToken for every acquisition", () => {
    const first = createHostOwnershipToken();
    const second = createHostOwnershipToken();

    expect(first).not.toBe(second);
    expect(validateUuid(first)).toBe(true);
    expect(uuidVersion(first)).toBe(7);
    expect(uuidVersion(second)).toBe(7);
  });

  it("rejects malformed or non-v7 typed identity values", () => {
    expect(parseInstallationId("banana")).toBeUndefined();
    expect(parseInstanceId("00000000-0000-4000-8000-000000000000")).toBeUndefined();
    expect(parseBootId(null)).toBeUndefined();
  });

  it("creates and parses ActivityId and EvidenceId as UUIDv7 identities", () => {
    const activityId = createActivityId();
    const evidenceId = createEvidenceId();

    expect(parseActivityId(activityId)).toBe(activityId);
    expect(parseEvidenceId(evidenceId)).toBe(evidenceId);
    expect(uuidVersion(activityId)).toBe(7);
    expect(uuidVersion(evidenceId)).toBe(7);
  });

  it("parses only canonical millisecond UTC Instants", () => {
    expect(parseInstant("2026-08-24T15:00:00.123Z")).toBeDefined();
    expect(parseInstant("2026-08-24T15:00:00Z")).toBeUndefined();
    expect(parseInstant("2026-08-24T23:00:00.123+08:00")).toBeUndefined();
  });

  it("formats Date to the canonical Instant contract", () => {
    expect(formatInstant(new Date("2026-08-24T15:00:00.123Z"))).toBe(
      "2026-08-24T15:00:00.123Z",
    );
  });
});
