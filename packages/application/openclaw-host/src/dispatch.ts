#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Invokes the public native agent RPC once for a Host-registered input.
 * @module dispatch
 */
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";

const maximumInputBytes = 4 * 1024 * 1024;
async function readParameters(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += value.length;
    if (bytes > maximumInputBytes) throw Error("dispatch_input_limit");
    chunks.push(value);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof value !== "object" || !value || Array.isArray(value))
    throw Error("dispatch_input_invalid");
  const params = value as Record<string, unknown>;
  for (const field of ["idempotencyKey", "sessionKey", "message"])
    if (typeof params[field] !== "string" || !params[field])
      throw Error("dispatch_input_invalid");
  if (
    !Number.isInteger(params.timeout) ||
    Number(params.timeout) < 1 ||
    Number(params.timeout) > 3600
  )
    throw Error("dispatch_timeout_invalid");
  return params;
}
try {
  if (process.argv.length !== 2) throw Error("dispatch_arguments_rejected");
  const params = await readParameters();
  const { waitForFinal, ...nativeParams } = params;
  if (waitForFinal !== undefined && typeof waitForFinal !== "boolean")
    throw Error("dispatch_wait_invalid");
  const expectFinal = waitForFinal !== false;
  const result = await callGatewayFromCli(
    "agent",
    {
      expectFinal,
      timeout: String(Number(params.timeout) * 1000 + 30_000),
      json: true,
    },
    nativeParams,
    { expectFinal, progress: false },
  );
  process.stdout.write(
    JSON.stringify({ status: expectFinal ? "terminal" : "accepted", result }) + "\n",
  );
} catch {
  // RPC failures can be uncertain after submission; the Host reconciles the registered run.
  process.stdout.write(
    JSON.stringify({ status: "unresolved", code: "native_dispatch_failed" }) + "\n",
  );
  process.exitCode = 1;
}
