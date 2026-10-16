// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Explicit administrator Clock operations through the sole official Nous Client. @module world-clock */
import { NousError, type NousClient } from "@nous-wave/client";
import { managementProblem } from "@heptalogos/management";
import { timestampFromDate } from "@nous-wave/client/host-bridge";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { readWorldSchema, worldPointSchema } from "@heptalogos/subject";
const object = { additionalProperties: false } as const;
/** Configuring a Clock is an explicit management action; adopting a profile never silently migrates an old Subject. */
export const worldClockConfigurationSchema = Type.Object(
  {
    subjectId: readWorldSchema.properties.subjectId,
    operationId: readWorldSchema.properties.worldId,
    timeDomainRef: worldPointSchema.properties.timeDomainRef,
    rate: Type.Number({ minimum: 0 }),
    worldTime: worldPointSchema.properties.at,
  },
  object,
);
/** A JSON view of the actual official Clock receipt, with bigint revision preserved as a string. */
export const worldClockStatusSchema = Type.Object(
  {
    subjectId: readWorldSchema.properties.subjectId,
    timeDomainRef: worldPointSchema.properties.timeDomainRef,
    rate: Type.Number({ minimum: 0 }),
    revision: Type.String({ pattern: "^[0-9]+$" }),
    world: worldPointSchema,
    recordedAt: worldPointSchema.properties.at,
  },
  object,
);
type Clock = Awaited<ReturnType<NousClient["clocks"]["readClock"]>>;
function view(clock: Clock): Static<typeof worldClockStatusSchema> {
  const stamp = clock.now;
  if (!stamp?.at || !stamp.recordedAt || stamp.timeDomainRef !== clock.timeDomainRef)
    throw Error("official_clock_stamp_unavailable");
  const instant = (value: { seconds: bigint; nanos: number }) =>
    new Date(Number(value.seconds) * 1000 + value.nanos / 1e6).toISOString();
  return {
    subjectId: clock.subjectId,
    timeDomainRef: clock.timeDomainRef,
    rate: clock.rate,
    revision: String(clock.revision),
    world: { timeDomainRef: clock.timeDomainRef, at: instant(stamp.at) },
    recordedAt: instant(stamp.recordedAt),
  };
}
/** Neither operation starts a model, rewrites biography, or creates a local Clock. */
export function createWorldClockManagement(options: {
  nous: () => Promise<Pick<NousClient, "clocks">>;
}) {
  const invoke = async (
    operation: (clocks: NousClient["clocks"]) => Promise<Clock>,
  ) => {
    try {
      return view(await operation((await options.nous()).clocks));
    } catch (error) {
      if (error instanceof NousError) {
        if (
          ["ABORTED", "ALREADY_EXISTS", "FAILED_PRECONDITION"].includes(error.codeName)
        )
          throw managementProblem(
            "world.clock_conflict",
            "Official Clock rejected this change",
            "Read the current domain and world point before changing an existing Subject",
            "conflict",
          );
        if (error.codeName === "INVALID_ARGUMENT")
          throw managementProblem(
            "world.clock_invalid",
            "Invalid official Clock request",
            "Use the declared world domain, a canonical world instant and a non-negative rate",
            "validation",
          );
      }
      throw error;
    }
  };
  return {
    async read(subjectId: string) {
      return invoke((clocks) => clocks.readClock({ subjectId }, { timeoutMs: 5000 }));
    },
    async configure(input: Static<typeof worldClockConfigurationSchema>) {
      return invoke((clocks) =>
        clocks.configureClock(
          { ...input, worldTime: timestampFromDate(new Date(input.worldTime)) },
          { timeoutMs: 5000 },
        ),
      );
    },
  };
}
/** Public application composition type; clock authority stays in Nous. */
export type WorldClockManagement = ReturnType<typeof createWorldClockManagement>;
