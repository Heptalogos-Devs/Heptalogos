// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Verifies actual QQ login and current send capability independently of WebSocket state.
 * @module presence
 */
import { OneBotTransport, OneBotTransportError } from "./transport.js";
import { controlNumber, nativeId, parseOneBotJson, record } from "./lossless.js";
import { QqScopePolicy, type QqTarget } from "./policy.js";
/** Public status contains operational facts and no protocol credentials. */
export interface QqPresence {
  readonly connected: boolean;
  readonly online: boolean;
  readonly accountMatches: boolean;
  readonly protocolVersion?: string;
}
/** Keeps only factual current ban observations; it grants no moderation action. */
export class OneBotPresence {
  private connected = false;
  private readonly bannedUntil = new Map<string, number>();
  private readonly wholeBan = new Set<string>();
  /** Creates this adapter boundary with explicitly supplied validated operational state. */
  constructor(
    private readonly transport: OneBotTransport,
    private readonly expectedAccountId: string,
    private readonly scope: QqScopePolicy,
  ) {}
  /** Marks only transport connection state; login remains independently probed. */
  setConnected(connected: boolean): void {
    this.connected = connected;
  }
  /** Reads actual OneBot login/status/version instead of equating an open socket with QQ login. */
  async probe(signal?: AbortSignal): Promise<QqPresence> {
    if (!this.connected)
      return { connected: false, online: false, accountMatches: false };
    const [login, status, version] = await Promise.all([
      this.transport.read("get_login_info", {}, signal),
      this.transport.read("get_status", {}, signal),
      this.transport.read("get_version_info", {}, signal),
    ]);
    const accountMatches = nativeId(login.user_id) === this.expectedAccountId;
    return {
      connected: true,
      online: accountMatches && status.online === true && status.good !== false,
      accountMatches,
      ...(typeof version.app_version === "string"
        ? { protocolVersion: version.app_version }
        : {}),
    };
  }
  /** Preserves observed account/group mute facts before any later send check. */
  observe(raw: string): void {
    const event = record(parseOneBotJson(raw));
    if (
      nativeId(event.self_id) !== this.expectedAccountId ||
      event.notice_type !== "group_ban"
    )
      return;
    const group = nativeId(event.group_id),
      user = nativeId(event.user_id);
    if (!group || !user || !this.scope.canReceive({ kind: "group", id: group })) return;
    const duration = controlNumber(event.duration) ?? 0;
    if (user === "0") {
      if (duration > 0) this.wholeBan.add(group);
      else this.wholeBan.delete(group);
    } else if (user === this.expectedAccountId) {
      if (duration > 0) this.bannedUntil.set(group, Date.now() + duration * 1000);
      else this.bannedUntil.delete(group);
    }
  }
  /** Rechecks exact recipient grant, login, membership and known mute state before effect authorization. */
  async assertSendAvailable(target: QqTarget, signal?: AbortSignal): Promise<void> {
    this.scope.assertCanSend(target);
    const status = await this.probe(signal);
    if (!status.online) throw new OneBotTransportError("not_connected", false);
    if (target.kind === "group") {
      const member = await this.transport.read(
        "get_group_member_info",
        { group_id: target.id, user_id: this.expectedAccountId, no_cache: true },
        signal,
      );
      if (nativeId(member.user_id) !== this.expectedAccountId)
        throw new OneBotTransportError("rejected", false);
      const until = controlNumber(member.shut_up_timestamp);
      const muted =
        (this.bannedUntil.get(target.id) ?? 0) > Date.now() ||
        (until !== undefined && until * 1000 > Date.now());
      const privileged = member.role === "admin" || member.role === "owner";
      if (muted || (this.wholeBan.has(target.id) && !privileged))
        throw new OneBotTransportError("rejected", false);
    }
  }
}
