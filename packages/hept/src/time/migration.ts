import type { ColumnType, Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import { sql } from "@nous-wave/platform/storage";
import type {
  ClockOfflinePolicy,
  ClockChangeReceipt,
  TimeCaptureReceipt,
  TimeDomain,
} from "@nous-wave/contracts/time";
import type { Ref, CallContext } from "@nous-wave/contracts/common";
type Timestamp = ColumnType<string, string | undefined, never>;
export interface TimeDatabase {
  timeDomains: {
    domainId: string;
    label: string;
    authorityRef: TimeDomain["authorityRef"];
    status: "active" | "retired";
    subjectId: string | null;
    createdRealAt: Timestamp;
  };
  clocks: {
    clockId: string;
    domainId: string;
    subjectId: string | null;
    revision: string;
    currentSegmentId: string;
    onlineRate: string;
    offlinePolicy: ClockOfflinePolicy;
    status: "running" | "paused" | "retired";
  };
  clockSegments: {
    segmentId: string;
    clockId: string;
    revision: string;
    domainAnchor: string;
    realAnchor: string;
    rate: string;
    operationId: string;
    reason: string;
  };
  clockCheckpoints: {
    clockId: string;
    segmentId: string;
    clockRevision: string;
    domainHighWater: string;
    capturedRealAt: string;
  };
  clockCaptures: {
    captureId: string;
    originRef: Ref | null;
    domainId: string;
    clockId: string | null;
    operationId: string;
    requestDigest: string;
    subjectId: string | null;
    actor: CallContext["actor"];
    actorAuthorityRef: string;
    consumer: CallContext["consumer"];
    receipt: TimeCaptureReceipt;
    recordedRealAt: Timestamp;
  };
  clockChanges: {
    clockId: string;
    operationId: string;
    requestDigest: string;
    actor: CallContext["actor"];
    actorAuthorityRef: string;
    consumer: CallContext["consumer"];
    request: unknown;
    receipt: ClockChangeReceipt;
    recordedRealAt: Timestamp;
  };
  timeDomainReceipts: {
    operationId: string;
    requestDigest: string;
    actor: CallContext["actor"];
    actorAuthorityRef: string;
    consumer: CallContext["consumer"];
    result: TimeDomain;
  };
}
export const timeMigration: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createTable("timeDomains")
      .addColumn("domainId", "text", (c) => c.primaryKey())
      .addColumn("label", "text", (c) => c.notNull())
      .addColumn("authorityRef", "jsonb", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("subjectId", "uuid")
      .addColumn("createdRealAt", sql`timestamptz(6)`, (c) =>
        c.notNull().defaultTo(sql`clock_timestamp()`),
      )
      .execute();
    await db.schema
      .createTable("clocks")
      .addColumn("clockId", "uuid", (c) => c.primaryKey())
      .addColumn("domainId", "text", (c) =>
        c.notNull().unique().references("timeDomains.domainId"),
      )
      .addColumn("subjectId", "uuid")
      .addColumn("revision", "bigint", (c) => c.notNull())
      .addColumn("currentSegmentId", "uuid", (c) => c.notNull())
      .addColumn("onlineRate", "numeric", (c) => c.notNull())
      .addColumn("offlinePolicy", "jsonb", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .execute();
    await db.schema
      .createTable("clockSegments")
      .addColumn("segmentId", "uuid", (c) => c.primaryKey())
      .addColumn("clockId", "uuid", (c) =>
        c.notNull().references("clocks.clockId"),
      )
      .addColumn("revision", "bigint", (c) => c.notNull())
      .addColumn("domainAnchor", sql`timestamptz(6)`, (c) => c.notNull())
      .addColumn("realAnchor", sql`timestamptz(6)`, (c) => c.notNull())
      .addColumn("rate", "numeric", (c) => c.notNull())
      .addColumn("operationId", "text", (c) => c.notNull())
      .addColumn("reason", "text", (c) => c.notNull())
      .addUniqueConstraint("clockSegmentRevision", ["clockId", "revision"])
      .execute();
    await db.schema
      .alterTable("clocks")
      .addForeignKeyConstraint(
        "clocksCurrentSegmentFk",
        ["currentSegmentId"],
        "clockSegments",
        ["segmentId"],
        (c) => c.deferrable().initiallyDeferred(),
      )
      .execute();
    await db.schema
      .createTable("clockCheckpoints")
      .addColumn("clockId", "uuid", (c) =>
        c.primaryKey().references("clocks.clockId"),
      )
      .addColumn("segmentId", "uuid", (c) =>
        c.notNull().references("clockSegments.segmentId"),
      )
      .addColumn("clockRevision", "bigint", (c) => c.notNull())
      .addColumn("domainHighWater", sql`timestamptz(6)`, (c) => c.notNull())
      .addColumn("capturedRealAt", sql`timestamptz(6)`, (c) => c.notNull())
      .execute();
    await db.schema
      .createTable("clockCaptures")
      .addColumn("originRef", "jsonb")
      .addColumn("captureId", "uuid", (c) => c.primaryKey())
      .addColumn("domainId", "text", (c) =>
        c.notNull().references("timeDomains.domainId"),
      )
      .addColumn("clockId", "uuid", (c) => c.references("clocks.clockId"))
      .addColumn("operationId", "text", (c) => c.notNull().unique())
      .addColumn("requestDigest", "text", (c) => c.notNull())
      .addColumn("subjectId", "uuid")
      .addColumn("actor", "jsonb", (c) => c.notNull())
      .addColumn("actorAuthorityRef", "text", (c) => c.notNull())
      .addColumn("consumer", "jsonb", (c) => c.notNull())
      .addColumn("receipt", "jsonb", (c) => c.notNull())
      .addColumn("recordedRealAt", sql`timestamptz(6)`, (c) =>
        c.notNull().defaultTo(sql`clock_timestamp()`),
      )
      .execute();
    await db.schema
      .createTable("clockChanges")
      .addColumn("clockId", "uuid", (c) =>
        c.notNull().references("clocks.clockId"),
      )
      .addColumn("operationId", "text", (c) => c.notNull())
      .addColumn("requestDigest", "text", (c) => c.notNull())
      .addColumn("actor", "jsonb", (c) => c.notNull())
      .addColumn("actorAuthorityRef", "text", (c) => c.notNull())
      .addColumn("consumer", "jsonb", (c) => c.notNull())
      .addColumn("request", "jsonb", (c) => c.notNull())
      .addColumn("receipt", "jsonb", (c) => c.notNull())
      .addColumn("recordedRealAt", sql`timestamptz(6)`, (c) =>
        c.notNull().defaultTo(sql`clock_timestamp()`),
      )
      .addPrimaryKeyConstraint("clockChangesPk", ["clockId", "operationId"])
      .execute();
    await db.schema
      .createTable("timeDomainReceipts")
      .addColumn("operationId", "text", (c) => c.primaryKey())
      .addColumn("requestDigest", "text", (c) => c.notNull())
      .addColumn("actor", "jsonb", (c) => c.notNull())
      .addColumn("actorAuthorityRef", "text", (c) => c.notNull())
      .addColumn("consumer", "jsonb", (c) => c.notNull())
      .addColumn("result", "jsonb", (c) => c.notNull())
      .execute();
  },
  async down(db: Kysely<any>) {
    for (const table of [
      "timeDomainReceipts",
      "clockChanges",
      "clockCaptures",
      "clockCheckpoints",
    ])
      await db.schema.dropTable(table).execute();
    await db.schema
      .alterTable("clocks")
      .dropConstraint("clocksCurrentSegmentFk")
      .execute();
    for (const table of ["clockSegments", "clocks", "timeDomains"])
      await db.schema.dropTable(table).execute();
  },
};
