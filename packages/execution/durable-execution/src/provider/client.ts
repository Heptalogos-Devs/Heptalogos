// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Adapts the public DBOSClient queue surface for pre-launch profile checks.
 * The caller-owned pool remains outside the client wrapper and is never closed
 * by client destruction.
 * @module client
 */

import { createRequire } from "node:module";
import type { Pool } from "pg";
import type { HostDurableExecutionAuthority } from "@heptalogos/host-ownership";
import type {
  DbosQueueHandle,
  DbosQueueRegistrationDriver,
  DbosQueueRegistrationOptions,
} from "../dispatch/queue-profiles.js";

interface DurableExecutionPoolHandle {
  end(): Promise<void>;
}

/** Bounds the public DBOSClient instance used during queue preflight. */
export interface DbosQueueClientOptions {
  readonly poolSize: number;
  readonly pollingConcurrency: number;
  readonly connectionTimeoutMs: number;
}

/** Public DBOSClient methods retained behind the Heptalogos adapter boundary. */
interface DbosClientSurface {
  registerQueue(
    name: string,
    options: DbosQueueRegistrationOptions,
  ): Promise<DbosQueueHandle>;
  destroy(): Promise<void>;
}

interface DbosClientFactorySurface {
  create(options: {
    readonly systemDatabaseUrl: string;
    readonly systemDatabasePool: Pool;
    readonly systemDatabaseSchemaName: "dbos";
    readonly systemDatabasePoolSize: number;
    readonly systemDatabasePollingConcurrency: number;
    readonly applicationName: "heptalogos";
  }): Promise<DbosClientSurface>;
}

/** Queue-registration client available only during one credential-scoped callback. */
export interface DbosQueueClient extends DbosQueueRegistrationDriver {}

const dbosClient = createRequire(import.meta.url)("@dbos-inc/dbos-sdk")
  .DBOSClient as DbosClientFactorySurface;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function connectionUrl(
  authority: HostDurableExecutionAuthority,
  password: string,
  connectionTimeoutMs: number,
): string {
  const target = authority.target;
  const timeoutSeconds = Math.max(1, Math.ceil(connectionTimeoutMs / 1_000));
  return `postgresql://${encodeURIComponent(target.user)}:${encodeURIComponent(password)}@${target.host}:${target.port}/${target.database}?connect_timeout=${timeoutSeconds}&sslmode=disable`;
}

/**
 * Uses a queue-registration driver only while the database credential is
 * available. The DBOS client and password-bearing URL never escape this
 * callback; the caller-owned pool remains caller-owned.
 */
export async function withDbosQueueClient<T>(
  authority: HostDurableExecutionAuthority,
  pool: DurableExecutionPoolHandle,
  options: DbosQueueClientOptions,
  use: (client: DbosQueueClient) => Promise<T>,
): Promise<T> {
  return authority.withDurableExecutionDatabasePassword(async (passwordUtf8) => {
    const client = await dbosClient.create({
      systemDatabaseUrl: connectionUrl(
        authority,
        utf8Decoder.decode(passwordUtf8),
        options.connectionTimeoutMs,
      ),
      systemDatabasePool: pool as unknown as Pool,
      systemDatabaseSchemaName: "dbos",
      systemDatabasePoolSize: options.poolSize,
      systemDatabasePollingConcurrency: options.pollingConcurrency,
      applicationName: "heptalogos",
    });
    try {
      return await use(
        Object.freeze({
          registerQueue: (
            name: string,
            registration: DbosQueueRegistrationOptions,
          ): Promise<DbosQueueHandle> => client.registerQueue(name, registration),
        }),
      );
    } finally {
      await client.destroy();
    }
  });
}
