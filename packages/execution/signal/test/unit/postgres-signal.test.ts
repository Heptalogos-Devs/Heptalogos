// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import {
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_RUNTIME_ROLE,
  type HostPersistenceAuthority,
} from "@heptalogos/host-ownership";
import { describe, expect, it } from "vitest";
import {
  createSignalTopic,
  decodeSignalHint,
  encodeSignalHint,
  SIGNAL_CHANNEL,
} from "../../src/index.js";
import { PostgresSignalService } from "../../src/postgres-signal.js";
import type {
  PostgresSignalRuntimeOptions,
  SignalClient,
  SignalClientFactory,
  SignalNotification,
} from "../../src/contracts.js";

class FakeSignalClient implements SignalClient {
  readonly queries: string[] = [];
  ended = false;
  connectStarted = false;
  private readonly listeners = new Map<string, ((value?: unknown) => void)[]>();

  constructor(
    private readonly connectError?: Error,
    private readonly connectGate?: Promise<void>,
  ) {}

  async connect(): Promise<void> {
    this.connectStarted = true;
    if (this.connectError !== undefined) throw this.connectError;
    await this.connectGate;
  }

  async query(text: string): Promise<void> {
    this.queries.push(text);
  }

  on(
    event: "notification" | "error" | "end",
    listener: (value?: unknown) => void,
  ): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
  }

  async end(): Promise<void> {
    this.ended = true;
  }

  emitNotification(notification: SignalNotification): void {
    for (const listener of this.listeners.get("notification") ?? [])
      listener(notification);
  }

  emitEnd(): void {
    for (const listener of this.listeners.get("end") ?? []) listener();
  }

  emitError(error: Error): void {
    for (const listener of this.listeners.get("error") ?? []) listener(error);
  }
}

function authority(signal = new AbortController().signal): HostPersistenceAuthority {
  return {
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    bootId: createBootId(),
    continuityEpochId: createContinuityEpochId(),
    token: createHostOwnershipToken(),
    target: {
      host: "127.0.0.1",
      port: 5432,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: HOST_RUNTIME_ROLE,
    },
    signal,
    assertActive() {
      if (signal.aborted) throw new Error("authority aborted");
    },
    async withRuntimeDatabasePassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ) {
      return use(new TextEncoder().encode("signal-test-password"));
    },
  };
}

function options(
  onBackgroundError: (error: unknown) => void = () => {},
  reconnectBaseDelayMs = 1,
  reconnectMaxDelayMs = Math.max(4, reconnectBaseDelayMs),
): PostgresSignalRuntimeOptions {
  return {
    connectionTimeoutMs: 1_000,
    reconnectBaseDelayMs,
    reconnectMaxDelayMs,
    onBackgroundError,
  };
}

function service(
  factory: SignalClientFactory,
  onBackgroundError: (error: unknown) => void = () => {},
  reconnectBaseDelayMs = 1,
  reconnectMaxDelayMs = Math.max(4, reconnectBaseDelayMs),
): PostgresSignalService {
  return new PostgresSignalService(
    authority(),
    options(onBackgroundError, reconnectBaseDelayMs, reconnectMaxDelayMs),
    factory,
  );
}

function factoryFor(
  clients: readonly FakeSignalClient[],
  onCreate: () => void = () => {},
): SignalClientFactory {
  let index = 0;
  return {
    create() {
      const client = clients[Math.min(index, clients.length - 1)];
      index += 1;
      if (client === undefined) throw new Error("missing test client");
      onCreate();
      return client;
    },
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  expect(condition()).toBe(true);
}

describe("Signal hint codec", () => {
  it("encodes the fixed V1 hint without durable WorkItem data", () => {
    const topic = createSignalTopic("work.available");
    const encoded = encodeSignalHint({ schemaVersion: 1, topic });

    expect(encoded).toBe('{"schemaVersion":1,"topic":"work.available"}');
    expect(decodeSignalHint(encoded)).toEqual({ schemaVersion: 1, topic });
    expect(encoded).not.toContain("workItemId");
    expect(encoded).not.toContain("payload");
  });

  it("rejects unknown fields, schema versions, and oversized notification payloads", () => {
    expect(() =>
      decodeSignalHint('{"schemaVersion":1,"topic":"work.available","extra":true}'),
    ).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({ problemCode: "signal.hint.invalid" }),
      }),
    );
    expect(() =>
      decodeSignalHint('{"schemaVersion":2,"topic":"work.available"}'),
    ).toThrow();
    expect(() => decodeSignalHint("x".repeat(513))).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({ problemCode: "signal.hint.too_large" }),
      }),
    );
  });
});

