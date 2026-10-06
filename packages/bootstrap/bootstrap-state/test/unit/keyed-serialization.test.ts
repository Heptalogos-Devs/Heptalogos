// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { KeyedAsyncSerializer } from "../../src/keyed-serialization.js";

describe("KeyedAsyncSerializer", () => {
  it("serializes operations per key while allowing different keys to proceed", async () => {
    const serializer = new KeyedAsyncSerializer();
    const events: string[] = [];
    let release: (() => void) | undefined;
    const first = serializer.run("same", async () => {
      events.push("first-start");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      events.push("first-end");
      return "first";
    });
    const second = serializer.run("same", async () => {
      events.push("second");
      return "second";
    });
    const other = serializer.run("other", async () => {
      events.push("other");
      return "other";
    });

    await other;
    expect(events).toEqual(["first-start", "other"]);
    release?.();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first-start", "other", "first-end", "second"]);
  });

  it("continues a queued key in FIFO order after a rejection", async () => {
    const serializer = new KeyedAsyncSerializer();
    const events: string[] = [];
    const rejected = serializer.run("key", async () => {
      events.push("rejected");
      throw new Error("expected");
    });
    const successor = serializer.run("key", async () => {
      events.push("successor");
      return "recovered";
    });

    await expect(rejected).rejects.toThrow("expected");
    await expect(successor).resolves.toBe("recovered");
    expect(events).toEqual(["rejected", "successor"]);
  });
});
