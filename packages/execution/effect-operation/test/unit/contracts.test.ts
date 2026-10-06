// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createActivityId,
  createContinuityEpochId,
  createEffectKindId,
  createEffectOperationId,
  createHostOwnershipToken,
  createInstanceId,
  createProblem,
  type EffectKindId,
  type EffectOperationId,
} from "@heptalogos/foundation-contracts";
import { describe, expect, it } from "vitest";
import { parseEffectOperationRow, snapshotEffectRequest } from "../../src/contracts.js";

function row(
  state: "PREPARED" | "DISPATCHING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN" = "PREPARED",
  effectOperationId: EffectOperationId = createEffectOperationId(),
  effectKind: EffectKindId = createEffectKindId("synthetic.external-write"),
): Record<string, unknown> {
  const token = state === "PREPARED" ? null : createHostOwnershipToken();
  const outcome =
    state === "PREPARED" || state === "DISPATCHING"
      ? null
      : {
          schemaVersion: 1,
          status: state,
          ...(state === "FAILED"
            ? {
                problem: createProblem({
                  problemCode: "synthetic.no-effect",
                  category: "unavailable",
                  retryClass: "manual",
                  title: "Synthetic effect did not succeed",
                }),
              }
            : {}),
        };
  return {
    effect_operation_id: effectOperationId,
    schema_version: 1,
    effect_kind: effectKind,
    request_version: 1,
    request: { message: "hello", count: 1 },
    state,
    lineage_context_ref: {
      schemaVersion: 1,
      sourceActivityId: createActivityId(),
      sourceInstanceId: createInstanceId(),
      sourceContinuityEpochId: createContinuityEpochId(),
    },
    dispatch_host_ownership_token: token,
    outcome,
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:01.000Z",
  };
}

describe("EffectOperation contract normalization", () => {
  function expectProblem(action: () => unknown, problemCode: string): void {
    let thrown: unknown;
    try {
      action();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ problem: { problemCode } });
  }

  it("detaches and freezes a canonical request without mutating the caller", () => {
    const request = { nested: { value: 1 }, list: ["a"] };
    const snapshot = snapshotEffectRequest(request);

    request.nested.value = 2;
    request.list.push("b");

    expect(snapshot.value).toEqual({ nested: { value: 1 }, list: ["a"] });
    expect(Object.isFrozen(snapshot.value)).toBe(true);
    expect(snapshot.canonical).toBe('{"list":["a"],"nested":{"value":1}}');
  });

  it("strictly parses the V1 row and enforces state-specific fields", () => {
    const operation = parseEffectOperationRow(row("SUCCEEDED"));

    expect(operation.state).toBe("SUCCEEDED");
    expect(operation.outcome?.status).toBe("SUCCEEDED");
    expect(operation.dispatchHostOwnershipToken).toBeDefined();
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(operation.request)).toBe(true);
  });

  it("rejects unsupported versions and inconsistent outcomes", () => {
    expectProblem(
      () => parseEffectOperationRow({ ...row(), schema_version: 2 }),
      "effect.schema.unsupported",
    );
    expectProblem(
      () =>
        parseEffectOperationRow({
          ...row("SUCCEEDED"),
          outcome: { schemaVersion: 1, status: "FAILED" },
        }),
      "effect.row.invalid",
    );
    expectProblem(
      () =>
        parseEffectOperationRow({
          ...row("PREPARED"),
          dispatch_host_ownership_token: createHostOwnershipToken(),
        }),
      "effect.row.invalid",
    );
  });

  it("rejects malformed identity, request, and lineage values", () => {
    expectProblem(
      () => parseEffectOperationRow({ ...row(), effect_operation_id: "not-a-uuid" }),
      "effect.row.invalid",
    );
    expectProblem(
      () => parseEffectOperationRow({ ...row(), request: { value: undefined } }),
      "effect.row.invalid",
    );
    expectProblem(
      () =>
        parseEffectOperationRow({
          ...row(),
          lineage_context_ref: { schemaVersion: 2 },
        }),
      "effect.row.invalid",
    );
  });
});
