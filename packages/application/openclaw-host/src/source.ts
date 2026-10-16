// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolves protected native source fragments without exposing archive access to model tools.
 * @module source
 */
import { nativeSegments } from "./parser.js";
import { parseOneBotJson, record } from "./lossless.js";
function parsed(value: unknown): unknown {
  const decoded = typeof value === "string" ? parseOneBotJson(value) : value;
  const wrapper = record(decoded);
  return wrapper.format === "qq-history-event-v1" && typeof wrapper.event === "string"
    ? parseOneBotJson(wrapper.event)
    : decoded;
}
/** Reads a protected raw value and an optional JSON-pointer fragment through the Host archive owner. */
export async function readProtectedValue(
  reference: string,
  readArchive: (reference: string) => Promise<unknown>,
): Promise<unknown> {
  const split = reference.indexOf("#");
  const base = split < 0 ? reference : reference.slice(0, split);
  const fragment = split < 0 ? "" : reference.slice(split + 1);
  let value = parsed(await readArchive(base));
  if (fragment) {
    if (!fragment.startsWith("/")) throw Error("Unsupported protected source fragment");
    for (const key of fragment.slice(1).split("/")) {
      const decoded = key.replaceAll("~1", "/").replaceAll("~0", "~");
      if (typeof value !== "object" || value === null)
        throw Error("Protected source is unavailable");
      value = (value as Record<string, unknown>)[decoded];
    }
  }
  return value;
}
/** Resolves the one adopted native segment, including CQ-string segments, from its protected source. */
export async function readProtectedSegment(
  reference: string,
  readArchive: (reference: string) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const marker = "#/segments/";
  const split = reference.lastIndexOf(marker);
  if (split < 0) throw Error("Protected segment reference is invalid");
  const ordinal = Number(reference.slice(split + marker.length));
  if (!Number.isSafeInteger(ordinal) || ordinal < 0)
    throw Error("Protected segment ordinal is invalid");
  const value = await readProtectedValue(reference.slice(0, split), readArchive);
  const node = record(value);
  const segments = nativeSegments(
    Array.isArray(value) ? value : (node.message ?? node.content ?? node.messages),
  );
  const segment = segments[ordinal];
  if (!segment) throw Error("Protected segment is unavailable");
  return segment;
}
