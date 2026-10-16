// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Declares the native Channel through public SDK interfaces with one controlled message adapter.
 * @module channel
 */
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-plugin-common";
import type { ChannelMessageAdapterShape } from "openclaw/plugin-sdk/channel-message";
import { parseQqTarget, wholeDraftChunker } from "./delivery.js";
/** A single native account profile contains no secret file contents. */
export interface QqNativeAccount {
  readonly accountId: string;
  readonly configured: boolean;
  readonly enabled: boolean;
}
type StartAccount = NonNullable<
  NonNullable<ChannelPlugin<QqNativeAccount>["gateway"]>["startAccount"]
>;
/** Native lifecycle and message implementation are supplied by the composed service instance. */
export interface QqChannelOptions {
  readonly accountId: string;
  readonly maxTextBytes: number;
  readonly message: ChannelMessageAdapterShape;
  readonly startAccount: StartAccount;
}
/** Registers no raw API/tools or alternative sender; all effects use message.deliveryCustody/send. */
export function createQqChannel(
  options: QqChannelOptions,
): ChannelPlugin<QqNativeAccount> {
  return {
    id: "heptalogos-qq",
    meta: {
      id: "heptalogos-qq",
      label: "Heptalogos QQ",
      selectionLabel: "Heptalogos QQ (OneBot)",
      docsPath: "/channels/heptalogos-qq",
      blurb: "First-party Host-governed QQ channel",
      forceAccountBinding: true,
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      media: true,
      reply: true,
      threads: false,
      reactions: false,
      edit: false,
      unsend: false,
      groupManagement: false,
      blockStreaming: false,
    },
    config: {
      listAccountIds: () => [options.accountId],
      defaultAccountId: () => options.accountId,
      resolveAccount: (_cfg, accountId) => ({
        accountId: accountId ?? options.accountId,
        configured: !accountId || accountId === options.accountId,
        enabled: !accountId || accountId === options.accountId,
      }),
      isEnabled: (account) => account.enabled,
      isConfigured: (account) => account.configured,
      describeAccount: (account) => ({
        accountId: account.accountId,
        configured: account.configured,
        enabled: account.enabled,
      }),
    },
    outbound: {
      deliveryMode: "direct",
      extractMarkdownImages: false,
      chunkerMode: "text",
      textChunkLimit: options.maxTextBytes,
      chunker: (text) => wholeDraftChunker(text, options.maxTextBytes),
      resolveTarget: ({ to }) => {
        try {
          if (!to) throw Error("QQ target is required");
          parseQqTarget(to);
          return { ok: true, to };
        } catch {
          return {
            ok: false,
            error: Error("QQ target must use an explicit group: or direct: identity"),
          };
        }
      },
    },
    messaging: {
      targetIdComparison: "case-sensitive",
      normalizeTarget: (raw) => {
        try {
          parseQqTarget(raw);
          return raw;
        } catch {
          return undefined;
        }
      },
    },
    message: options.message,
    gateway: { startAccount: options.startAccount },
  };
}
