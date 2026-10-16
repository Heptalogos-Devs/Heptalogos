// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { createQqAccountRuntime } from "../../src/account-runtime.js";
it("shares one actual account across native registry instances, excluding duplicate startup and stale cleanup", () => {
  const root = "/isolated/qq-account-" + randomUUID();
  const active = createQqAccountRuntime<object>(root, "100"),
    discovery = createQqAccountRuntime<object>(root, "100"),
    other = createQqAccountRuntime<object>(root, "200");
  const ownership = active.acquire();
  expect(() => discovery.acquire()).toThrow("already owned");
  expect(() => discovery.adapter()).toThrow("has not started");
  const adapter = { physicalSender: "one actual account" };
  active.activate(ownership, adapter);
  expect(discovery.adapter()).toBe(adapter);
  expect(() => other.adapter()).toThrow("has not started");
  active.deactivate(ownership);
  expect(() => discovery.adapter()).toThrow("has not started");
  expect(() => discovery.acquire()).toThrow("already owned");
  active.release(ownership);
  const replacement = discovery.acquire();
  const next = { physicalSender: "next lifecycle after drain" };
  discovery.activate(replacement, next);
  active.release(ownership);
  expect(discovery.adapter()).toBe(next);
  discovery.release(replacement);
});
it("releases failed partial startup so the native supervisor can retry the same account", async () => {
  const root = "/isolated/qq-account-failure-" + randomUUID();
  const first = createQqAccountRuntime<object>(root, "100"),
    next = createQqAccountRuntime<object>(root, "100");
  const start = first.ownLifecycle(async () => {
    expect(() => next.acquire()).toThrow("already owned");
    throw Error("actual startup prerequisite unavailable");
  });
  await expect(start(undefined)).rejects.toThrow("startup prerequisite unavailable");
  const recovered = next.acquire();
  next.release(recovered);
});
