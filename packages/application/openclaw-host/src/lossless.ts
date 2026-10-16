// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Preserves OneBot numeric tokens before JavaScript floating-point conversion.
 * @module lossless
 */
/** Parses numeric JSON scalars as their original lexical strings on Node 24. */
export function parseOneBotJson(text: string): unknown {
  return JSON.parse(
    text,
    (_key: string, value: unknown, context?: { source?: string }) =>
      typeof value === "number" ? (context?.source ?? String(value)) : value,
  ) as unknown;
}
/** Reads a native identifier without ever coercing an imprecise number. */
export function nativeId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 2048
    ? value
    : undefined;
}
/** Narrows a JSON object without silently accepting arrays. */
export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Converts a bounded protocol control number, never an external identity. */
export function controlNumber(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}
