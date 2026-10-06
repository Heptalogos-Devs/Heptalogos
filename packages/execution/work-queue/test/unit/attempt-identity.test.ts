// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  asContentDigest,
  createWorkItemId,
  digestCanonicalJson,
} from "@heptalogos/foundation-contracts";
import {
  createDispatchAttemptId,
  dispatchAttemptIdToWorkflowId,
  parseDispatchAttemptId,
} from "../../src/index.js";

describe("WorkQueue dispatch-attempt identity", () => {
  it("derives the same attempt identity from the same WorkItem revision", () => {
    const workItemId = createWorkItemId();
    const first = createDispatchAttemptId(workItemId, 1);
    const second = createDispatchAttemptId(workItemId, 1);

    expect(first).toBe(second);
    expect(parseDispatchAttemptId(first)).toBe(first);
    expect(dispatchAttemptIdToWorkflowId(first)).toBe(`heptalogos.work.${first}`);
  });

  it("changes identity for a new revision and for a different digest domain", () => {
    const workItemId = createWorkItemId();
    const revisionOne = createDispatchAttemptId(workItemId, 1);
    const revisionTwo = createDispatchAttemptId(workItemId, 2);
    const differentDomain = asContentDigest(
      "DispatchAttemptId",
      digestCanonicalJson("heptalogos/other-domain/v1", {
        workItemId,
        dispatchRevision: 1,
      }),
    );

    expect(revisionTwo).not.toBe(revisionOne);
    expect(differentDomain).not.toBe(revisionOne);
    expect(parseDispatchAttemptId("not-a-digest")).toBeUndefined();
  });

  it("rejects invalid revisions", () => {
    const workItemId = createWorkItemId();

    expect(() => createDispatchAttemptId(workItemId, 0)).toThrowError(
      "dispatchRevision",
    );
    expect(() => createDispatchAttemptId(workItemId, 1.5)).toThrowError(
      "dispatchRevision",
    );
    expect(() =>
      createDispatchAttemptId(workItemId, Number.MAX_SAFE_INTEGER + 1),
    ).toThrowError("dispatchRevision");
  });
});
