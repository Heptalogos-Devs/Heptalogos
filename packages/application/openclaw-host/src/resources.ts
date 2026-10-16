// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Completes bounded business work on Host-persisted media and source references.
 * @module resources
 */
import type { GatewayHostClient } from "@heptalogos/management-client/gateway";
import type { PluginRuntime } from "openclaw/plugin-sdk/channel-plugin-common";
import { openAsBlob } from "node:fs";
import { OneBotTransport } from "./transport.js";
import { acquireProtocolMedia, QqMediaError } from "./media.js";
import { readProtectedValue, readProtectedSegment } from "./source.js";
import { expandForwardReference } from "./forward.js";
import { createNativeEnvelope, type NativeEnvelope } from "./parser.js";
import { nativeId, record } from "./lossless.js";
import type { QqPluginConfig } from "./config.js";
/** Real native state supplies only byte accounting; canonical media/work records remain in Host. */
export interface QqResourceOptions {
  readonly host: GatewayHostClient;
  readonly transport: OneBotTransport;
  readonly config: QqPluginConfig;
  readonly accountId: string;
  readonly state: PluginRuntime["state"];
  readonly signal: AbortSignal;
  readonly acceptReply: (
    envelope: NativeEnvelope & { originalResponseRef: string },
  ) => Promise<string>;
  readonly onError: (code: string) => void;
}
/** One bounded pump follows persisted pending state; it creates no recorder or model observation. */
export function createQqResourcePump(options: QqResourceOptions): {
  request: () => void;
  stop: () => Promise<void>;
} {
  const usage = options.state.openKeyedStore<number>({
    namespace: "qq-media-budget-" + options.accountId,
    maxEntries: 2,
  });
  if (!usage.update) throw Error("Native atomic usage accounting is unavailable");
  let running: Promise<void> | undefined;
  let requested = false;
  const readArchive = async (reference: string) =>
    (await options.host.readArchive({ reference })).value;
  const archiveValue = async (value: unknown) =>
    (await options.host.archiveEnvelope({ kind: "segment", value })).reference;
  const reserve = async (bytes: number) => {
    const day = new Date().toISOString().slice(0, 10);
    for (const entry of await usage.entries())
      if (entry.key !== day) await usage.delete(entry.key);
    await usage.update!(day, (current) => {
      const next = (current ?? 0) + bytes;
      if (next > options.config.mediaDailyBytes)
        throw new QqMediaError("daily_byte_budget", false);
      return next;
    });
  };
  const pump = async () => {
    const current = await options.host.gatewayScope();
    if (current.accountId !== options.accountId)
      throw Error("QQ account binding changed");
    const fresh = (
      await options.host.pendingAttachments({
        limit: 32,
        states: ["pending", "acquiring"],
      })
    ).attachments;
    const retries = (
      await options.host.pendingAttachments({ limit: 8, states: ["failed"] })
    ).attachments.filter((item) => item.failure?.retryable);
    const pending = [...fresh, ...retries];
    let index = 0;
    await Promise.all(
      Array.from({ length: options.config.mediaConcurrency }, async () => {
        while (index < pending.length && !options.signal.aborted) {
          const attachment = pending[index++]!;
          let revision: number | undefined;
          let acquired: Awaited<ReturnType<typeof acquireProtocolMedia>> | undefined;
          try {
            const claiming =
              attachment.state === "acquiring"
                ? attachment
                : await options.host.updateAttachment({
                    attachmentId: attachment.attachmentId,
                    expectedRevision: attachment.revision,
                    state: "acquiring",
                  });
            revision = claiming.revision;
            if (attachment.source.kind !== "qq-native-segment")
              throw new QqMediaError("unsupported_native_source", false);
            const segment = await readProtectedSegment(
              attachment.source.reference,
              readArchive,
            );
            acquired = await acquireProtocolMedia(options.transport, segment, {
              tempRoot: options.config.mediaTempRoot,
              exportRoots: options.config.napcatExportRoots,
              maxBytes: options.config.mediaMaxBytes,
              timeoutMs: options.config.requestTimeoutMs,
              reserveBytes: reserve,
              allowFakeIpDns: options.config.mediaAllowFakeIpDns,
              signal: options.signal,
            });
            const cas = await options.host.uploadAttachment(
              await openAsBlob(acquired.path, { type: acquired.mediaType }),
              acquired.mediaType,
            );
            if (cas.sha256 !== acquired.sha256 || cas.bytes !== acquired.bytes)
              throw new QqMediaError("cas_integrity_mismatch", false);
            await options.host.updateAttachment({
              attachmentId: attachment.attachmentId,
              expectedRevision: revision,
              state: "available",
              cas,
            });
          } catch (error) {
            options.onError(
              error instanceof QqMediaError
                ? "media_" + error.code
                : "media_state_pending",
            );
            if (revision !== undefined)
              await options.host
                .updateAttachment({
                  attachmentId: attachment.attachmentId,
                  expectedRevision: revision,
                  state:
                    error instanceof QqMediaError && error.code === "expired"
                      ? "expired"
                      : "failed",
                  failure: {
                    code:
                      error instanceof QqMediaError
                        ? error.code
                        : "state_or_upload_unavailable",
                    retryable: !(error instanceof QqMediaError) || error.retryable,
                  },
                })
                .catch(() => {});
          } finally {
            await acquired?.dispose();
          }
        }
      }),
    );
    const references = (await options.host.pendingReferences({ limit: 8 })).references;
    for (const reference of references) {
      if (options.signal.aborted) break;
      try {
        if (reference.target.kind === "reply") {
          if (!reference.target.sourceRef) throw Error("Reply source is unavailable");
          const parentSource = reference.target.sourceRef.split("#/segments/")[0]!;
          const parent = record(await readProtectedValue(parentSource, readArchive));
          const response = await options.transport.readEnvelope(
            "get_msg",
            { message_id: reference.target.nativeId },
            options.signal,
          );
          const native = response.data;
          if (nativeId(native.message_id) !== reference.target.nativeId)
            throw Error("Reply target mismatch");
          const parentGroup = nativeId(parent.group_id);
          if (nativeId(native.group_id) && nativeId(native.group_id) !== parentGroup)
            throw Error("Reply conversation mismatch");
          const sender = record(native.sender);
          const authorId = nativeId(sender.user_id) ?? nativeId(native.user_id);
          if (!authorId) throw Error("Reply author is unavailable");
          const peer = nativeId(parent.target_id) ?? nativeId(parent.user_id);
          if (!parentGroup && authorId !== options.accountId && authorId !== peer)
            throw Error("Reply direct peer mismatch");
          const originalResponseRef = await archiveValue(response.raw);
          const normalized = {
            ...native,
            post_type: "message",
            self_id: options.accountId,
            user_id: authorId,
            ...(parentGroup ? { group_id: parentGroup } : {}),
            ...(!parentGroup && authorId === options.accountId
              ? { post_type: "message_sent", target_id: peer }
              : {}),
          };
          const resolvedMessageRef = await options.acceptReply({
            ...createNativeEnvelope(JSON.stringify(normalized)),
            originalResponseRef,
          });
          await options.host.updateReference({
            referenceId: reference.referenceId,
            expectedRevision: reference.revision,
            state: "available",
            resolvedMessageRef,
          });
          continue;
        }
        const result = await expandForwardReference(
          options.transport,
          reference,
          readArchive,
          archiveValue,
          {
            maxDepth: options.config.forwardMaxDepth,
            maxNodes: options.config.forwardMaxNodes,
            maxBytes: options.config.forwardMaxBytes,
            maxRequests: options.config.forwardMaxRequests,
          },
          options.signal,
        );
        await options.host.updateReference(result);
      } catch {
        options.onError("source_expansion_pending");
      }
    }
  };
  const request = () => {
    if (options.signal.aborted) return;
    requested = true;
    if (running) return;
    running = (async () => {
      while (requested && !options.signal.aborted) {
        requested = false;
        await pump().catch(() => options.onError("resource_pump_unavailable"));
      }
    })().finally(() => {
      running = undefined;
    });
  };
  const timer = setInterval(request, 30000);
  timer.unref();
  options.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
  return {
    request,
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}
