#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Reads the installed native catalog or channel state through public SDK RPC.
 * @module gateway-read
 */
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
try {
  if (process.argv.length !== 2) throw Error("read_arguments_rejected");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const data = Buffer.from(chunk);
    bytes += data.length;
    if (bytes > 8192) throw Error("read_input_limit");
    chunks.push(data);
  }
  const { method, params } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    method !== "agents.list" &&
    method !== "channels.status" &&
    method !== "nous.provider-attempts"
  )
    throw Error("read_method_rejected");
  const result: unknown = await callGatewayFromCli(
    method,
    { json: true, timeout: "5000" },
    method === "channels.status"
      ? { probe: false }
      : method === "nous.provider-attempts"
        ? params
        : {},
    { progress: false },
  );
  process.stdout.write(JSON.stringify({ status: "read", result }) + "\n");
} catch {
  process.stdout.write('{"status":"unavailable"}\n');
  process.exitCode = 1;
}