describe("PostgresSignalService", () => {
  it("filters topics, rescans after listener establishment, and closes idempotently", async () => {
    const client = new FakeSignalClient();
    const serviceInstance = service(factoryFor([client]));
    const matchingTopic = createSignalTopic("work.available");
    const otherTopic = createSignalTopic("runtime.changed");
    let matchingWakeups = 0;
    let otherWakeups = 0;
    let rescans = 0;
    const matching = await serviceInstance.subscribe(matchingTopic, {
      onWakeup() {
        matchingWakeups += 1;
      },
      onRescanRequired() {
        rescans += 1;
      },
      onBackgroundError(error) {
        throw error;
      },
    });
    const other = await serviceInstance.subscribe(otherTopic, {
      onWakeup() {
        otherWakeups += 1;
      },
      onRescanRequired() {
        rescans += 1;
      },
      onBackgroundError(error) {
        throw error;
      },
    });

    expect(client.queries).toEqual([`LISTEN "${SIGNAL_CHANNEL}"`]);
    expect(rescans).toBe(2);
    client.emitNotification({
      channel: SIGNAL_CHANNEL,
      payload: encodeSignalHint({ schemaVersion: 1, topic: matchingTopic }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(matchingWakeups).toBe(1);
    expect(otherWakeups).toBe(0);

    await matching.close();
    await matching.close();
    await other.close();
    await other.close();
    expect(client.ended).toBe(true);
  });

  it("re-LISTENs and rescans after a connection end", async () => {
    const first = new FakeSignalClient();
    const second = new FakeSignalClient();
    const serviceInstance = service(factoryFor([first, second]));
    let rescans = 0;
    const subscription = await serviceInstance.subscribe(
      createSignalTopic("work.available"),
      {
        onWakeup() {},
        onRescanRequired() {
          rescans += 1;
        },
        onBackgroundError() {},
      },
    );

    first.emitEnd();
    await waitFor(() => second.queries.length === 1);
    expect(second.queries).toEqual([`LISTEN "${SIGNAL_CHANNEL}"`]);
    expect(rescans).toBe(2);
    await subscription.close();
  });

  it("ignores a late event from an old connection after a replacement is active", async () => {
    const first = new FakeSignalClient();
    const second = new FakeSignalClient();
    const serviceInstance = service(factoryFor([first, second]));
    const topic = createSignalTopic("work.available");
    let wakeups = 0;
    const subscription = await serviceInstance.subscribe(topic, {
      onWakeup() {
        wakeups += 1;
      },
      onRescanRequired() {},
      onBackgroundError() {},
    });

    first.emitError(new Error("first connection failed"));
    await waitFor(() => second.queries.length === 1);
    first.emitEnd();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(second.ended).toBe(false);
    second.emitNotification({
      channel: SIGNAL_CHANNEL,
      payload: encodeSignalHint({ schemaVersion: 1, topic }),
    });
    await waitFor(() => wakeups === 1);
    await subscription.close();
    expect(second.ended).toBe(true);
  });

  it("does not reconnect after the final subscription closes", async () => {
    const first = new FakeSignalClient();
    const second = new FakeSignalClient();
    let created = 0;
    const serviceInstance = service(
      factoryFor([first, second], () => (created += 1)),
      () => {},
      50,
    );
    const subscription = await serviceInstance.subscribe(
      createSignalTopic("work.available"),
      {
        onWakeup() {},
        onRescanRequired() {},
        onBackgroundError() {},
      },
    );

    first.emitError(new Error("connection failed"));
    await subscription.close();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(created).toBe(1);
    expect(second.queries).toEqual([]);
    expect(second.ended).toBe(false);
  });

  it("disposes a connection that finishes connecting after the final subscription closes", async () => {
    const first = new FakeSignalClient();
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const second = new FakeSignalClient(undefined, secondGate);
    const serviceInstance = service(factoryFor([first, second]));
    const subscription = await serviceInstance.subscribe(
      createSignalTopic("work.available"),
      {
        onWakeup() {},
        onRescanRequired() {},
        onBackgroundError() {},
      },
    );

    first.emitError(new Error("connection failed"));
    await waitFor(() => second.connectStarted);
    await subscription.close();
    releaseSecond();
    await waitFor(() => second.ended);

    expect(second.ended).toBe(true);
  });

  it("starts a fresh connection when a new subscription follows an invalidated connection attempt", async () => {
    const first = new FakeSignalClient();
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const second = new FakeSignalClient(undefined, secondGate);
    const third = new FakeSignalClient();
    const serviceInstance = service(factoryFor([first, second, third]));
    const firstSubscription = await serviceInstance.subscribe(
      createSignalTopic("work.available"),
      {
        onWakeup() {},
        onRescanRequired() {},
        onBackgroundError() {},
      },
    );

    first.emitError(new Error("connection failed"));
    await waitFor(() => second.connectStarted);
    await firstSubscription.close();

    const secondSubscriptionPromise = serviceInstance.subscribe(
      createSignalTopic("work.available"),
      {
        onWakeup() {},
        onRescanRequired() {},
        onBackgroundError() {},
      },
    );
    await waitFor(() => third.queries.length === 1);
    releaseSecond();
    const secondSubscription = await secondSubscriptionPromise;

    expect(second.ended).toBe(true);
    expect(third.ended).toBe(false);
    await secondSubscription.close();
    expect(third.ended).toBe(true);
  });

  it("normalizes initial listener failure to a canonical Problem", async () => {
    const client = new FakeSignalClient(new Error("connection refused"));
    const serviceInstance = service(factoryFor([client]));

    await expect(
      serviceInstance.subscribe(createSignalTopic("work.available"), {
        onWakeup() {},
        onRescanRequired() {},
        onBackgroundError() {},
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "signal.listener.connection_failed" },
    });
  });

  it("reports malformed notifications through the background error seam", async () => {
    const client = new FakeSignalClient();
    const errors: unknown[] = [];
    const serviceInstance = service(factoryFor([client]), (error) =>
      errors.push(error),
    );
    const subscription = await serviceInstance.subscribe(
      createSignalTopic("work.available"),
      {
        onWakeup() {},
        onRescanRequired() {},
        onBackgroundError() {},
      },
    );

    client.emitNotification({ channel: SIGNAL_CHANNEL, payload: undefined });
    await waitFor(() => errors.length === 1);
    expect(errors[0]).toMatchObject({
      problem: { problemCode: "signal.listener.invalid_notification" },
    });
    await subscription.close();
  });
});
