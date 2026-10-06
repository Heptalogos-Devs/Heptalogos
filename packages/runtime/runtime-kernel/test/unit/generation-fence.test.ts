// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { GenerationFence } from "../../src/generation/generation-fence.js";

describe("GenerationFence invocation reservations", () => {
  it("reserves an active invocation before the call starts", () => {
    const fence = new GenerationFence();

    const reservation = fence.reserve("operation");

    expect(fence.activeInvocationCount).toBe(1);
    reservation.release();
  });

  it("keeps retirement open for a reservation and rejects later reservations", async () => {
    const fence = new GenerationFence();
    const reservation = fence.reserve("operation");

    fence.beginRetirement();
    expect(() => fence.reserve("later")).toThrow();
    const retirement = fence.retire(0);
    await Promise.resolve();
    expect(fence.state).toBe("RETIRING");

    reservation.release();
    await retirement;
    expect(fence.state).toBe("RETIRED");
  });

  it("releases an unused reservation and allows retirement to settle", async () => {
    const fence = new GenerationFence();
    const reservation = fence.reserve("operation");

    reservation.release();
    reservation.release();

    expect(fence.activeInvocationCount).toBe(0);
    await fence.retire(0);
    expect(fence.state).toBe("RETIRED");
  });

  it("runs an already reserved call after retirement begins", async () => {
    const fence = new GenerationFence();
    const reservation = fence.reserve("operation");
    fence.beginRetirement();

    await expect(reservation.run(async () => "settled")).resolves.toBe("settled");
    await fence.retire(0);
    expect(fence.state).toBe("RETIRED");
  });

  it("allows exactly one run and fails closed after settlement", () => {
    const fence = new GenerationFence();
    const reservation = fence.reserve("operation");

    expect(reservation.run(() => "settled")).toBe("settled");
    expect(() => reservation.run(() => "again")).toThrow();
    expect(() => reservation.release()).not.toThrow();
    expect(fence.activeInvocationCount).toBe(0);
  });

  it("preserves direct invoke admission through the same counter", async () => {
    const fence = new GenerationFence();

    await expect(fence.invoke("operation", async () => "settled")).resolves.toBe(
      "settled",
    );
    expect(fence.activeInvocationCount).toBe(0);
  });
});
