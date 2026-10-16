// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Enforces Host-issued QQ scope again at the native adapter boundary.
 * @module policy
 */
/** Exact recipient identity used by receive filtering and every effect path. */
export interface QqTarget {
  readonly kind: "group" | "direct";
  readonly id: string;
}
/** A safe policy error carries neither credentials nor message bodies. */
class QqPolicyError extends Error {
  /** Creates this adapter boundary with explicitly supplied validated operational state. */
  constructor() {
    super("QQ effect is outside the Host-authorized conversation scope");
    this.name = "QqPolicyError";
  }
}
function targetKey(target: QqTarget): string {
  return `${target.kind}:${target.id}`;
}
/** Local immutable projection of trusted Host authorization, never ordinary plugin configuration. */
export class QqScopePolicy {
  /** Creates this adapter boundary with explicitly supplied validated operational state. */
  constructor(
    private readonly receive: ReadonlySet<string>,
    private readonly send: ReadonlySet<string>,
  ) {}
  /** Filters unauthorized conversations before native durable admission. */
  canReceive(target: QqTarget): boolean {
    return this.receive.has(targetKey(target));
  }
  /** Rejects observation-only and ungranted recipients before any native effect call. */
  assertCanSend(target: QqTarget): void {
    if (!this.receive.has(targetKey(target)) || !this.send.has(targetKey(target)))
      throw new QqPolicyError();
  }
}
/** Derives isolated native DM/group session lanes from exact account and peer keys. */
export function qqConversationLane(accountId: string, target: QqTarget): string {
  return `qq:${encodeURIComponent(accountId)}:${target.kind}:${encodeURIComponent(target.id)}`;
}
