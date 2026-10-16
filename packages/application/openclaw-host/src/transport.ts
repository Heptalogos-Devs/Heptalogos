// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns OneBot forward-WebSocket correlation, reconnect and honest network outcomes.
 * @module transport
 */
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseOneBotJson, record } from "./lossless.js";
import { QqScopePolicy } from "./policy.js";

/** Safe transport outcomes distinguish pre-send failure from ambiguous external effects. */
export class OneBotTransportError extends Error {
  /** Creates this adapter boundary with explicitly supplied validated operational state. */
  constructor(
    readonly code:
      | "not_connected"
      | "timeout"
      | "disconnected"
      | "aborted"
      | "rejected"
      | "invalid_response",
    readonly uncertain: boolean,
  ) {
    super(`OneBot ${code}`);
    this.name = "OneBotTransportError";
  }
}
/** Transport settings contain private credentials and must never be logged. */
export interface OneBotTransportOptions {
  readonly endpoint: string;
  readonly scope: QqScopePolicy;
  readonly accessToken?: string;
  readonly requestTimeoutMs: number;
  readonly reconnectMinMs: number;
  readonly reconnectMaxMs: number;
  readonly onEvent: (envelope: string) => Promise<void>;
  readonly onConnection?: (connected: boolean) => void;
  readonly onError: (code: string) => void;
  readonly signal: AbortSignal;
}
/** Exact protocol response plus its lossless control/data projection. */
export interface OneBotResponse {
  readonly raw: string;
  readonly data: Record<string, unknown>;
}
interface Pending {
  readonly generation: number;
  readonly effect: boolean;
  readonly resolve: (value: OneBotResponse) => void;
  readonly reject: (error: OneBotTransportError) => void;
}
const readActions = new Set([
  "get_login_info",
  "get_status",
  "get_version_info",
  "get_group_msg_history",
  "get_friend_msg_history",
  "get_msg",
  "get_forward_msg",
  "get_image",
  "get_record",
  "get_file",
  "get_group_file_url",
  "get_private_file_url",
  "get_group_member_info",
  "get_group_info",
]);
/** One process-owned session; no request or effect is automatically replayed on reconnect. */
export class OneBotTransport {
  private socket?: WebSocket;
  private readonly lifetime = new AbortController();
  private readonly signal: AbortSignal;
  private generation = 0;
  private readonly pending = new Map<string, Pending>();
  private readonly acceptedWrites = new Set<Promise<void>>();
  private task?: Promise<void>;
  /** Creates this adapter boundary with explicitly supplied validated operational state. */
  constructor(private readonly options: OneBotTransportOptions) {
    this.signal = AbortSignal.any([options.signal, this.lifetime.signal]);
    const endpoint = new URL(options.endpoint);
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      !["ws:", "wss:"].includes(endpoint.protocol)
    )
      throw new Error("OneBot endpoint must not contain credentials or query tokens");
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) &&
      (endpoint.protocol !== "wss:" || !options.accessToken)
    )
      throw new Error(
        "Remote OneBot requires an authenticated encrypted private endpoint",
      );
    if (
      options.requestTimeoutMs < 1 ||
      options.reconnectMinMs < 1 ||
      options.reconnectMaxMs < options.reconnectMinMs
    )
      throw new Error("OneBot timing budgets are invalid");
  }
  /** Starts continuous bounded-backoff connection opportunities until explicit abort. */
  start(): void {
    if (!this.task) this.task = this.connectLoop();
  }
  /** Waits for transport shutdown and all already-admitted durable ingress writes. */
  async stop(): Promise<void> {
    this.lifetime.abort();
    this.socket?.terminate();
    await this.task;
    await Promise.allSettled([...this.acceptedWrites]);
  }
  /** Executes only the adapter's allowlisted read operations. */
  read(
    action: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!readActions.has(action))
      return Promise.reject(new Error("Unsupported OneBot read operation"));
    return this.request(action, params, false, signal).then((result) => result.data);
  }
  /** Sends typed OneBot segments only to the locally hard-authorized recipient. */
  async send(
    target: { kind: "group" | "direct"; id: string },
    segments: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    this.options.scope.assertCanSend(target);
    return this.request(
      target.kind === "group" ? "send_group_msg" : "send_private_msg",
      {
        [target.kind === "group" ? "group_id" : "user_id"]: target.id,
        message: segments,
        auto_escape: true,
      },
      true,
      signal,
    ).then((result) => result.data);
  }
  /** Retains exact reply bytes for protected history/forward source archival. */
  readEnvelope(
    action: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<OneBotResponse> {
    if (!readActions.has(action))
      return Promise.reject(new Error("Unsupported OneBot read operation"));
    return this.request(action, params, false, signal);
  }
  private async request(
    action: string,
    params: Record<string, unknown>,
    effect: boolean,
    signal?: AbortSignal,
  ): Promise<OneBotResponse> {
    const socket = this.socket;
    const generation = this.generation;
    if (this.signal.aborted || signal?.aborted)
      throw new OneBotTransportError("aborted", false);
    if (!socket || socket.readyState !== WebSocket.OPEN)
      throw new OneBotTransportError("not_connected", false);
    const echo = `${generation}:${randomUUID()}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let crossed = false;
    const controller = () =>
      this.pending
        .get(echo)
        ?.reject(new OneBotTransportError("aborted", effect && crossed));
    try {
      return await new Promise<OneBotResponse>((resolve, reject) => {
        this.pending.set(echo, { generation, effect, resolve, reject });
        timer = setTimeout(
          () => reject(new OneBotTransportError("timeout", effect && crossed)),
          this.options.requestTimeoutMs,
        );
        signal?.addEventListener("abort", controller, { once: true });
        this.signal.addEventListener("abort", controller, { once: true });
        crossed = true;
        try {
          socket.send(JSON.stringify({ action, params, echo }), (error) => {
            if (error) reject(new OneBotTransportError("disconnected", effect));
          });
        } catch {
          reject(new OneBotTransportError("disconnected", effect));
        }
      });
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", controller);
      this.signal.removeEventListener("abort", controller);
      this.pending.delete(echo);
    }
  }
  private async connectLoop(): Promise<void> {
    let attempts = 0;
    while (!this.signal.aborted) {
      const openedAt = Date.now();
      let opened = false;
      await new Promise<void>((done) => {
        const generation = ++this.generation;
        const socket = new WebSocket(this.options.endpoint, {
          headers: this.options.accessToken
            ? { Authorization: `Bearer ${this.options.accessToken}` }
            : {},
          maxPayload: 8 * 1024 * 1024,
          handshakeTimeout: this.options.requestTimeoutMs,
        });
        this.socket = socket;
        const abort = () => socket.terminate();
        this.signal.addEventListener("abort", abort, { once: true });
        socket.once("open", () => {
          opened = true;
          this.options.onConnection?.(true);
        });
        socket.on("message", (data) => {
          if (
            this.signal.aborted ||
            generation !== this.generation ||
            this.socket !== socket
          )
            return;
          const text = Buffer.concat(
            Array.isArray(data)
              ? data
              : [Buffer.isBuffer(data) ? data : Buffer.from(data)],
          ).toString("utf8");
          let value: Record<string, unknown>;
          try {
            value = record(parseOneBotJson(text));
          } catch {
            this.options.onError("invalid_json");
            return;
          }
          if (typeof value.echo === "string") {
            const request = this.pending.get(value.echo);
            if (!request || request.generation !== generation) return;
            if (
              value.status === "ok" &&
              (value.retcode === "0" || value.retcode === undefined)
            )
              request.resolve({ data: record(value.data), raw: text });
            else request.reject(new OneBotTransportError("rejected", false));
            return;
          }
          const write = Promise.resolve().then(() => this.options.onEvent(text));
          this.acceptedWrites.add(write);
          if (this.acceptedWrites.size >= 8) socket.pause();
          void write
            .catch(() => this.options.onError("ingress_write_failed"))
            .finally(() => {
              this.acceptedWrites.delete(write);
              if (this.acceptedWrites.size < 8 && this.socket === socket)
                socket.resume();
            });
        });
        socket.on("error", () => this.options.onError("connection_error"));
        socket.once("close", () => {
          this.signal.removeEventListener("abort", abort);
          if (this.socket === socket) this.socket = undefined;
          for (const request of this.pending.values())
            if (request.generation === generation)
              request.reject(new OneBotTransportError("disconnected", request.effect));
          this.options.onConnection?.(false);
          done();
        });
      });
      if (this.signal.aborted) break;
      attempts =
        opened && Date.now() - openedAt >= this.options.reconnectMaxMs
          ? 0
          : Math.min(attempts + 1, 20);
      const budget = Math.min(
        this.options.reconnectMaxMs,
        this.options.reconnectMinMs * 2 ** attempts,
      );
      await delay(
        Math.max(1, Math.round(budget * (0.8 + Math.random() * 0.2))),
        undefined,
        { signal: this.signal },
      ).catch(() => {});
    }
  }
}
