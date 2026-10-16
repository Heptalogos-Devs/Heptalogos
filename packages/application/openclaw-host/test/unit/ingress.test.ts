// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nativeQueue } from "../support/native.js";
import { createQqIngress } from "../../src/ingress.js";
import { createNativeEnvelope } from "../../src/parser.js";
import { QqScopePolicy } from "../../src/policy.js";
it("uses the installed native SQLite ingress queue and completes only after Host acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-native-ingress-isolated-"));
  const queue = await nativeQueue(root);
  const controller = new AbortController();
  let committed = 0;
  let started = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scope = new QqScopePolicy(
    new Set(["group:1101497265"]),
    new Set(["group:1101497265"]),
  );
  const monitor = createQqIngress({
    queue,
    accountId: "3644596926",
    scope,
    signal: controller.signal,
    onError: () => {},
    commit: async () => {
      started = true;
      await gate;
      committed++;
    },
  });
  monitor.start();
  try {
    const raw =
      '{"self_id":3644596926,"post_type":"message","group_id":1101497265,"user_id":2162371684,"message_id":900719925474099312345,"message":[{"type":"text","data":{"text":"isolated fixture"}}]}';
    const first = await monitor.admit(createNativeEnvelope(raw));
    expect(first.kind).toBe("durable");
    const end = Date.now() + 5000;
    while (!started) {
      if (Date.now() > end) throw Error("native fixture did not claim");
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await queue.listClaims()).length).toBe(1);
    expect(committed).toBe(0);
    release();
    await monitor.waitForIdle();
    expect(committed).toBe(1);
    const replay = await monitor.admit(createNativeEnvelope(raw));
    expect(replay.kind).toBe("durable");
    if (replay.kind === "durable") expect(replay.queueResult.kind).toBe("completed");
    expect(
      (
        await monitor.admit(
          createNativeEnvelope(raw.replace("1101497265", "9999999999")),
        )
      ).kind,
    ).toBe("ignored");
    expect((await queue.listPending()).length).toBe(0);
    expect(committed).toBe(1);
  } finally {
    release();
    controller.abort();
    await monitor.stop();
    await rm(root, { recursive: true, force: true });
  }
});
