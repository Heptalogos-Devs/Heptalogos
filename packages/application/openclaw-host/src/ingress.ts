// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Uses OpenClaw's single durable ingress queue and completes only after Host fact acceptance.
 * @module ingress
 */
import {
  createChannelIngressMonitor,
  type ChannelIngressQueue,
} from "openclaw/plugin-sdk/channel-message";
import { inspectNativeEnvelope, type NativeEnvelope } from "./parser.js";
import { QqScopePolicy } from "./policy.js";
/** Native queue and real Host commit callbacks supplied by the composed Channel instance. */
export interface QqIngressOptions {
  readonly queue: ChannelIngressQueue<string>;
  readonly accountId: string;
  readonly scope: QqScopePolicy;
  readonly commit: (envelope: NativeEnvelope) => Promise<void>;
  readonly signal: AbortSignal;
  readonly onError: (code: string) => void;
}
/** Creates no recorder: the native durable queue owns admission, claims and replay. */
export function createQqIngress(
  options: QqIngressOptions,
): ReturnType<typeof createChannelIngressMonitor<NativeEnvelope, string, string>> {
  return createChannelIngressMonitor<NativeEnvelope, string, string>({
    queue: options.queue,
    inspect: (envelope) => {
      try {
        const parsed = inspectNativeEnvelope(
          envelope,
          options.accountId,
          options.scope,
        );
        return parsed ? { eventId: parsed.eventId, laneKey: parsed.laneKey } : null;
      } catch {
        options.onError("native_event_invalid");
        return null;
      }
    },
    payload: {
      version: 1,
      storage: "raw-event",
      serialize: (envelope) => JSON.stringify(envelope),
      deserialize: (body) => JSON.parse(body) as NativeEnvelope,
      createClaimError: () => new Error("QQ native ingress payload is invalid"),
    },
    deliver: async (envelope, lifecycle) => {
      await options.commit(envelope);
      await lifecycle.onAdopted();
      return { kind: "completed" };
    },
    pollIntervalMs: 250,
    retention: "standard",
    appendRetryDelaysMs: [50, 250, 1000],
    abortSignal: options.signal,
    waitForDeliveryIdleOnStop: true,
    admissionMode: "while-running",
    onError: () => options.onError("native_ingress_failed"),
  });
}
