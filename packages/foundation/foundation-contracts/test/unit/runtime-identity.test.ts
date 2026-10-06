// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createCapabilityId,
  createContributionId,
  createEffectKindId,
  createEffectOperationId,
  createMicroSystemId,
  createMicroSystemInstanceId,
  createProviderId,
  createServiceId,
  createWorkItemId,
  asDurableCodeVersion,
  digestCanonicalJson,
  parseDurableCodeVersion,
  parseCapabilityId,
  parseContributionId,
  parseEffectKindId,
  parseEffectOperationId,
  parseMicroSystemId,
  parseMicroSystemInstanceId,
  parseProviderId,
  parseServiceId,
  parseWorkItemId,
} from "../../src/index.js";

describe("runtime identity primitives", () => {
  it("creates and parses the canonical runtime namespaced IDs", () => {
    const microSystemId = createMicroSystemId("foundation.runtime-kernel");
    const serviceId = createServiceId("foundation.persistence");
    const capabilityId = createCapabilityId("ai.text-generation");
    const providerId = createProviderId("provider.synthetic-a");

    expect(parseMicroSystemId(microSystemId)).toBe(microSystemId);
    expect(parseServiceId(serviceId)).toBe(serviceId);
    expect(parseCapabilityId(capabilityId)).toBe(capabilityId);
    expect(parseProviderId(providerId)).toBe(providerId);
  });

  it("rejects invalid, non-lowercase, oversized, and separator-only names", () => {
    const invalid = [
      "Foundation.persistence",
      "foundation_runtime",
      "foundation..persistence",
      "foundation.",
      ".foundation",
      "1foundation.persistence",
      "a".repeat(129),
      "",
    ];
    for (const value of invalid) {
      expect(parseServiceId(value)).toBeUndefined();
    }
    expect(() => createServiceId("Foundation.persistence")).toThrow(TypeError);
  });

  it("creates a UUIDv7 MicroSystemInstanceId distinct from semantic IDs", () => {
    const instanceId = createMicroSystemInstanceId();
    expect(parseMicroSystemInstanceId(instanceId)).toBe(instanceId);
    expect(parseMicroSystemId(instanceId)).toBeUndefined();
  });

  it("creates and parses a ContributionId as a namespaced semantic ID", () => {
    const contributionId = createContributionId("foundation.work-handler");

    expect(parseContributionId(contributionId)).toBe(contributionId);
  });

  it("rejects invalid ContributionId shapes and oversized values", () => {
    const invalid = [
      "Foundation.work-handler",
      "foundation_work-handler",
      "foundation..work-handler",
      "foundation.",
      ".foundation",
      "1foundation.work-handler",
      "a".repeat(129),
      "",
    ];

    for (const value of invalid) {
      expect(parseContributionId(value)).toBeUndefined();
    }
    expect(() => createContributionId("Foundation.work-handler")).toThrow(TypeError);
  });

  it("creates and parses a UUIDv7 WorkItemId", () => {
    const workItemId = createWorkItemId();

    expect(parseWorkItemId(workItemId)).toBe(workItemId);
    expect(parseMicroSystemId(workItemId)).toBeUndefined();
  });

  it("creates and parses the EffectOperation UUID and EffectKind identities", () => {
    const effectOperationId = createEffectOperationId();
    const effectKind = createEffectKindId("synthetic.external-write");

    expect(parseEffectOperationId(effectOperationId)).toBe(effectOperationId);
    expect(parseEffectKindId(effectKind)).toBe(effectKind);
    expect(parseEffectKindId(effectOperationId)).toBeUndefined();
  });

  it("rejects malformed EffectOperation and EffectKind identities", () => {
    expect(
      parseEffectOperationId("550e8400-e29b-41d4-a716-446655440000"),
    ).toBeUndefined();
    for (const value of [
      "Synthetic.external-write",
      "synthetic_external-write",
      "synthetic..external-write",
      "synthetic.",
      "1synthetic.external-write",
      "a".repeat(129),
      "",
    ]) {
      expect(parseEffectKindId(value)).toBeUndefined();
    }
    expect(() => createEffectKindId("Synthetic.external-write")).toThrow(TypeError);
  });

  it("rejects invalid and non-v7 WorkItemId values", () => {
    expect(parseWorkItemId("not-a-uuid")).toBeUndefined();
    expect(parseWorkItemId("550e8400-e29b-41d4-a716-446655440000")).toBeUndefined();
  });

  it("keeps DurableCodeVersion distinct while using the canonical digest shape", () => {
    const digest = digestCanonicalJson("test.durable-code/v1", { code: "a" });
    const version = asDurableCodeVersion(digest);

    expect(parseDurableCodeVersion(version)).toBe(version);
    expect(parseDurableCodeVersion(version.toUpperCase())).toBeUndefined();
  });
});
