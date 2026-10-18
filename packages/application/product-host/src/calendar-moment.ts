// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Read-only default Subject moment detail over existing owners.
 * @module calendar-moment
 */
import { Temporal } from "@js-temporal/polyfill";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";
import {
  activitySchema,
  calendarResultSchema,
  visibleWorldEventSchema,
  decisionCommitSchema,
  expressionBriefSchema,
  subjectReactionSchema,
  readDecisionHistory,
  readActivityStatements,
} from "@heptalogos/subject";
import {
  managementProblem,
  managementProblemSchema,
  type ProductManagement,
} from "@heptalogos/management";
import type { createGatewayRuntime } from "./gateway-runtime.js";
import { readNativeCalendarWindow } from "./native-calendar-read.js";
const object = { additionalProperties: false } as const;
const text = Type.String();
const nullableText = Type.Union([text, Type.Null()]);
const stampSchema = Type.Object(
  { timeDomainRef: text, at: text, recordedAt: nullableText },
  object,
);
const nullableStamp = Type.Union([stampSchema, Type.Null()]);
/** Local IANA wall time or an explicit-offset instant; identifiers come from the installation. */
export const calendarMomentQuerySchema = Type.Object(
  {
    at: Type.String({ minLength: 1 }),
    to: Type.Optional(Type.String({ minLength: 1 })),
  },
  object,
);
const contactSchema = Type.Object(
  {
    contactRef: text,
    occurrenceId: text,
    conversationRef: nullableText,
    observedAt: nullableStamp,
    text: nullableText,
  },
  object,
);
const inputSchema = Type.Object(
  {
    runId: text,
    activityId: text,
    role: text,
    contextAt: nullableStamp,
    contextInWindow: Type.Boolean(),
    recordedAt: text,
    consumed: Type.Boolean(),
    contacts: Type.Array(contactSchema),
  },
  object,
);
const statementSchema = Type.Object(
  {
    briefId: text,
    activityId: text,
    runId: text,
    decisionRef: text,
    audience: expressionBriefSchema.properties.audience,
    createdAt: text,
    recordedAt: text,
    adopted: Type.Boolean(),
    discarded: Type.Boolean(),
    payloads: Type.Array(Type.Object({ sourceIndex: Type.Integer(), text }, object)),
    delivery: Type.Array(
      Type.Object(
        { state: text, messageId: nullableText, acceptedAt: nullableText },
        object,
      ),
    ),
    inputContextAt: nullableStamp,
    semanticSentAt: Type.Null(),
  },
  object,
);
/** Actual records keep their original clocks; absent historical placement stays explicit. */
export const calendarMomentResultSchema = Type.Object(
  {
    subjectId: text,
    worldId: text,
    timezone: text,
    timeDomainRef: text,
    at: text,
    to: nullableText,
    calendar: calendarResultSchema,
    contextStart: text,
    contextSelection: text,
    perceptionCutoff: text,
    perceptibleEvents: Type.Array(visibleWorldEventSchema),
    deviations: Type.Array(
      Type.Object({ instanceId: text, state: text, detail: text }, object),
    ),
    inputs: Type.Array(inputSchema),
    decisions: Type.Array(
      Type.Object(
        {
          record: decisionCommitSchema,
          inputContextAt: nullableStamp,
          semanticAdoptedAt: Type.Null(),
        },
        object,
      ),
    ),
    statements: Type.Array(statementSchema),
    currentActivities: Type.Array(activitySchema),
    foreground: Type.Array(subjectReactionSchema),
    limited: Type.Object(
      {
        calendar: Type.Boolean(),
        perceptibleEvents: Type.Boolean(),
        inputs: Type.Boolean(),
        decisions: Type.Boolean(),
        statements: Type.Boolean(),
        foreground: Type.Boolean(),
      },
      object,
    ),
    unknown: Type.Array(text),
  },
  object,
);
/** Management snapshot retaining both semantic and actual recording clocks. */
export type CalendarMomentResult = Static<typeof calendarMomentResultSchema>;
/** Real IANA interpretation rejects ambiguous or nonexistent local times. */
function parseMoment(value: string, timezone: string): string {
  try {
    return /(?:Z|[+-]\d{2}:\d{2})$/iu.test(value)
      ? Temporal.Instant.from(value).toString()
      : Temporal.PlainDateTime.from(value)
          .toZonedDateTime(timezone, { disambiguation: "reject" })
          .toInstant()
          .toString();
  } catch {
    throw managementProblem(
      "calendar.invalid_moment",
      "Invalid calendar moment",
      "Use a valid local date and time in " +
        timezone +
        "; supply an offset for an ambiguous time",
      "validation",
    );
  }
}
/** All dependencies are existing read owners; no runtime opportunity is requested. */
export function createCalendarMomentOperations(options: {
  product: ProductManagement;
  gateway: Awaited<ReturnType<typeof createGatewayRuntime>>;
  persistence: PersistenceService;
}) {
  return {
    async read(
      query: Static<typeof calendarMomentQuerySchema>,
    ): Promise<CalendarMomentResult> {
      const { settings } = await options.product.configuration();
      const subjectId = settings?.subject.id,
        worldId = settings?.subject.worldId;
      if (!subjectId || !worldId)
        throw managementProblem(
          "calendar.unconfigured",
          "World calendar unavailable",
          "Configure the default Subject world",
          "unavailable",
        );
      const worlds = options.gateway.worldHttp.worlds;
      const world = await worlds.read(subjectId, worldId);
      if (!world)
        throw managementProblem(
          "calendar.world_missing",
          "World calendar unavailable",
          "The configured world has no recorded definition",
          "unavailable",
        );
      const timezone = world.definition.timezone,
        timeDomainRef = world.definition.timeDomainRef;
      const at = parseMoment(query.at, timezone),
        to = query.to ? parseMoment(query.to, timezone) : null;
      const end = to ?? Temporal.Instant.from(at).add({ milliseconds: 1 }).toString();
      if (Temporal.Instant.compare(at, end) >= 0)
        throw managementProblem(
          "calendar.invalid_range",
          "Invalid moment window",
          "The end must follow the start",
          "validation",
        );
      const interval = { timeDomainRef, start: at, end };
      const perceptionCutoff = to ?? at;
      const calendar = await worlds.readCalendar({
        subjectId,
        worldId,
        interval,
        displayTimezone: timezone,
        perspective: "world_author",
        view: "combined",
        limit: 128,
      });
      const contextStart = to
        ? at
        : calendar.items.reduce(
            (start, item) =>
              Temporal.Instant.compare(item.interval.start, start) < 0
                ? item.interval.start
                : start,
            at,
          );
      let native = await readNativeCalendarWindow(options.persistence, {
        subjectId,
        timeDomainRef,
        start: contextStart,
        end,
      });
      let contextSelection = to ? "window" : "intersecting_events_until_at";
      if (
        !to &&
        !native.inputs.some((input) => input.consumed && input.contextInWindow)
      ) {
        const nearest = await readNativeCalendarWindow(options.persistence, {
          subjectId,
          timeDomainRef,
          start: "0001-01-01T00:00:00Z",
          end,
          nearestCompleted: true,
        });
        if (nearest.inputs.length) {
          const unique = new Set(native.inputs.map((input) => input.runId));
          native = {
            inputs: [
              ...native.inputs,
              ...nearest.inputs.filter((input) => !unique.has(input.runId)),
            ],
            more: native.more,
          };
          contextSelection = "intersecting_events_and_nearest_completed_input";
        }
      }
      const known = await worlds.query({
        subjectId,
        worldId,
        interval: { ...interval, start: contextStart },
        view: "subject",
        knowledgeAtWorldTime: { timeDomainRef, at: perceptionCutoff },
        limit: 128,
      });
      const activityIds = [
        ...new Set([
          ...calendar.items.flatMap((item) =>
            item.planned?.activityId ? [item.planned.activityId] : [],
          ),
          ...native.inputs.map((input) => input.activityId),
        ]),
      ];
      const runIds = native.inputs
        .filter((input) => input.contextInWindow)
        .map((input) => input.runId);
      const [decisionPage, statementPage, activities, foreground] = await Promise.all([
        readDecisionHistory(options.persistence, {
          subjectId,
          sourceRunIds: runIds,
          activityIds,
        }),
        readActivityStatements(options.persistence, { subjectId, activityIds }),
        Promise.all(activityIds.map((id) => options.gateway.life.get(subjectId, id))),
        options.gateway.foreground.history({ subjectId, limit: 128 }),
      ]);
      const contextFor = (runId: string) =>
        native.inputs.find((input) => input.runId === runId)?.contextAt ?? null;
      const unknown = [
        "采用决定和发送原文未持久化独立世界时标；inputContextAt 是原输入时刻，adoptedAt/createdAt/recordedAt/acceptedAt 是真实记录时间。",
        "currentActivities 是当前任务快照；当时任务状态未知。foreground 的 startedAt/deadlineAt 是真实时间。",
      ];
      if (!native.inputs.some((input) => input.contacts.length))
        unknown.push("该时段没有可核对已完成输入的实际接触记录。");
      if (!decisionPage.decisions.length) unknown.push("没有关联的已采用决定记录。");
      if (!statementPage.statements.length)
        unknown.push("没有关联的保留或采用原文记录。");
      return {
        subjectId,
        worldId,
        timezone,
        timeDomainRef,
        at,
        to,
        calendar,
        contextStart,
        contextSelection,
        perceptionCutoff,
        perceptibleEvents: known.events.map((event) => {
          if (!("eventRevision" in event))
            throw managementProblem(
              "calendar.invalid_view",
              "Subject view unavailable",
              "World query returned a different perspective",
              "unavailable",
            );
          return event;
        }),
        deviations: calendar.items.flatMap((item) => {
          const outcomes = item.lived.flatMap((event) =>
            "scheduleOutcome" in event && event.scheduleOutcome
              ? [event.scheduleOutcome]
              : [],
          );
          if (item.status === "cancelled")
            return [
              { instanceId: item.instanceId, state: "cancelled", detail: "计划已取消" },
            ];
          if (item.status === "unplanned")
            return [
              {
                instanceId: item.instanceId,
                state: "unplanned",
                detail: "记录了计划外实际事件",
              },
            ];
          if (outcomes.some((outcome) => outcome === "missed" || outcome === "partial"))
            return [
              {
                instanceId: item.instanceId,
                state: outcomes.join(","),
                detail: "实际事件记录的计划完成结果",
              },
            ];
          if (item.planned && !item.lived.length)
            return [
              {
                instanceId: item.instanceId,
                state: "unknown",
                detail: "未记录实际实现，偏离原因未知",
              },
            ];
          return [];
        }),
        inputs: native.inputs,
        decisions: decisionPage.decisions.map((record) => ({
          record,
          inputContextAt: contextFor(record.sourceRunId),
          semanticAdoptedAt: null,
        })),
        statements: statementPage.statements.map((record) => ({
          ...record,
          inputContextAt: contextFor(record.runId),
          semanticSentAt: null,
        })),
        currentActivities: activities.flatMap((activity) =>
          activity ? [activity] : [],
        ),
        foreground: foreground.reactions.filter((reaction) =>
          activityIds.includes(reaction.activityId),
        ),
        limited: {
          calendar: !!calendar.continuation,
          perceptibleEvents: !!known.nextEventId,
          inputs: native.more,
          decisions: decisionPage.more,
          statements: statementPage.more,
          foreground: foreground.more,
        },
        unknown,
      };
    },
  };
}
/** Authenticated management read registered independently of optional runtime construction. */
export function registerCalendarMomentHttp(
  app: FastifyInstance,
  authenticate: (token: string | undefined) => Promise<unknown>,
  operations?: ReturnType<typeof createCalendarMomentOperations>,
) {
  app.get(
    "/v1/calendar/moment",
    {
      onRequest: (request) =>
        authenticate(request.headers.authorization?.replace(/^Bearer /u, "")),
      schema: {
        operationId: "getCalendarMoment",
        querystring: calendarMomentQuerySchema,
        response: {
          200: calendarMomentResultSchema,
          400: managementProblemSchema,
          401: managementProblemSchema,
          503: managementProblemSchema,
          500: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      if (!operations)
        throw managementProblem(
          "calendar.unavailable",
          "Calendar detail unavailable",
          "The installed read owners are not ready",
          "unavailable",
        );
      return operations.read(request.query as Static<typeof calendarMomentQuerySchema>);
    },
  );
}
