// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Canonical initial settings are actual read material, never invented lived events.
 * @module native-profile-source
 */
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import type {
  AdoptedWorldProfile,
  createWorldProfileService,
} from "@heptalogos/subject";
import { v5 as uuidv5 } from "uuid";
import { managementProblem } from "@heptalogos/management";
import {
  decodeObservationInput,
  encodeObservationInput,
  type HostPrepareResponse,
} from "@nous-wave/client/host-bridge";
import type { Registration } from "./native-cognition.js";
/** Only the original entry setting is readable; actor secrets, rules and the rest of the profile stay out. */
function initialSettingMaterial(profile: AdoptedWorldProfile) {
  return {
    kind: "initial_setting",
    worldId: profile.worldId,
    sourceRef: profile.entrySourceRef,
    entryRecordedAt: profile.entryRecordedAt,
    timeDomainRef: profile.profile.timeDomainRef,
    entry: profile.profile.entry,
  };
}
/** Model arguments cannot mint a profile source or alter its original adopted setting. */
export async function hasCanonicalProfileSources(
  registration: Registration,
  profiles: Pick<ReturnType<typeof createWorldProfileService>, "read">,
  tx?: PersistenceInternalTransaction,
): Promise<boolean> {
  for (const contact of registration.contacts) {
    if (!contact.contactRef.startsWith("world-profile:")) continue;
    const match = /^world-profile:([0-9a-f-]{36}):1$/i.exec(contact.contactRef);
    if (!match) return false;
    const profile = await profiles.read(registration.subjectId, match[1]!, tx);
    const observation = decodeObservationInput(contact.observation);
    if (
      !profile ||
      profile.entrySourceRef !== contact.contactRef ||
      observation.subjectId !== profile.subjectId ||
      observation.actorEntityRef !== profile.subjectActorRef ||
      observation.sourceClass !== "initial_setting" ||
      observation.externalObjectRef !== "object:" + contact.contactRef ||
      observation.worldRealized ||
      observation.occurredTime?.extent?.value.case ||
      observation.context?.source_nature !== "initial_setting" ||
      observation.context.world_profile_ref !== profile.entrySourceRef ||
      observation.material.case !== "inlineText" ||
      observation.material.value.mediaType !== "application/json"
    )
      return false;
    try {
      const actual = JSON.parse(observation.material.value.text) as CanonicalJsonValue;
      if (
        digestCanonicalJson("native.initial-setting.v1", actual).hex !==
        digestCanonicalJson(
          "native.initial-setting.v1",
          initialSettingMaterial(profile),
        ).hex
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Reading adopted settings is a contact with a declaration, not an assertion that a past life occurred. */
export async function readInitialSettingSource(
  options: {
    profiles: Pick<ReturnType<typeof createWorldProfileService>, "read">;
    hasAcceptedSource: (subjectId: string, sourceRef: string) => Promise<boolean>;
  },
  input: { subjectId: string; sourceRef: string; nativeRunId: string },
): Promise<{
  contacts: HostPrepareResponse["contacts"];
  context: Record<string, unknown>;
}> {
  const match = /^world-profile:([0-9a-f-]{36}):1$/i.exec(input.sourceRef);
  const profile = match
    ? await options.profiles.read(input.subjectId, match[1]!)
    : undefined;
  if (!profile || profile.entrySourceRef !== input.sourceRef)
    throw managementProblem(
      "reactor.source_denied",
      "Entry setting unavailable",
      "Read the exact original same-Subject adopted entry",
      "conflict",
      "after-change",
    );
  const material = initialSettingMaterial(profile),
    already = await options.hasAcceptedSource(input.subjectId, input.sourceRef);
  return {
    contacts: already
      ? []
      : [
          {
            contactRef: input.sourceRef,
            observation: encodeObservationInput({
              subjectId: input.subjectId,
              requestId: uuidv5(
                input.sourceRef + ":" + input.nativeRunId,
                "e51d00a4-cd3f-47ef-9fde-bdbb52d51099",
              ),
              sourceClass: "initial_setting",
              externalObjectRef: "object:" + input.sourceRef,
              actorEntityRef: profile.subjectActorRef,
              material: {
                case: "inlineText",
                value: {
                  text: JSON.stringify(material),
                  mediaType: "application/json",
                },
              },
              context: {
                source_nature: "initial_setting",
                world_profile_ref: input.sourceRef,
                entry_recorded_at: profile.entryRecordedAt,
              },
              admit: false,
            }),
          },
        ],
    context: { initialSetting: material, retrievalOnly: already },
  };
}
