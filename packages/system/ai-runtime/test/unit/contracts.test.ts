// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  CURRENT_MODEL_CAPABILITIES,
  gatewayProfileSchema,
  modelBindingSchema,
  modelProfileSchema,
} from "../../src/index.js";

describe("AIRuntime current gateway-first contracts", () => {
  it("keeps the exact four-capability, two-protocol, and two-binding surface", () => {
    expect(CURRENT_MODEL_CAPABILITIES).toEqual([
      "text-generation",
      "structured-output",
      "usage-metadata",
      "abort-timeout",
    ]);
    expect(
      compileSchema(modelBindingSchema).validate({
        schemaVersion: 1,
        modelBindingId: "01j00000000000000000000000",
        role: "subject.primary",
        modelProfileId: "01j00000000000000000000001",
        revision: 1,
        enabled: true,
      }).ok,
    ).toBe(true);
    expect(
      compileSchema(modelBindingSchema).validate({
        schemaVersion: 1,
        modelBindingId: "01j00000000000000000000000",
        role: "operator",
        modelProfileId: "01j00000000000000000000001",
        revision: 1,
        enabled: true,
      }).ok,
    ).toBe(false);
  });

  it("requires gateway/model/protocol fields and no upstream vendor fields", () => {
    const gateway = {
      schemaVersion: 1,
      gatewayProfileId: "01j00000000000000000000000",
      baseUrl: "https://gateway.example.com/v1",
      enabled: true,
    };
    expect(compileSchema(gatewayProfileSchema).validate(gateway).ok).toBe(true);
    expect(
      compileSchema(gatewayProfileSchema).validate({
        ...gateway,
        providerKind: "openai",
      }).ok,
    ).toBe(false);
    expect(
      compileSchema(modelProfileSchema).validate({
        schemaVersion: 1,
        modelProfileId: "01j00000000000000000000001",
        gatewayProfileId: "01j00000000000000000000000",
        modelIdentifier: "gateway-model",
        protocol: "openai-chat",
        consumedCapabilities: [...CURRENT_MODEL_CAPABILITIES],
        generation: 1,
      }).ok,
    ).toBe(true);
    expect(
      compileSchema(modelProfileSchema).validate({
        schemaVersion: 1,
        modelProfileId: "01j00000000000000000000001",
        gatewayProfileId: "01j00000000000000000000000",
        modelIdentifier: "gateway-model",
        protocol: "vendor-specific",
        consumedCapabilities: [...CURRENT_MODEL_CAPABILITIES],
        generation: 1,
      }).ok,
    ).toBe(false);
  });
});
