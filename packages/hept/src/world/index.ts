import { subjectIdOf } from "../platform/runtime.js";
import { parse as parseTimePoint } from "@nous-wave/platform/time";
import { micros, addMicros, readReal } from "@nous-wave/platform/time";
import type { ClockRef } from "@nous-wave/contracts/time";
import type { Time } from "../time/index.js";
import {
  expandCalendar,
  validateCalendarRule,
  addMinutes,
} from "./calendar.js";
import type { CallContext, TimePoint } from "@nous-wave/contracts/common";
import {
  calendarRule,
  worldPackage,
  type WorldPackage,
} from "@heptalogos/contracts";
import type { Kysely } from "kysely";
import { v7 } from "uuid";
import type { Database, Json } from "../platform/database.js";
import {
  type Authorization,
  read,
  list,
  put,
  idempotent,
  problem,
  makeRef,
} from "../platform/runtime.js";
import { energyRates, integrateLife } from "./rules.js";
export { energyRates, integrateLife, channelCompatibility } from "./rules.js";
export function world(
  db: Kysely<Database>,
  installationId: string,
  authorize: Authorization,
  time: Time,
) {
  async function current(sid: string, client: Kysely<Database> = db) {
    return (await list(client, "worlds", sid))[0];
  }
  const selection = (w: Json, sid: string) => ({
    subjectId: sid,
    domainId: w.domainId as string,
    preferClock: w.clockRef as ClockRef,
  });
  const currentPoint = async (w: Json, sid: string) =>
    (await time.readCurrent(selection(w, sid))).now.point;
  async function calendar(
    sid: string,
    from: string,
    to: string,
    characterId?: string,
    client: Kysely<Database> = db,
  ) {
    const w = (await list(client, "worlds", sid))[0];
    if (!w) return [];
    const rules = (await list(client, "calendarRules", sid)).filter((rule) =>
      characterId ? rule.characterId === characterId : !rule.characterId,
    );
    return expandCalendar(
      rules,
      await list(client, "calendarExceptions", sid),
      String(w.id),
      from,
      to,
    );
  }
  async function advanceIn(
    tx: Kysely<Database>,
    ctx: CallContext,
    target?: string,
    phase = "advance",
  ) {
    const sid = subjectIdOf(ctx);
    const first = (await list(tx, "worlds", sid))[0];
    if (!first) {
      const capture = await time.captureIn(tx, ctx, {
        operationId: `${ctx.trace.operationId}:world:${phase}`,
      });
      return { time: capture.point, capture, events: [], needsRealization: [] };
    }
    const captured = await time.captureIn(tx, ctx, {
      operationId: `${ctx.trace.operationId}:world:${phase}`,
      selection: selection(first, sid),
    });
    await tx
      .selectFrom("worlds")
      .select("id")
      .where("id", "=", first.id as string)
      .forUpdate()
      .execute();
    const w = await read(tx, "worlds", sid, first.id as string),
      at = target
        ? parseTimePoint({ domainId: w.domainId, at: target }).at
        : captured.point.at,
      domainId = w.domainId as string,
      from = w.realizedThrough as string;
    if (at > captured.point.at)
      problem(
        "invalid_input",
        "Realization cannot move beyond the captured clock; advance Clock explicitly",
      );
    if (at < from) problem("conflict", "World cannot advance backwards", 409);
    const occurrences = await calendar(sid, from, at, undefined, tx);
    const active = (await list(tx, "activities", sid)).filter(
      (a) => a.status === "active" && a.start && a.end,
    );
    const cuts = [
      ...new Set(
        [
          from,
          at,
          ...occurrences.flatMap((o) => [String(o.start), String(o.end)]),
          ...active.flatMap((a) => [
            (a.start as TimePoint).at,
            (a.end as TimePoint).at,
          ]),
        ].filter((t) => t >= from && t <= at),
      ),
    ].sort();
    const events: Json[] = [];
    let life = (await list(tx, "lifeState", sid))[0] ?? {
      energy: 1,
      fatigue: 0,
      mood: "calm",
      focus: "",
      updatedWorldAt: from,
    };
    let place = w.currentPlace;
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1],
        end = cuts[i];
      if (start === end) continue;
      const activity = active.find(
        (a) =>
          (a.start as TimePoint).at <= start && (a.end as TimePoint).at > start,
      );
      const planned = occurrences.find(
        (o) => String(o.start) <= start && String(o.end) > start,
      );
      const kind = (activity?.kind ??
        planned?.activityKind ??
        "other") as keyof typeof energyRates;
      const title = activity?.title ?? planned?.title ?? "自由时间";
      events.push(
        await put(tx, "realizedEvents", sid, {
          worldId: w.id,
          occurrenceId: planned?.occurrenceId,
          activityId: activity?.id,
          title,
          start,
          end,
          domainId,
          clockRef: "clockRef" in captured ? captured.clockRef : undefined,
          placeId: place,
          kind,
          participation:
            (planned?.placeId && planned.placeId !== place) ||
            (activity && planned && activity.kind !== planned.activityKind)
              ? "absent"
              : "present",
          facts: [`${title}，${start}—${end}`],
          source: activity ? "activity" : planned ? "calendar" : "free_window",
          formed: captured.point,
          formedCapture: captured,
          recorded: readReal(),
        }),
      );
      life = {
        ...life,
        ...integrateLife(
          life as any,
          kind,
          Number(micros(end) - micros(start)) / 3_600_000_000,
        ),
        updatedWorldAt: end,
      };
      if (activity && (activity.end as TimePoint).at === end) {
        await put(
          tx,
          "activities",
          sid,
          {
            ...activity,
            status: "completed",
            completedAt: parseTimePoint({ domainId, at: end }),
          },
          activity.id as string,
          activity.revision as number,
        );
        if (activity.kind === "travel") place = activity.target;
      }
    }
    if (life.id)
      await put(
        tx,
        "lifeState",
        sid,
        life,
        life.id as string,
        life.revision as number,
      );
    else await put(tx, "lifeState", sid, life);
    await put(
      tx,
      "worlds",
      sid,
      { ...w, currentPlace: place, realizedThrough: at },
      w.id as string,
      w.revision as number,
    );
    return {
      time: parseTimePoint({ domainId, at }),
      capture: captured,
      events,
      needsRealization: [],
    };
  }
  async function situation(
    sid: string,
    fixed?: TimePoint,
    client: Kysely<Database> = db,
  ) {
    const w = await current(sid, client);
    if (!w)
      return {
        time: fixed ?? (await time.readCurrent({ subjectId: sid })).now.point,
        location: "本地会话",
        activity: null,
        life: { energy: 1, fatigue: 0, mood: "calm" },
        visible: [],
      };
    if (fixed && fixed.domainId !== w.domainId)
      problem(
        "invalid_input",
        "Situation point must belong to its World domain",
      );
    const point = fixed ?? (await currentPoint(w, sid)),
      at = point.at,
      until = addMicros(at, 86_400_000_000n),
      activities = await list(client, "activities", sid),
      rules = await list(client, "calendarRules", sid),
      exceptions = await list(client, "calendarExceptions", sid);
    const explicit = activities.find(
        (a) => a.status === "active" && a.end && (a.end as TimePoint).at > at,
      ),
      planned = expandCalendar(
        rules.filter((rule) => !rule.characterId),
        exceptions,
        String(w.id),
        at,
        until,
      ).find((o) => String(o.start) <= at && String(o.end) > at);
    const activity =
      explicit ??
      (planned
        ? {
            title: planned.title,
            kind: planned.activityKind,
            interruptibility: planned.interruptibility,
            demands: planned.demands,
            start: parseTimePoint({ domainId: w.domainId, at: planned.start }),
            end: parseTimePoint({ domainId: w.domainId, at: planned.end }),
          }
        : null);
    const characters = (w.package as WorldPackage).characters.map(
      (character) => {
        const planned = expandCalendar(
          rules.filter((rule) => rule.characterId === character.id),
          exceptions,
          String(w.id),
          at,
          until,
        ).find((o) => String(o.start) <= at && String(o.end) > at);
        const { privateNotes, ...publicFields } = character;
        return { ...publicFields, place: planned?.placeId ?? character.place };
      },
    );
    return {
      time: point,
      location: w.currentPlace,
      activity,
      life: (await list(client, "lifeState", sid))[0],
      visible: (w.package as WorldPackage).places.find(
        (p) => p.id === w.currentPlace,
      ),
      characters: characters.filter((c) => c.place === w.currentPlace),
    };
  }
  async function nextBoundary(sid: string) {
    const w = await current(sid);
    if (!w) {
      const now = (await time.readCurrent({ subjectId: sid })).now.point;
      return { ...now, at: addMicros(now.at, 3_600_000_000n) };
    }
    const at = (await currentPoint(w, sid)).at,
      view = await situation(sid);
    const occurrences = await calendar(sid, at, addMicros(at, 86_400_000_000n));
    const times = [
      addMicros(at, 3_600_000_000n),
      ...occurrences.flatMap((o) => [String(o.start), String(o.end)]),
      ...(view.activity?.end ? [(view.activity.end as TimePoint).at] : []),
    ].filter((t) => t > at);
    if (view.activity?.kind === "sleep" && view.activity.end)
      return view.activity.end as TimePoint;
    return parseTimePoint({ domainId: w.domainId, at: times.sort()[0] });
  }

  return {
    current,
    calendar,
    advanceIn,
    situation,
    nextBoundary,
    async preview(ctx: CallContext, input: unknown) {
      await authorize(ctx, "world.read");
      const p = worldPackage.parse(input);
      const keys = new Set(p.places.map((x) => x.key));
      const unresolved = [
        ...p.places.flatMap((p) =>
          p.neighbors.filter((n) => !keys.has(n.to)).map((n) => n.to),
        ),
        ...p.characters.filter((c) => !keys.has(c.place)).map((c) => c.place),
        ...(!keys.has(p.entryPoint) ? [p.entryPoint] : []),
      ];
      return {
        package: p,
        title: p.title,
        places: p.places.length,
        characters: p.characters.length,
        rules: p.calendar.length,
        unresolved,
        ready: unresolved.length === 0,
      };
    },
    async create(ctx: CallContext, input: unknown) {
      await authorize(ctx, "world.write");
      const p = worldPackage.parse(input),
        sid = subjectIdOf(ctx);
      if (!p.places.some((place) => place.key === p.entryPoint))
        problem("invalid_input", "Unknown entry point");
      const creationOperationId = ctx.trace.operationId;
      let configured: Awaited<ReturnType<Time["configureIn"]>> | undefined;
      const result = await idempotent(
        db,
        `world.create:${creationOperationId}`,
        p,
        async (tx) => {
          const worldId = v7(),
            domainId = `world:${v7()}`;
          await time.domains.createIn(
            tx,
            {
              ...ctx,
              trace: {
                ...ctx.trace,
                operationId: `${creationOperationId}:domain`,
              },
            },
            { domainId, label: p.title, subjectId: sid },
          );
          configured = await time.configureIn(
            tx,
            {
              ...ctx,
              trace: {
                ...ctx.trace,
                operationId: `${creationOperationId}:clock`,
              },
            },
            {
              subjectId: sid,
              domainId,
              expectedRevision: 0,
              initialAt: p.clock.initialAt,
              rate: p.clock.rate,
              offlinePolicy: p.clock.offlinePolicy,
            },
          );
          const subject = await tx
            .selectFrom("subjects")
            .select("id")
            .where("id", "=", sid)
            .forUpdate()
            .executeTakeFirst();
          if (!subject) problem("not_found", "Subject does not exist", 404);
          if ((await list(tx, "worlds", sid)).length)
            problem("conflict", "Subject already has world", 409);
          const { revision: clockRevision, ...identityRef } =
            configured.record.ref;
          await time.bindings.update(
            {
              ...ctx,
              trace: {
                ...ctx.trace,
                operationId: `${creationOperationId}:time-binding`,
              },
            },
            {
              scope: { kind: "subject", subjectId: sid },
              expectedRevision: 0,
              domainId,
              preferClock: identityRef,
            },
            tx,
          );
          const placeIds = new Map(p.places.map((place) => [place.key, v7()])),
            characterIds = new Map(
              p.characters.map((character) => [character.key, v7()]),
            );
          const adopted = {
            ...p,
            places: p.places.map((place) => ({
              ...place,
              id: placeIds.get(place.key)!,
              neighbors: place.neighbors.map((route) => ({
                ...route,
                to:
                  placeIds.get(route.to) ??
                  problem("invalid_input", "Unresolved route"),
              })),
            })),
            characters: p.characters.map((character) => ({
              ...character,
              id: characterIds.get(character.key)!,
              place:
                placeIds.get(character.place) ??
                problem("invalid_input", "Unresolved character place"),
            })),
          };
          const w = await put(
            tx,
            "worlds",
            sid,
            {
              title: p.title,
              package: adopted,
              currentPlace: placeIds.get(p.initialState?.place ?? p.entryPoint),
              realizedThrough: p.clock.initialAt,
              domainId,
              clockRef: identityRef,
              timezone: p.clock.timezone,
              creationOperationId,
            },
            worldId,
          );
          for (const rule of p.calendar) {
            const ruleId = v7();
            await put(
              tx,
              "calendarRules",
              sid,
              {
                ...validateCalendarRule(rule),
                seriesId: ruleId,
                version: 1,
                placeId: rule.placeId ? placeIds.get(rule.placeId) : undefined,
                characterId: rule.characterId
                  ? characterIds.get(rule.characterId)
                  : undefined,
                worldId: w.id,
              },
              ruleId,
            );
          }
          await put(tx, "lifeState", sid, {
            energy: p.initialState?.energy ?? 1,
            fatigue: p.initialState?.fatigue ?? 0,
            mood: p.initialState?.mood ?? "calm",
            focus: "",
            updatedWorldAt: p.clock.initialAt,
          });
          return w;
        },
        sid,
      );
      if (configured) time.notifyChanged(configured);
      return result;
    },
    async hostStart() {
      await time.start();
    },
    async hostStop() {
      await time.stop();
    },
    async currentTime(ctx: CallContext) {
      await authorize(ctx, "world.read");
      const w = await current(subjectIdOf(ctx));
      return (
        await time.read(ctx, w ? selection(w, subjectIdOf(ctx)) : undefined)
      ).now.point;
    },
    async inspect(ctx: CallContext) {
      await authorize(ctx, "world.read");
      return {
        world: await current(subjectIdOf(ctx)),
        situation: await situation(subjectIdOf(ctx)),
      };
    },
    async advance(ctx: CallContext, target?: string) {
      await authorize(ctx, "world.write");
      return db.transaction().execute((tx) => advanceIn(tx, ctx, target));
    },
    async addCalendar(ctx: CallContext, input: unknown) {
      await authorize(ctx, "world.write");
      const id = v7();
      return put(
        db,
        "calendarRules",
        subjectIdOf(ctx),
        { ...validateCalendarRule(input), seriesId: id, version: 1 },
        id,
      );
    },
    async changeCalendar(
      ctx: CallContext,
      id: string,
      input: {
        scope: "this" | "future" | "all";
        recurrenceId?: string;
        cancelled?: boolean;
        rule?: unknown;
        start?: string;
        end?: string;
        expectedRevision: number;
      },
    ) {
      await authorize(ctx, "world.write");
      if (input.scope === "this") {
        if (!input.recurrenceId)
          problem(
            "invalid_input",
            "Instance edit needs original local recurrenceId",
          );
        return put(db, "calendarExceptions", subjectIdOf(ctx), {
          ...input,
          ruleId: id,
        });
      }
      const old = await read(db, "calendarRules", subjectIdOf(ctx), id);
      const next = validateCalendarRule(input.rule);
      return db.transaction().execute(async (tx) => {
        if (input.scope === "future") {
          if (!input.recurrenceId)
            problem("invalid_input", "Future edit needs recurrenceId");
          await put(
            tx,
            "calendarRules",
            subjectIdOf(ctx),
            { ...old, untilRecurrenceId: input.recurrenceId },
            id,
            input.expectedRevision,
          );
          if (next.start !== old.start)
            problem(
              "invalid_input",
              "Future versions retain original DTSTART; change startShiftSeconds",
            );
          return put(tx, "calendarRules", subjectIdOf(ctx), {
            ...next,
            seriesId: old.seriesId ?? old.id,
            version: Number(old.version ?? 1) + 1,
            effectiveFromRecurrenceId: input.recurrenceId,
          });
        }
        return put(
          tx,
          "calendarRules",
          subjectIdOf(ctx),
          {
            ...next,
            seriesId: old.seriesId ?? old.id,
            version: Number(old.version ?? 1) + 1,
          },
          id,
          input.expectedRevision,
        );
      });
    },
    async timeline(ctx: CallContext, from: string, to: string) {
      await authorize(ctx, "world.read");
      return {
        planned: await calendar(subjectIdOf(ctx), from, to),
        lived: (await list(db, "realizedEvents", subjectIdOf(ctx))).filter(
          (e) => String(e.end) > from && String(e.start) < to,
        ),
      };
    },
    async realize(ctx: CallContext, input: Json) {
      await authorize(ctx, "world.write");
      return db.transaction().execute(async (tx) => {
        const capture = await time.captureIn(tx, ctx, {
          operationId: `${ctx.trace.operationId}:world.realize.formed`,
        });
        return put(tx, "realizedEvents", subjectIdOf(ctx), {
          ...input,
          formed: capture.point,
          formedCapture: capture,
          recorded: readReal(),
          source: "author",
        });
      });
    },
    async correct(ctx: CallContext, id: string, input: Json) {
      await authorize(ctx, "world.write");
      return db.transaction().execute(async (tx) => {
        const capture = await time.captureIn(tx, ctx, {
            operationId: `${ctx.trace.operationId}:world.correct.formed`,
          }),
          old = await read(tx, "realizedEvents", subjectIdOf(ctx), id);
        return put(tx, "realizedEvents", subjectIdOf(ctx), {
          ...old,
          ...input,
          corrects: makeRef(
            installationId,
            subjectIdOf(ctx),
            "event",
            id,
            old.revision as number,
          ),
          formed: capture.point,
          formedCapture: capture,
          recorded: readReal(),
        });
      });
    },
    async observe(ctx: CallContext) {
      await authorize(ctx, "world.observe");
      return db.transaction().execute(async (tx) => {
        const advanced = await advanceIn(tx, ctx, undefined, "observe");
        return {
          ...(await situation(subjectIdOf(ctx), advanced.capture.point, tx)),
          observedCapture: advanced.capture,
        };
      });
    },
    async act(
      ctx: CallContext,
      input: {
        kind: "move" | "rest" | "participate" | "talk";
        target: string;
        minutes?: number;
      },
    ) {
      await authorize(ctx, "world.act");
      const sid = subjectIdOf(ctx),
        w = await current(sid);
      if (!w) problem("not_found", "No world", 404);
      return db.transaction().execute(async (tx) => {
        const capture = await time.captureIn(tx, ctx, {
            operationId: `${ctx.trace.operationId}:activity.start`,
            selection: selection(w, sid),
          }),
          at = capture.point.at;
        if (input.kind === "move") {
          const p = w.package as WorldPackage,
            place = p.places.find((p) => p.id === w.currentPlace),
            route = place?.neighbors.find((r) => r.to === input.target);
          if (!route) problem("invalid_input", "No route to target");
          return put(tx, "activities", sid, {
            title: `前往 ${input.target}`,
            kind: "travel",
            target: input.target,
            start: capture.point,
            end: parseTimePoint({
              domainId: w.domainId,
              at: addMinutes(at, route.minutes),
            }),
            formedCapture: capture,
            status: "active",
            interruptibility: "brief",
          });
        }
        return put(tx, "activities", sid, {
          title: input.target,
          kind: input.kind === "rest" ? "rest" : "other",
          target: input.target,
          start: capture.point,
          end: parseTimePoint({
            domainId: w.domainId,
            at: addMinutes(at, input.minutes ?? 30),
          }),
          formedCapture: capture,
          interruptibility: input.kind === "rest" ? "open" : "brief",
          status: "active",
        });
      });
    },
    async interrupt(ctx: CallContext, id: string, reason: string) {
      await authorize(ctx, "activities.write");
      const sid = subjectIdOf(ctx);
      return db.transaction().execute(async (tx) => {
        const capture = await time.captureIn(tx, ctx, {
            operationId: `${ctx.trace.operationId}:activity.suspend`,
          }),
          old = await read(tx, "activities", sid, id);
        const remaining = old.end
          ? micros((old.end as TimePoint).at) - micros(capture.point.at)
          : undefined;
        return put(
          tx,
          "activities",
          sid,
          {
            ...old,
            status: "suspended",
            remainingMicros:
              remaining === undefined
                ? undefined
                : (remaining > 0n ? remaining : 0n).toString(),
            suspendedAt: capture.point,
            suspendedCapture: capture,
            resumeCue: { goal: old.title, reason, progress: old.progress },
          },
          id,
          old.revision as number,
        );
      });
    },
    async resume(ctx: CallContext, id: string) {
      await authorize(ctx, "activities.write");
      const sid = subjectIdOf(ctx);
      return db.transaction().execute(async (tx) => {
        const capture = await time.captureIn(tx, ctx, {
            operationId: `${ctx.trace.operationId}:activity.resume`,
          }),
          old = await read(tx, "activities", sid, id);
        if (old.status !== "suspended")
          problem("conflict", "Only a suspended activity can resume", 409);
        return put(
          tx,
          "activities",
          sid,
          {
            ...old,
            status: "active",
            resumedAt: capture.point,
            resumedCapture: capture,
            start: capture.point,
            ...(old.remainingMicros !== undefined
              ? {
                  end: {
                    ...capture.point,
                    at: addMicros(
                      capture.point.at,
                      BigInt(String(old.remainingMicros)),
                    ),
                  },
                }
              : {}),
          },
          id,
          old.revision as number,
        );
      });
    },
  };
}
