// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared realized-world energy classification and explicit profile units.
 * @module world-energy-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
const object = { additionalProperties: false } as const;
/** Same adopted activity kinds classify planned routines and realized energy. */
export const worldEnergyKindSchema = Type.Union([
  Type.Literal("study"),
  Type.Literal("social"),
  Type.Literal("rest"),
  Type.Literal("sleep"),
  Type.Literal("ordinary"),
  Type.Literal("entertainment"),
]);
/** Rates are signed energy points per realized world hour, distinct from real compute budgets. */
export const worldEnergyProfileSchema = Type.Object(
  {
    initial: Type.Number({ minimum: 0, maximum: 100 }),
    unit: Type.Literal("per_world_hour"),
    rates: Type.Object(
      {
        study: Type.Number(),
        social: Type.Number(),
        rest: Type.Number(),
        sleep: Type.Number(),
        ordinary: Type.Number(),
        entertainment: Type.Number(),
      },
      object,
    ),
    subsidiaryBurdenRatio: Type.Number({ minimum: 0, maximum: 1 }),
    maxEventDelta: Type.Number({ minimum: 0, maximum: 10 }),
  },
  object,
);
/** Adopted engineering defaults apply only when the operator chooses this profile. */
export const DEFAULT_WORLD_ENERGY: Static<typeof worldEnergyProfileSchema> = {
  initial: 80,
  unit: "per_world_hour",
  rates: { study: -8, social: -4, rest: 12, sleep: 16, ordinary: 0, entertainment: 0 },
  subsidiaryBurdenRatio: 0.25,
  maxEventDelta: 10,
};
/** Activity energy metadata is adopted with its actual world event and cannot count the same interval twice. */
export const worldEventEnergySchema = Type.Object(
  {
    kind: worldEnergyKindSchema,
    participation: Type.Union([Type.Literal("primary"), Type.Literal("subsidiary")]),
    delta: Type.Number({ minimum: -10, maximum: 10 }),
    reason: Type.String({ maxLength: 16384 }),
  },
  object,
);
