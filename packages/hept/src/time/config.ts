import { z } from "zod";
import { ClockRefSchema } from "@nous-wave/contracts/time";
import type { SettingsModule } from "@nous-wave/platform/settings";
export const TimeReferenceSchema = z
  .strictObject({
    domainId: z.string().min(1),
    clockRef: ClockRefSchema.omit({ revision: true }).nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.domainId === "real"
        ? value.clockRef !== null
        : value.clockRef === null
    )
      ctx.addIssue({
        code: "custom",
        message: "现实域无映射；其他域必须绑定正式Clock身份",
      });
  });
export const timeSettingsModule: SettingsModule<
  z.infer<typeof TimeReferenceSchema>
> = {
  id: "time.reference",
  owner: "time",
  definitionRevision: "1",
  schema: TimeReferenceSchema,
  defaults: { domainId: "real", clockRef: null },
  fields: Object.fromEntries(
    ["domainId", "clockRef"].map((field) => [
      `/${field}`,
      {
        labelKey: `time.${field}`,
        descriptionKey: `time.${field}.description`,
        scopes: ["installation", "subject"],
        visibility: "advanced",
        effect: "next_call",
        consumerIds: ["time.clock"],
      },
    ]),
  ) as SettingsModule["fields"],
};
