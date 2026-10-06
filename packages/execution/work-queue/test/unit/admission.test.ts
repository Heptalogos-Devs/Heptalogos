// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { type Instant } from "@heptalogos/foundation-contracts";
import {
  applyWorkAdmissionDecision,
  type WorkCreationAdmissionDecision,
} from "../../src/index.js";

const requested = "2026-08-26T12:00:00.000Z" as Instant;
const delayed = "2026-08-26T12:05:00.000Z" as Instant;

describe("WorkAdmissionPort decision mechanics", () => {
  it("allows creation without inventing a dispatch delay", () => {
    expect(applyWorkAdmissionDecision(requested, { decision: "ALLOW" })).toBe(
      requested,
    );
    expect(applyWorkAdmissionDecision(undefined, { decision: "ALLOW" })).toBe(
      undefined,
    );
  });

  it("retains a durable item with the later explicit deadline for DELAY", () => {
    const decision: WorkCreationAdmissionDecision = {
      decision: "DELAY",
      notBefore: delayed,
      reasonCode: "pressure.delayed",
    };
    expect(applyWorkAdmissionDecision(requested, decision)).toBe(delayed);
  });

  it("requires an explicit deadline for THROTTLE instead of silently allowing work", () => {
    expect(
      applyWorkAdmissionDecision(undefined, {
        decision: "THROTTLE",
        reasonCode: "pressure.throttled",
        notBefore: delayed,
      }),
    ).toBe(delayed);
    expect(() =>
      applyWorkAdmissionDecision(undefined, {
        decision: "THROTTLE",
        reasonCode: "pressure.throttled",
      }),
    ).toThrowError("THROTTLE");
  });

  it("rejects optional and new work before a durable row exists", () => {
    for (const decision of [
      { decision: "REJECT_OPTIONAL", reasonCode: "pressure.optional" },
      { decision: "REJECT_NEW_WORK", reasonCode: "pressure.new" },
    ] as const) {
      expect(() => applyWorkAdmissionDecision(undefined, decision)).toThrowError(
        decision.reasonCode,
      );
    }
  });

  it("rejects an unknown or malformed decision rather than falling back to ALLOW", () => {
    expect(() =>
      applyWorkAdmissionDecision(undefined, {
        decision: "UNKNOWN",
      } as never),
    ).toThrowError("decision");
  });
});
