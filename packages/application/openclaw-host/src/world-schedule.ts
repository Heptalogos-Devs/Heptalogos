#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Projects the next real due point through the public native cron command API.
 * @module world-schedule
 */
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import { fileURLToPath } from "node:url";
import { validateWorldWake } from "./world-wake.js";
try {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 32768) throw Error("schedule_input_limit");
  }
  const input = JSON.parse(text) as { realAt: string | null; wake: unknown };
  const wake = validateWorldWake(input.wake);
  if (
    input.realAt !== null &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(input.realAt) ||
      !Number.isFinite(Date.parse(input.realAt)))
  )
    throw Error("invalid_real_due_point");
  const declarationKey = `heptalogos-life:${wake.request.subjectId}`;
  if (input.realAt === null) {
    const listing = (await callGatewayFromCli(
      "cron.list",
      { json: true, timeout: "30000" },
      {
        includeDisabled: true,
        query: `Heptalogos life ${wake.request.subjectId}`,
        limit: 200,
      },
      { progress: false },
    )) as { jobs?: { id: string; declarationKey?: string }[] };
    const existing = listing.jobs?.find((job) => job.declarationKey === declarationKey);
    if (existing)
      await callGatewayFromCli(
        "cron.update",
        { json: true, timeout: "30000" },
        { id: existing.id, patch: { enabled: false } },
        { progress: false },
      );
    process.stdout.write('{"status":"disabled"}\n');
  } else {
    const result = await callGatewayFromCli(
      "cron.add",
      { json: true, timeout: "30000" },
      {
        name: `Heptalogos life ${wake.request.subjectId}`,
        declarationKey,
        enabled: true,
        deleteAfterRun: false,
        schedule: { kind: "at", at: input.realAt },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "command",
          argv: [
            process.execPath,
            fileURLToPath(new URL("./world-wake-cli.js", import.meta.url)),
          ],
          input: JSON.stringify(wake),
          timeoutSeconds: 620,
          outputMaxBytes: 4096,
        },
        delivery: { mode: "none" },
        failureAlert: false,
      },
      { progress: false },
    );
    process.stdout.write(JSON.stringify({ status: "scheduled", result }) + "\n");
  }
} catch {
  process.stdout.write('{"status":"failed","code":"world_schedule_failed"}\n');
  process.exitCode = 1;
}
