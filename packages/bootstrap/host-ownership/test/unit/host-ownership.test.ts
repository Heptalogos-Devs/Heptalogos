// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createBootId,
  createHostOwnershipToken,
  parseInstanceId,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import { publishHostOwnershipToken } from "../../src/host-ownership.js";
import type { HostLeaseConnection } from "../../src/host-lease-connection.js";

const mutationAuthority = { assertCurrent(): void {} };

interface FenceRow {
  readonly singleton: boolean;
  readonly instance_id: string;
  readonly ownership_revision: string;
  readonly host_ownership_token: string | null;
  readonly boot_id: string | null;
}

class FakeLeaseConnection implements HostLeaseConnection {
  readonly queries: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];
  state: "ACTIVE" | "FENCED" | "CLOSING" | "CLOSED" = "ACTIVE";
  readonly signal = new AbortController().signal;
  currentRow: FenceRow;
  nextReadRow: () => FenceRow;
  failOn: string | undefined;
  failAfterCommitVerification = false;

  constructor(instanceId: InstanceId) {
    this.currentRow = {
      singleton: true,
      instance_id: instanceId,
      ownership_revision: "4",
      host_ownership_token: null,
      boot_id: null,
    };
    this.nextReadRow = () => this.currentRow;
  }

  assertActive(): void {
    if (this.state !== "ACTIVE") throw new Error(`not active: ${this.state}`);
  }

  fence(_reason: string): void {
    this.state = "FENCED";
  }

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ readonly rows: readonly Row[] }> {
    this.queries.push({ text, values });
    if (this.failOn !== undefined && text.includes(this.failOn)) {
      throw new Error("test query failure");
    }
    const normalized = text.replace(/\s+/gu, " ").trim();
    if (normalized.includes("FOR UPDATE")) {
      return { rows: [this.currentRow as Row] };
    }
    if (normalized.startsWith("UPDATE")) {
      const token = String(values[0]);
      const bootId = String(values[1]);
      this.currentRow = {
        ...this.currentRow,
        ownership_revision: (
          BigInt(this.currentRow.ownership_revision) + 1n
        ).toString(),
        host_ownership_token: token,
        boot_id: bootId,
      };
      return { rows: [] };
    }
    if (normalized.includes("SELECT singleton")) {
      if (!normalized.includes("FOR UPDATE") && this.failAfterCommitVerification) {
        throw new Error("post-commit verification failure");
      }
      return { rows: [this.nextReadRow() as Row] };
    }
    return { rows: [] };
  }

  async close(): Promise<void> {
    this.state = "CLOSED";
  }
}

function fixture(): {
  readonly instanceId: InstanceId;
  readonly connection: FakeLeaseConnection;
} {
  const instanceId = parseInstanceId("0197cfe0-0000-7000-8000-000000000001");
  if (instanceId === undefined) throw new Error("invalid test InstanceId");
  return { instanceId, connection: new FakeLeaseConnection(instanceId) };
}

