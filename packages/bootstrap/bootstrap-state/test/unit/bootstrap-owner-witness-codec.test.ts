// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createBootId, createUuidV7Id } from "@heptalogos/foundation-contracts";
import { describe, expect, it } from "vitest";
import {
  parseBootstrapOwnerWitness,
  sealBootstrapOwnerWitness,
} from "../../src/bootstrap-owner-witness-codec.js";
import type {
  BootstrapLockGenerationId,
  BootstrapOwnerWitnessBodyV1,
} from "../../src/bootstrap-owner-witness-model.js";

function makeBody(
  overrides: Partial<BootstrapOwnerWitnessBodyV1> = {},
): BootstrapOwnerWitnessBodyV1 {
  return {
    schemaVersion: 1,
    phase: "ATTEMPT",
    lockGenerationId: createUuidV7Id(
      "BootstrapLockGenerationId",
    ) as BootstrapLockGenerationId,
    bootId: createBootId(),
    pid: process.pid,
    processStartedAtMs: Date.now() - 100,
    heartbeatMs: 1_000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("bootstrap owner witness codec", () => {
  it.each(["ATTEMPT", "OWNER", "RELEASING"] as const)(
    "round-trips %s witnesses",
    (phase) => {
      const body = makeBody({ phase });
      const sealed = sealBootstrapOwnerWitness(body);

      expect(parseBootstrapOwnerWitness(JSON.stringify(sealed))).toEqual({
        ok: true,
        value: sealed,
      });
    },
  );

  it("rejects a future schema", () => {
    const text = JSON.stringify({ witness: { schemaVersion: 2 } });

    expect(parseBootstrapOwnerWitness(text)).toMatchObject({
      ok: false,
      problem: { problemCode: "bootstrap.owner_witness.unsupported_schema" },
    });
  });

  it("rejects unknown fields", () => {
    const sealed = sealBootstrapOwnerWitness(makeBody());
    const parsed = JSON.parse(JSON.stringify(sealed)) as Record<string, unknown>;
    (parsed.witness as Record<string, unknown>).unexpected = true;

    expect(parseBootstrapOwnerWitness(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      problem: { problemCode: "bootstrap.owner_witness.invalid_schema" },
    });
  });

  it("rejects a tampered digest", () => {
    const sealed = sealBootstrapOwnerWitness(makeBody());
    const parsed = JSON.parse(JSON.stringify(sealed)) as {
      digest: { hex: string };
    };
    parsed.digest.hex = "0".repeat(64);

    expect(parseBootstrapOwnerWitness(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      problem: { problemCode: "bootstrap.owner_witness.digest_mismatch" },
    });
  });

  it.each([
    ["pid", { pid: 0 }],
    ["processStartedAtMs", { processStartedAtMs: -1 }],
    ["heartbeatMs", { heartbeatMs: 999 }],
  ])("rejects invalid %s", (_label, override) => {
    const sealed = sealBootstrapOwnerWitness(
      makeBody(override as Partial<BootstrapOwnerWitnessBodyV1>),
    );

    expect(parseBootstrapOwnerWitness(JSON.stringify(sealed))).toMatchObject({
      ok: false,
      problem: { problemCode: "bootstrap.owner_witness.invalid_schema" },
    });
  });
});
