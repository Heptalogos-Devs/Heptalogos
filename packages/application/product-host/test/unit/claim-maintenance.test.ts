// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { FirstClaimMaterial } from "@heptalogos/management";
import {
  startFirstClaimMaintenance,
  type ClaimMaintenanceClock,
} from "../../src/claim-maintenance.js";

class ControlledClock implements ClaimMaintenanceClock {
  private nowValue = Date.parse("2026-09-03T00:00:00.000Z");
  private task:
    { readonly token: object; readonly at: number; callback: () => void } | undefined;

  now(): number {
    return this.nowValue;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const token = {};
    this.task = { token, at: this.nowValue + delayMs, callback };
    return token;
  }

  clearTimeout(token: unknown): void {
    if (this.task?.token === token) this.task = undefined;
  }

  pending(): boolean {
    return this.task !== undefined;
  }

  async advance(milliseconds: number): Promise<void> {
    this.nowValue += milliseconds;
    while (this.task !== undefined && this.task.at <= this.nowValue) {
      const callback = this.task.callback;
      this.task = undefined;
      callback();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

function claim(id: string, expiresAt: string): FirstClaimMaterial {
  return {
    claimId: id as FirstClaimMaterial["claimId"],
    claimSecret: id.padEnd(43, "x"),
    expiresAt: expiresAt as FirstClaimMaterial["expiresAt"],
  };
}

describe("first-claim maintenance", () => {
  it("rotates an expired claim, retries once after failure, and stops after claim", async () => {
    const clock = new ControlledClock();
    const first = claim("a", "2026-09-03T00:00:01.000Z");
    const second = claim("b", "2026-09-03T00:00:10.000Z");
    const published: FirstClaimMaterial[] = [];
    let ensureCalls = 0;
    let removals = 0;
    const maintenance = await startFirstClaimMaintenance({
      clock,
      readLocalClaim: async () => undefined,
      ensureClaim: async () => {
        ensureCalls += 1;
        if (ensureCalls === 1) return first;
        if (ensureCalls === 2) throw new Error("provider unavailable");
        return second;
      },
      publishClaim: async (value) => {
        published.push(value);
      },
      removeClaim: async () => {
        removals += 1;
      },
    });

    expect(published).toEqual([first]);
    await clock.advance(1_000);
    expect(published).toEqual([first]);
    expect(clock.pending()).toBe(true);
    await clock.advance(5_000);
    expect(published).toEqual([first, second]);

    await maintenance.administratorClaimed();
    expect(removals).toBe(1);
    expect(clock.pending()).toBe(false);
    await clock.advance(60_000);
    expect(ensureCalls).toBe(3);
  });

  it("cancels the one local timer on Host close", async () => {
    const clock = new ControlledClock();
    const maintenance = await startFirstClaimMaintenance({
      clock,
      readLocalClaim: async () => undefined,
      ensureClaim: async () => claim("a", "2026-09-03T00:00:01.000Z"),
      publishClaim: async () => undefined,
      removeClaim: async () => undefined,
    });
    expect(clock.pending()).toBe(true);
    maintenance.close();
    expect(clock.pending()).toBe(false);
  });
});