describe("HostOwnershipFence token publication", () => {
  it("publishes a fresh token under an exclusive row lock and verifies it after commit", async () => {
    const { instanceId, connection } = fixture();
    const bootId = createBootId();
    const token = createHostOwnershipToken();

    await expect(
      publishHostOwnershipToken({
        connection,
        instanceId,
        bootId,
        token,
        fenceLockTimeoutMs: 1_000,
        statementTimeoutMs: 1_000,
        mutationAuthority,
      }),
    ).resolves.toEqual({ previousRevision: "4", publishedRevision: "5" });

    const sql = connection.queries.map((query) => query.text).join("\n");
    expect(sql).toContain("BEGIN");
    expect(sql).toContain("lock_timeout");
    expect(sql).toContain("statement_timeout");
    expect(sql).toContain("SELECT singleton, instance_id");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("UPDATE");
    expect(sql).toContain("COMMIT");
    expect(connection.queries.at(-1)?.text).toContain("SELECT singleton");
    expect(connection.currentRow).toMatchObject({
      ownership_revision: "5",
      host_ownership_token: token,
      boot_id: bootId,
    });
  });

  it("rolls back and fences when publication encounters a query failure", async () => {
    const { instanceId, connection } = fixture();
    connection.failOn = "UPDATE";

    await expect(
      publishHostOwnershipToken({
        connection,
        instanceId,
        bootId: createBootId(),
        token: createHostOwnershipToken(),
        fenceLockTimeoutMs: 1_000,
        statementTimeoutMs: 1_000,
        mutationAuthority,
      }),
    ).rejects.toThrow();

    expect(connection.state).toBe("FENCED");
    expect(connection.queries.map((query) => query.text)).toContain("ROLLBACK");
  });

  it.each([
    ["before BEGIN", "BEGIN"],
    ["after BEGIN before UPDATE", "lock_timeout"],
    ["after UPDATE before COMMIT", "UPDATE"],
  ])("classifies %s as known-not-committed", async (_label, failOn) => {
    const { instanceId, connection } = fixture();
    connection.failOn = failOn;

    await expect(
      publishHostOwnershipToken({
        connection,
        instanceId,
        bootId: createBootId(),
        token: createHostOwnershipToken(),
        fenceLockTimeoutMs: 1_000,
        statementTimeoutMs: 1_000,
        mutationAuthority,
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "host-ownership.publication.known_not_committed" },
    });
  });

  it("classifies a COMMIT send or acknowledgement failure as commit-uncertain", async () => {
    const { instanceId, connection } = fixture();
    connection.failOn = "COMMIT";

    await expect(
      publishHostOwnershipToken({
        connection,
        instanceId,
        bootId: createBootId(),
        token: createHostOwnershipToken(),
        fenceLockTimeoutMs: 1_000,
        statementTimeoutMs: 1_000,
        mutationAuthority,
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "host-ownership.publication.commit_uncertain" },
    });
  });

  it("classifies post-COMMIT verification failure as committed-unverified", async () => {
    const { instanceId, connection } = fixture();
    connection.failAfterCommitVerification = true;

    await expect(
      publishHostOwnershipToken({
        connection,
        instanceId,
        bootId: createBootId(),
        token: createHostOwnershipToken(),
        fenceLockTimeoutMs: 1_000,
        statementTimeoutMs: 1_000,
        mutationAuthority,
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "host-ownership.publication.committed_unverified" },
    });
  });

  it("returns exact decimal revisions when publishing beyond JS safe integers", async () => {
    const { instanceId, connection } = fixture();
    connection.currentRow = {
      ...connection.currentRow,
      ownership_revision: "9007199254740993",
    };

    await expect(
      publishHostOwnershipToken({
        connection,
        instanceId,
        bootId: createBootId(),
        token: createHostOwnershipToken(),
        fenceLockTimeoutMs: 1_000,
        statementTimeoutMs: 1_000,
        mutationAuthority,
      }),
    ).resolves.toMatchObject({
      previousRevision: "9007199254740993",
      publishedRevision: "9007199254740994",
    });
  });

  it("fences when the committed row does not prove the new token and BootId", async () => {
    const { instanceId, connection } = fixture();
    const token = createHostOwnershipToken();
    const bootId = createBootId();
    connection.nextReadRow = () => ({
      ...connection.currentRow,
      host_ownership_token: createHostOwnershipToken(),
      boot_id: bootId,
    });

    await expect(
      publishHostOwnershipToken({
        connection,
        instanceId,
        bootId,
        token,
        fenceLockTimeoutMs: 1_000,
        statementTimeoutMs: 1_000,
        mutationAuthority,
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "host-ownership.publication.committed_unverified" },
    });
    expect(connection.state).toBe("FENCED");
  });

  it("fences and refuses success when bootstrap authority is lost after commit", async () => {
    const { instanceId, connection } = fixture();
    let calls = 0;
    const authority = {
      assertCurrent(): void {
        calls += 1;
        if (calls === 12) throw new Error("publication authority lost");
      },
    };
    await expect(
      publishHostOwnershipToken({
        connection,
        instanceId,
        bootId: createBootId(),
        token: createHostOwnershipToken(),
        fenceLockTimeoutMs: 1_000,
        statementTimeoutMs: 1_000,
        mutationAuthority: authority,
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "host-ownership.publication.committed_unverified" },
    });
    expect(connection.state).toBe("FENCED");
    expect(connection.queries.map((query) => query.text)).toContain("COMMIT");
  });
});
