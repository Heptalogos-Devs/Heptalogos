// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the dedicated PostgreSQL LISTEN connection and reconnect/rescan lifecycle
 * while keeping notification loss safe through canonical consumer re-query.
 * @module postgres-signal
 */

import { CompiledQuery } from "kysely";
import { Client } from "pg";
import {
  decodeSignalHint,
  encodeSignalHint,
  parseSignalTopic,
  SIGNAL_CHANNEL,
} from "./hint-codec.js";
import type {
  PostgresSignalRuntimeOptions,
  SignalClient,
  SignalClientFactory,
  SignalClientOptions,
  SignalHostAuthority,
  SignalListener,
  SignalNotification,
  SignalPublisher,
  SignalService,
  SignalSubscription,
  SignalTopic,
} from "./contracts.js";
import { signalProblem } from "./problems.js";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import { ProblemError } from "@heptalogos/foundation-contracts";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const defaultClientFactory: SignalClientFactory = {
  create(options: SignalClientOptions): SignalClient {
    const client = new Client({
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: options.password,
      connectionTimeoutMillis: options.connectionTimeoutMs,
      application_name: "heptalogos-signal-listener",
    });
    return {
      async connect() {
        await client.connect();
      },
      async query(text) {
        await client.query(text);
      },
      on(event, listener) {
        if (event === "notification") {
          client.on("notification", (notification) => listener(notification));
        } else if (event === "error") {
          client.on("error", (error) => listener(error));
        } else {
          client.on("end", () => listener());
        }
      },
      end: () => client.end(),
    };
  },
};

interface SubscriptionEntry {
  readonly topic: SignalTopic;
  readonly listener: SignalListener;
  closed: boolean;
}

type ConnectionSlotState = "CONNECTING" | "ACTIVE" | "STALE" | "CLOSED";

interface ConnectionSlot {
  readonly generation: number;
  readonly client: SignalClient;
  state: ConnectionSlotState;
  endPromise?: Promise<void>;
}

interface ConnectionAttempt {
  readonly epoch: number;
  readonly promise: Promise<void>;
}

function normalizeError(problemCode: string, error: unknown): unknown {
  return error instanceof ProblemError
    ? error
    : signalProblem(problemCode, "PostgreSQL Signal listener operation failed", error);
}

function assertOptions(options: PostgresSignalRuntimeOptions): void {
  if (
    !Number.isSafeInteger(options.connectionTimeoutMs) ||
    options.connectionTimeoutMs <= 0 ||
    !Number.isSafeInteger(options.reconnectBaseDelayMs) ||
    options.reconnectBaseDelayMs < 0 ||
    !Number.isSafeInteger(options.reconnectMaxDelayMs) ||
    options.reconnectMaxDelayMs < options.reconnectBaseDelayMs
  ) {
    throw signalProblem(
      "signal.listener.invalid_options",
      "Signal listener timing options are invalid",
    );
  }
}

/**
 * Maintains one dedicated LISTEN connection and converts loss into a durable
 * rescan request so notification delivery never becomes the source of truth.
 */
export class PostgresSignalService implements SignalService {
  private readonly subscriptions = new Set<SubscriptionEntry>();
  private readonly clientFactory: SignalClientFactory;
  private activeSlot: ConnectionSlot | undefined;
  private connectingSlot: ConnectionSlot | undefined;
  private connectPromise: ConnectionAttempt | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private connectionEpoch = 0;
  private nextConnectionGeneration = 0;
  private closing = false;
  private closePromise: Promise<void> | undefined;

  /** Create a listener bound to the host-owned PostgreSQL runtime. */
  constructor(
    private readonly authority: SignalHostAuthority,
    private readonly options: PostgresSignalRuntimeOptions,
    clientFactory: SignalClientFactory = defaultClientFactory,
  ) {
    assertOptions(options);
    this.clientFactory = clientFactory;
    this.authority.signal.addEventListener(
      "abort",
      () => {
        void this.close().catch((error) => this.report(error));
      },
      { once: true },
    );
  }

