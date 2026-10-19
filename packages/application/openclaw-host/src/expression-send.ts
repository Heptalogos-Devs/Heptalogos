#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Continues an adopted retained expression through the installed native RPC.
 * @module expression-send
 */
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
try {
  if (process.argv.length !== 2) throw Error("expression_send_arguments_rejected");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const data = Buffer.from(chunk);
    bytes += data.length;
    if (bytes > 4096) throw Error("expression_send_input_limit");
    chunks.push(data);
  }
  const params = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    !params ||
    Object.keys(params).some((key) => !["subjectId", "briefId"].includes(key)) ||
    ![params.subjectId, params.briefId].every(
      (value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value),
    )
  )
    throw Error("expression_send_selection_invalid");
  const result = await callGatewayFromCli(
    "heptalogos.expression.send",
    { json: true, timeout: "60000" },
    params,
    { progress: false },
  );
  process.stdout.write(JSON.stringify({ status: "delivery", result }) + "\n");
} catch {
  process.stdout.write('{"status":"unavailable"}\n');
  process.exitCode = 1;
}
