// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Expands nested forward trees with protected resumable source state and bounded protocol work.
 * @module forward
 */
import type { MessageReference, UpdateReferenceInput } from "@heptalogos/messaging";
import { OneBotTransport } from "./transport.js";
import { nativeId, controlNumber, parseOneBotJson, record } from "./lossless.js";
import { nativeSegments, parseMessageParts } from "./parser.js";
import { readProtectedSegment } from "./source.js";
/** Each expansion call has independent resource ceilings; persisted facts remain immutable. */
export interface ForwardBudget {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxBytes: number;
  readonly maxRequests: number;
}
interface Work {
  path: string;
  parentPath: string | null;
  depth: number;
  sourceRef?: string;
  node?: unknown;
  nativeForwardId?: string;
  ancestors: string[];
}
interface Continuation {
  format: "qq-forward-continuation-v1";
  queue: Work[];
}
/** Fetches external nested references only through this account's bounded protocol connection. */
export async function expandForwardReference(
  transport: OneBotTransport,
  reference: MessageReference,
  readArchive: (reference: string) => Promise<unknown>,
  archiveValue: (value: unknown) => Promise<string>,
  budget: ForwardBudget,
  signal?: AbortSignal,
): Promise<UpdateReferenceInput> {
  const base = {
    referenceId: reference.referenceId,
    expectedRevision: reference.revision,
  };
  if (reference.target.kind !== "forward")
    throw Error("Reply references require canonical parent acceptance");
  let queue: Work[] = [];
  if (reference.continuation) {
    const saved = record(await readArchive(reference.continuation));
    if (saved.format !== "qq-forward-continuation-v1" || !Array.isArray(saved.queue))
      throw Error("Protected forward continuation is invalid");
    queue = (saved as unknown as Continuation).queue;
  } else {
    let nodes: unknown[] | undefined;
    if (reference.target.sourceRef) {
      const segment = await readProtectedSegment(
        reference.target.sourceRef,
        readArchive,
      ).catch(() => undefined);
      const data = record(segment?.data);
      const inline = data.content ?? data.messages ?? segment?.content;
      if (Array.isArray(inline)) nodes = inline;
      else if (typeof inline === "string") {
        try {
          const parsed = parseOneBotJson(inline);
          if (Array.isArray(parsed)) nodes = parsed;
        } catch {}
      }
    }
    if (nodes) {
      const source = await archiveValue({
        originalSourceRef: reference.target.sourceRef,
        nodes,
      });
      queue = nodes.map((node, index) => ({
        node,
        path: String(index),
        parentPath: null,
        depth: 0,
        sourceRef: `${source}#/nodes/${index}`,
        ancestors: [],
      }));
    } else
      queue = [
        {
          path: "",
          parentPath: null,
          depth: 0,
          nativeForwardId: reference.target.nativeId,
          ancestors: [],
        },
      ];
  }
  const output: NonNullable<UpdateReferenceInput["nodes"]> = [];
  const existing = new Set(reference.nodes?.map((node) => node.path));
  let bytes = 0,
    requests = 0;
  let reason: string | undefined;
  while (queue.length) {
    signal?.throwIfAborted();
    const next = queue[0]!;
    if (next.depth > budget.maxDepth) {
      reason = "depth_budget";
      break;
    }
    if (next.nativeForwardId) {
      if (requests >= budget.maxRequests) {
        reason = "request_budget";
        break;
      }
      if (next.ancestors.includes(next.nativeForwardId)) {
        reason = "native_forward_cycle";
        break;
      }
      requests++;
      let response;
      try {
        response = await transport.readEnvelope(
          "get_forward_msg",
          { message_id: next.nativeForwardId },
          signal,
        );
      } catch {
        reason = "native_forward_unavailable";
        break;
      }
      const nodes = response.data.messages ?? response.data.content;
      if (!Array.isArray(nodes)) {
        reason = "native_forward_structure_unavailable";
        break;
      }
      const rawSource = await archiveValue(response.raw);
      const source = await archiveValue({ originalSourceRef: rawSource, nodes });
      queue.shift();
      queue.unshift(
        ...nodes.map((node, index) => ({
          node,
          path: next.path ? `${next.path}/${index}` : String(index),
          parentPath: next.parentPath,
          depth: next.depth,
          sourceRef: `${source}#/nodes/${index}`,
          ancestors: [...next.ancestors, next.nativeForwardId!],
        })),
      );
      continue;
    }
    if (
      output.length >= budget.maxNodes ||
      (reference.nodes?.length ?? 0) + output.length >= 4096
    ) {
      reason = "node_budget";
      break;
    }
    const size = Buffer.byteLength(JSON.stringify(next.node));
    if (bytes + size > budget.maxBytes) {
      reason = "byte_budget";
      break;
    }
    bytes += size;
    queue.shift();
    const raw = record(next.node),
      sender = record(raw.sender);
    const content = raw.content ?? raw.message;
    const seconds = controlNumber(raw.time);
    const date = seconds === undefined ? undefined : new Date(seconds * 1000);
    const author =
      nativeId(sender.user_id) ?? nativeId(raw.user_id) ?? nativeId(raw.uin);
    if (!existing.has(next.path))
      output.push({
        path: next.path,
        parentPath: next.parentPath,
        sourceRef: next.sourceRef,
        ...(author
          ? {
              claimedAuthor: {
                accountId: author,
                ...(typeof sender.nickname === "string"
                  ? { displayName: sender.nickname }
                  : typeof raw.name === "string"
                    ? { displayName: raw.name }
                    : {}),
              },
            }
          : {}),
        platformSentAt:
          date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
        parts: parseMessageParts(content, next.sourceRef!).parts,
      });
    const children: Work[] = [];
    for (const [index, segment] of nativeSegments(content).entries()) {
      if (segment.type !== "forward" && segment.type !== "node") continue;
      const data = record(segment.data);
      const nested = data.content ?? data.messages ?? segment.content;
      const path = `${next.path}/${index}`;
      if (Array.isArray(nested)) {
        const source = await archiveValue({
          originalSourceRef: next.sourceRef,
          nodes: nested,
        });
        children.push(
          ...nested.map((node, childIndex) => ({
            node,
            path: `${path}/${childIndex}`,
            parentPath: next.path,
            depth: next.depth + 1,
            sourceRef: `${source}#/nodes/${childIndex}`,
            ancestors: next.ancestors,
          })),
        );
      } else if (nativeId(data.id))
        children.push({
          path,
          parentPath: next.path,
          depth: next.depth + 1,
          nativeForwardId: nativeId(data.id),
          ancestors: next.ancestors,
        });
    }
    queue.unshift(...children);
  }
  if (!queue.length) return { ...base, state: "available", nodes: output };
  const continuation = await archiveValue({
    format: "qq-forward-continuation-v1",
    queue,
  } satisfies Continuation);
  return {
    ...base,
    state: "partial",
    nodes: output,
    reason: reason ?? "bounded_expansion",
    continuation,
  };
}