  /** Register a topic listener and establish the shared connection on demand. */
  async subscribe(
    topic: SignalTopic,
    listener: SignalListener,
  ): Promise<SignalSubscription> {
    if (parseSignalTopic(topic) === undefined) {
      throw signalProblem("signal.topic.invalid", "Signal topic is invalid");
    }
    if (this.closing || this.authority.signal.aborted) {
      throw signalProblem(
        "signal.listener.closed",
        "Signal listener admission is closed",
      );
    }
    const entry: SubscriptionEntry = { topic, listener, closed: false };
    this.subscriptions.add(entry);
    try {
      const wasConnected = this.activeSlot !== undefined;
      await this.ensureConnected();
      if (wasConnected) await this.invokeRescan(entry);
    } catch (error) {
      this.subscriptions.delete(entry);
      throw error;
    }
    if (this.activeSlot !== undefined && !this.hasRescannedEntry(entry)) {
      await this.invokeRescan(entry);
    }
    return {
      close: async () => {
        if (entry.closed) return;
        entry.closed = true;
        this.subscriptions.delete(entry);
        if (this.subscriptions.size === 0) await this.closeClient();
      },
    };
  }

  private readonly rescanned = new WeakSet<SubscriptionEntry>();

  private hasRescannedEntry(entry: SubscriptionEntry): boolean {
    return this.rescanned.has(entry);
  }

  private async invokeRescan(entry: SubscriptionEntry): Promise<void> {
    if (entry.closed) return;
    this.rescanned.add(entry);
    try {
      await entry.listener.onRescanRequired();
    } catch (error) {
      this.report(normalizeError("signal.listener.connection_failed", error));
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.activeSlot !== undefined) return;
    if (this.connectPromise?.epoch === this.connectionEpoch) {
      return this.connectPromise.promise;
    }
    if (
      this.closing ||
      this.authority.signal.aborted ||
      this.subscriptions.size === 0
    ) {
      return;
    }
    const epoch = this.connectionEpoch;
    const promise = this.connect(epoch);
    this.connectPromise = { epoch, promise };
    void promise.then(
      () => {
        if (this.connectPromise?.promise === promise) this.connectPromise = undefined;
      },
      () => {
        if (this.connectPromise?.promise === promise) this.connectPromise = undefined;
      },
    );
    return promise;
  }

  private canActivate(epoch: number, slot?: ConnectionSlot): boolean {
    return (
      !this.closing &&
      !this.authority.signal.aborted &&
      this.connectionEpoch === epoch &&
      this.subscriptions.size > 0 &&
      (slot === undefined || this.connectingSlot === slot) &&
      (slot === undefined || slot.state === "CONNECTING")
    );
  }

  private async connect(epoch: number): Promise<void> {
    this.authority.assertActive();
    const isReconnect = this.reconnectAttempt > 0;
    let slot: ConnectionSlot | undefined;
    try {
      const client = await this.authority.withRuntimeDatabasePassword(
        async (passwordUtf8) => {
          this.authority.assertActive();
          let password: string;
          try {
            password = utf8Decoder.decode(passwordUtf8);
          } catch (error) {
            throw signalProblem(
              "signal.listener.connection_failed",
              "Signal credential is invalid UTF-8",
              error,
            );
          }
          return this.clientFactory.create({
            host: this.authority.target.host,
            port: this.authority.target.port,
            database: this.authority.target.database,
            user: this.authority.target.user,
            password,
            connectionTimeoutMs: this.options.connectionTimeoutMs,
          });
        },
      );
      slot = {
        generation: ++this.nextConnectionGeneration,
        client,
        state: "CONNECTING",
      };
      this.connectingSlot = slot;
      this.attachClient(slot);
      if (!this.canActivate(epoch, slot)) {
        await this.disposeSlot(slot);
        return;
      }
      await client.connect();
      if (!this.canActivate(epoch, slot)) {
        await this.disposeSlot(slot);
        return;
      }
      await client.query(`LISTEN "${SIGNAL_CHANNEL}"`);
      if (!this.canActivate(epoch, slot)) {
        await this.disposeSlot(slot);
        return;
      }
      this.connectingSlot = undefined;
      slot.state = "ACTIVE";
      this.activeSlot = slot;
      this.reconnectAttempt = 0;
      if (isReconnect) {
        for (const entry of this.subscriptions) await this.invokeRescan(entry);
      }
    } catch (error) {
      if (slot !== undefined) {
        if (this.connectingSlot === slot) this.connectingSlot = undefined;
        if (this.activeSlot === slot) this.activeSlot = undefined;
        slot.state = "STALE";
        await this.disposeSlot(slot);
      }
      throw normalizeError("signal.listener.connection_failed", error);
    }
  }

  private attachClient(slot: ConnectionSlot): void {
    slot.client.on("notification", (value) => {
      void this.handleNotification(slot, value).catch((error) => this.report(error));
    });
    slot.client.on("error", (error) => this.handleClientFailure(slot, error));
    slot.client.on("end", () => this.handleClientFailure(slot, undefined));
  }

