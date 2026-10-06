// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Acquires and releases the lease-bound PostgreSQL client whose session fence
 * turns Host loss into a database-visible mutation failure.
 * @module host-lease-connection
 */

import { Client } from "pg";
import {
  createProblemError,
  type Problem,
  ProblemError,
} from "@heptalogos/foundation-contracts";
import type { HostAdvisoryKey } from "./advisory-key.js";
import type { BootstrapMutationAuthority } from "./bootstrap-authority.js";
import { HOST_LEASE_ROLE, type HostOwnershipConnectionTarget } from "./contracts.js";
import {
  createHostLeaseLifecycleTracker,
  type HostLeaseLifecycleState,
} from "./host-lease-machine.js";
import { asPostgresBoolean } from "./postgres-values.js";

/** Minimal client surface used by the Host lease adapter. */
interface HostLeaseClient {
  /** Opens the dedicated lease connection. */
  connect(): Promise<void>;
  /** Registers a listener for connection errors. */
  on(event: "error", listener: (error: unknown) => void): void;
  /** Registers a listener for connection termination. */
  on(event: "end", listener: () => void): void;
  /** Executes a query on the lease connection. */
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
  /** Closes the dedicated lease connection. */
  end(): Promise<void>;
}

interface HostLeaseClientOptions {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: string;
  readonly user: typeof HOST_LEASE_ROLE;
  readonly password: string;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly keepAlive: boolean;
  readonly keepAliveInitialDelayMillis: number;
}

/** Creates clients for the dedicated Host lease connection. */
interface HostLeaseClientFactory {
  /** Creates one client with the validated loopback and credential options. */
  create(options: HostLeaseClientOptions): HostLeaseClient;
}

/** Supplies the Host lease password for one connection callback. */
interface HostLeasePasswordProvider {
  withHostLeasePassword<T>(use: (passwordUtf8: Uint8Array) => Promise<T>): Promise<T>;
}

/** Supplies timing, advisory-lock, and authority for lease acquisition. */
export interface HostLeaseConnectionOptions {
  readonly target: HostOwnershipConnectionTarget;
  readonly advisoryKey: HostAdvisoryKey;
  readonly timing: {
    readonly connectionTimeoutMs: number;
    readonly statementTimeoutMs: number;
    readonly fenceLockTimeoutMs: number;
    readonly keepAliveInitialDelayMs: number;
  };
  readonly passwordProvider: HostLeasePasswordProvider;
  readonly mutationAuthority: BootstrapMutationAuthority;
}

/** Represents an active or fenced dedicated Host lease connection. */
export interface HostLeaseConnection {
  readonly state: HostLeaseLifecycleState;
  readonly signal: AbortSignal;
  /** Throws when the lease is not currently active. */
  assertActive(): void;
  /** Fences the lease after an ownership or connection failure. */
  fence(reason: string): void;
  /** Executes a query only while the lease remains active. */
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
  /** Closes the lease connection and completes its lifecycle. */
  close(): Promise<void>;
}

function leaseProblem(
  problemCode: string,
  title: string,
  detail: string,
  retryClass: Problem["retryClass"] = "manual",
): ProblemError {
  return createProblemError({
    problemCode,
    category: "host-ownership",
    retryClass,
    title,
    detail,
  });
}

function busyProblem(): ProblemError {
  return leaseProblem(
    "host-ownership.lease.busy",
    "Another Host already owns the PostgreSQL lease",
    "The session advisory lease was not acquired; no takeover was attempted",
    "after-change",
  );
}

function notActiveProblem(state: HostLeaseLifecycleState): ProblemError {
  return leaseProblem(
    "host-ownership.lease.not_active",
    "Host ownership lease is not active",
    `The Host ownership lease is ${state}; the requested operation is not allowed`,
  );
}

function fencedProblem(cause: string): ProblemError {
  return leaseProblem(
    "host-ownership.lease.fenced",
    "Host ownership lease was fenced",
    `The dedicated Host lease connection became uncertain because of ${cause}`,
  );
}

function queryFailedProblem(): ProblemError {
  return leaseProblem(
    "host-ownership.lease.query_failed",
    "Host ownership lease query failed",
    "The dedicated Host lease connection became uncertain while executing a query",
  );
}

function connectionFailedProblem(): ProblemError {
  return leaseProblem(
    "host-ownership.lease.connection_failed",
    "Host ownership lease connection failed",
    "The dedicated Host lease connection could not be established",
  );
}

function invalidLockResultProblem(): ProblemError {
  return leaseProblem(
    "host-ownership.lease.invalid_result",
    "PostgreSQL returned an invalid Host lease result",
    "The session advisory lock query did not return a boolean acquisition result",
  );
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw leaseProblem(
      "host-ownership.lease.invalid_credential",
      "Host lease credential is invalid UTF-8",
      "The Host lease credential could not be decoded as UTF-8",
    );
  }
}

const MAX_KEEP_ALIVE_INITIAL_DELAY_MS = 24 * 60 * 60 * 1000;

function assertTiming(timing: HostLeaseConnectionOptions["timing"]): void {
  if (
    !Number.isInteger(timing.keepAliveInitialDelayMs) ||
    timing.keepAliveInitialDelayMs < 0 ||
    timing.keepAliveInitialDelayMs > MAX_KEEP_ALIVE_INITIAL_DELAY_MS
  ) {
    throw leaseProblem(
      "host-ownership.lease.invalid_timing",
      "Host lease timing is invalid",
      "keepAliveInitialDelayMs must be an integer between 0 and 24 hours",
    );
  }
}

