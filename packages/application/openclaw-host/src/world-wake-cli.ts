#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installed deterministic command entry; secret contents never appear in argv or output.
 * @module world-wake-cli
 */
import { wakeWorld } from "./world-wake.js";
try {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (Buffer.byteLength(input) > 16384) throw Error("wake_input_limit");
  }
  process.stdout.write(JSON.stringify(await wakeWorld(JSON.parse(input))) + "\n");
} catch {
  process.stdout.write('{"status":"failed","code":"world_wake_failed"}\n');
  process.exitCode = 1;
}
