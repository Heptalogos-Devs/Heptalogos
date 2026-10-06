// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines bounded Signal listener, subscription, and publication contracts so
 * LISTEN/NOTIFY remains a best-effort wakeup hint rather than durable truth.
 * @module contracts
 */

import type { NamespacedId } from "@heptalogos/foundation-contracts";
import type { HostPersistenceAuthority } from "@heptalogos/host-ownership";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";

/** A validated semantic channel name used for best-effort wakeups. */
export type SignalTopic = NamespacedId<"SignalTopic">;

/** Owns one listener registration and releases its client resources on close. */
export interface SignalSubscription {
  /** Stop delivery and await cleanup of the underlying listener. */
  close(): Promise<void>;
}

/** Receives wakeup hints without treating notifications as durable state. */
export interface SignalListener {
  /** Ask the consumer to inspect its durable source of truth. */
  onWakeup(): void | Promise<void>;
  /** Ask the consumer to perform a broader scan after a missed or invalid hint. */
  onRescanRequired(): void | Promise<void>;
  /** Report a background transport failure to the owning runtime. */
  onBackgroundError(error: unknown): void;
}

/** Provides subscriptions to the repository's bounded signal transport. */
export interface SignalService {
  /** Subscribe a listener to a topic until its subscription is closed. */
  subscribe(topic: SignalTopic, listener: SignalListener): Promise<SignalSubscription>;
}

/** Bounds reconnect behavior and routes transport failures to the runtime owner. */
export interface PostgresSignalRuntimeOptions {
  readonly connectionTimeoutMs: number;
  readonly reconnectBaseDelayMs: number;
  readonly reconnectMaxDelayMs: number;
  readonly onBackgroundError: (error: unknown) => void;
}

/** Local PostgreSQL connection settings accepted by the signal adapter. */
export interface SignalClientOptions {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly connectionTimeoutMs: number;
}

/** Minimal notification shape emitted by the PostgreSQL client adapter. */
export interface SignalNotification {
  readonly channel: string;
  readonly payload?: string;
}

/** Narrow client surface required by the signal service for connection lifetime control. */
export interface SignalClient {
  /** Establish the notification connection. */
  connect(): Promise<void>;
  /** Execute a setup or teardown statement on the notification connection. */
  query(text: string): Promise<void>;
  /** Register a transport event listener. */
  on(
    event: "notification" | "error" | "end",
    listener: (value?: unknown) => void,
  ): void;
  /** End the connection and release client resources. */
  end(): Promise<void>;
}

/** Constructs a signal client without exposing the concrete PostgreSQL library. */
export interface SignalClientFactory {
  /** Create a client configured for the local signal connection. */
  create(options: SignalClientOptions): SignalClient;
}

/** Publishes a transaction-scoped wakeup after the durable mutation is accepted. */
export interface SignalPublisher {
  /** Enqueue a topic notification in the supplied persistence transaction. */
  publish(
    transaction: PersistenceMutationTransactionContext,
    topic: SignalTopic,
  ): Promise<void>;
}

/** Authority marker for signal operations that depend on host persistence ownership. */
export type SignalHostAuthority = HostPersistenceAuthority;