function defaultClientFactory(): HostLeaseClientFactory {
  return {
    create(options) {
      const client = new Client({
        host: options.host,
        port: options.port,
        database: options.database,
        user: options.user,
        password: options.password,
        connectionTimeoutMillis: options.connectionTimeoutMs,
        statement_timeout: options.statementTimeoutMs,
        keepAlive: options.keepAlive,
        keepAliveInitialDelayMillis: options.keepAliveInitialDelayMillis,
      });
      return {
        async connect() {
          await client.connect();
        },
        on(event: "error" | "end", listener: (error?: unknown) => void) {
          if (event === "error") {
            client.on("error", (error) => listener(error));
          } else {
            client.on("end", () => listener());
          }
        },
        // Intentional duplication: the lease and Bootstrap-admin adapters wrap
        // different client contracts and preserve separate lifecycle owners.
        /* jscpd:ignore-start */
        async query<Row>(text: string, values: readonly unknown[] = []) {
          const result = await client.query(text, [...values]);
          return { rows: result.rows as Row[] };
        },
        end: () => client.end(),
        /* jscpd:ignore-end */
      } satisfies HostLeaseClient;
    },
  };
}

/** Acquires the dedicated PostgreSQL lease connection and advisory fence. */
export async function acquireHostLeaseConnection(
  options: HostLeaseConnectionOptions,
): Promise<HostLeaseConnection> {
  assertTiming(options.timing);
  const factory = defaultClientFactory();

  return options.passwordProvider.withHostLeasePassword(async (passwordUtf8) => {
    const tracker = createHostLeaseLifecycleTracker();
    const abortController = new AbortController();
    const client = factory.create({
      host: options.target.host,
      port: options.target.port,
      database: options.target.database,
      user: HOST_LEASE_ROLE,
      password: decodeUtf8(passwordUtf8),
      connectionTimeoutMs: options.timing.connectionTimeoutMs,
      statementTimeoutMs: options.timing.statementTimeoutMs,
      keepAlive: true,
      keepAliveInitialDelayMillis: options.timing.keepAliveInitialDelayMs,
    });
    let closePromise: Promise<void> | undefined;

    const fence = (cause: string): void => {
      if (tracker.state === "ACQUIRING" || tracker.state === "ACTIVE") {
        tracker.send({ type: "LEASE_LOST" });
        abortController.abort(fencedProblem(cause));
      }
    };

    client.on("error", () => {
      if (tracker.state !== "CLOSING" && tracker.state !== "CLOSED") fence("error");
    });
    client.on("end", () => {
      if (tracker.state !== "CLOSING" && tracker.state !== "CLOSED") fence("end");
    });

    const connection: HostLeaseConnection = {
      get state() {
        return tracker.state;
      },
      get signal() {
        return abortController.signal;
      },
      assertActive() {
        if (tracker.state !== "ACTIVE") throw notActiveProblem(tracker.state);
      },
      fence(reason: string) {
        fence(reason);
      },
      async query<Row>(text: string, values: readonly unknown[] = []) {
        if (tracker.state !== "ACTIVE") throw notActiveProblem(tracker.state);
        try {
          const result = await client.query<Row>(text, [...values]);
          if (tracker.state !== "ACTIVE") throw fencedProblem("query completion");
          return result;
        } catch (error) {
          if (tracker.state === "ACTIVE") fence("query failure");
          if (error instanceof ProblemError) throw error;
          throw queryFailedProblem();
        }
      },
      close() {
        if (closePromise !== undefined) return closePromise;
        closePromise = (async () => {
          if (tracker.state !== "CLOSING" && tracker.state !== "CLOSED") {
            tracker.send({ type: "CLOSE_REQUESTED" });
          }
          try {
            await client.end();
          } catch {
            if (tracker.state === "CLOSING") {
              tracker.send({ type: "CLOSE_FAILED" });
              abortController.abort(fencedProblem("close failure"));
            }
            throw leaseProblem(
              "host-ownership.lease.close_failed",
              "Host ownership lease close failed",
              "The dedicated Host lease connection could not be closed with known outcome",
            );
          } finally {
            if (tracker.state === "CLOSING") tracker.send({ type: "CLOSED" });
          }
        })();
        return closePromise;
      },
    };

    try {
      await client.connect();
      if (tracker.state !== "ACQUIRING") throw fencedProblem("connection event");
      options.mutationAuthority.assertCurrent();
      const lockResult = await client.query<{ readonly acquired: unknown }>(
        "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
        [options.advisoryKey.key1, options.advisoryKey.key2],
      );
      options.mutationAuthority.assertCurrent();
      if (tracker.state !== "ACQUIRING") throw fencedProblem("lease query completion");
      const acquired = asPostgresBoolean(lockResult.rows[0]?.acquired);
      if (acquired === undefined) throw invalidLockResultProblem();
      if (!acquired) {
        tracker.send({ type: "ACQUISITION_FAILED" });
        await client.end();
        throw busyProblem();
      }
      options.mutationAuthority.assertCurrent();
      tracker.send({ type: "LEASE_ACQUIRED" });
      options.mutationAuthority.assertCurrent();
      return connection;
    } catch (error) {
      if (tracker.state === "ACQUIRING") fence("acquisition failure");
      if (tracker.state !== "CLOSED") await connection.close().catch(() => undefined);
      if (error instanceof ProblemError) throw error;
      throw connectionFailedProblem();
    }
  });
}