  private async handleNotification(
    slot: ConnectionSlot,
    value: unknown,
  ): Promise<void> {
    if (this.closing || this.activeSlot !== slot || slot.state !== "ACTIVE") return;
    const notification = value as SignalNotification | undefined;
    if (
      notification === undefined ||
      notification.channel !== SIGNAL_CHANNEL ||
      typeof notification.payload !== "string"
    ) {
      throw signalProblem(
        "signal.listener.invalid_notification",
        "Signal notification did not contain the fixed channel and text hint",
      );
    }
    const hint = decodeSignalHint(notification.payload);
    await Promise.all(
      [...this.subscriptions]
        .filter((entry) => !entry.closed && entry.topic === hint.topic)
        .map((entry) => Promise.resolve(entry.listener.onWakeup())),
    );
  }

  private handleClientFailure(slot: ConnectionSlot, error: unknown): void {
    if (this.closing || slot.state === "STALE" || slot.state === "CLOSED") return;
    const isActive = this.activeSlot === slot && slot.state === "ACTIVE";
    const isConnecting = this.connectingSlot === slot && slot.state === "CONNECTING";
    if (!isActive && !isConnecting) return;
    slot.state = "STALE";
    if (this.activeSlot === slot) this.activeSlot = undefined;
    if (this.connectingSlot === slot) this.connectingSlot = undefined;
    this.connectionEpoch += 1;
    this.report(normalizeError("signal.listener.connection_failed", error));
    void this.disposeSlot(slot);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (
      this.closing ||
      this.authority.signal.aborted ||
      this.subscriptions.size === 0 ||
      this.reconnectTimer !== undefined
    ) {
      return;
    }
    const delay = Math.min(
      this.options.reconnectMaxDelayMs,
      this.options.reconnectBaseDelayMs * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (
        this.closing ||
        this.authority.signal.aborted ||
        this.subscriptions.size === 0
      ) {
        return;
      }
      void this.ensureConnected().catch((error) => {
        this.report(error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private report(error: unknown): void {
    try {
      this.options.onBackgroundError(error);
    } catch {
      // Background diagnostics cannot replace listener lifecycle handling.
    }
    for (const entry of this.subscriptions) {
      try {
        entry.listener.onBackgroundError(error);
      } catch {
        // Subscriber diagnostics cannot escape the listener loop.
      }
    }
  }

  private async disposeSlot(slot: ConnectionSlot): Promise<void> {
    if (slot.endPromise !== undefined) return slot.endPromise;
    slot.state = "CLOSED";
    slot.endPromise = slot.client.end().catch((error) => {
      this.report(error);
    });
    await slot.endPromise;
  }

  private async closeClient(): Promise<void> {
    this.connectionEpoch += 1;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const slots = new Set<ConnectionSlot>();
    if (this.activeSlot !== undefined) slots.add(this.activeSlot);
    if (this.connectingSlot !== undefined) slots.add(this.connectingSlot);
    this.activeSlot = undefined;
    this.connectingSlot = undefined;
    await Promise.all(
      [...slots].map((slot) => {
        slot.state = "STALE";
        return this.disposeSlot(slot);
      }),
    );
  }

  private async close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.closePromise = this.closeClient();
    await this.closePromise;
  }
}

/** Create the PostgreSQL-backed signal service behind the narrow SignalService contract. */
export function createPostgresSignalService(
  authority: SignalHostAuthority,
  options: PostgresSignalRuntimeOptions,
): SignalService {
  return new PostgresSignalService(authority, options);
}

async function executeNotify(
  transaction: PersistenceInternalTransaction,
  encoded: string,
): Promise<void> {
  await transaction.executeQuery(
    CompiledQuery.raw(`SELECT pg_notify('${SIGNAL_CHANNEL}', $1)`, [encoded]),
  );
}

/** Publish a bounded wakeup inside the caller's mutation transaction. */
export const postgresSignalPublisher: SignalPublisher = {
  async publish(
    transaction: PersistenceMutationTransactionContext,
    topic: SignalTopic,
  ) {
    try {
      const encoded = encodeSignalHint({ schemaVersion: 1, topic });
      await useRepositoryMutationTransaction(transaction, (databaseTransaction) =>
        executeNotify(databaseTransaction, encoded),
      );
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      throw signalProblem(
        "signal.publish.failed",
        "PostgreSQL Signal publication failed",
        error,
      );
    }
  },
};
