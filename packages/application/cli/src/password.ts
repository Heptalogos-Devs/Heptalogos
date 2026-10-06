// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Protected password input for interactive and deterministic CLI modes.
 * @module password
 */

import password from "@inquirer/password";

/** Reads one password from stdin while preserving all non-line-ending bytes. */
async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const value = Buffer.concat(chunks).toString("utf8");
  return value.replace(/(?:\r\n|\n|\r)$/u, "");
}

/** Uses the adopted Inquirer password prompt for protected TTY input. */
export async function readProtectedPassword(
  useStdin: boolean,
  message: string,
): Promise<string> {
  if (useStdin) return readPasswordFromStdin();
  return password({ message, mask: "*" });
}

/** Reads one protected JSON action body from stdin without exposing argv input. */
export async function readProtectedJsonFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) throw new Error("Protected JSON input is empty");
  try {
    return JSON.parse(text) as unknown;
  } finally {
    chunks.forEach((chunk) => chunk.fill(0));
  }
}
