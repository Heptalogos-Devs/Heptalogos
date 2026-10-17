// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Selects actual Activity input and invokes one already-owned native run.
 * @module activity-dispatch
 */
import { randomUUID } from "node:crypto";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { managementProblem } from "@heptalogos/management";
import type { MessagingService } from "@heptalogos/messaging";
import type { IdentityService } from "@heptalogos/identity";
import type { createLifeService, LifeActivity } from "@heptalogos/subject";
import type { NousClient } from "@nous-wave/client";
import {
  encodeObservationInput,
  timestampFromDate,
  encodeCognitionUsage,
} from "@nous-wave/client/host-bridge";
import { deliberationDecisionSchema } from "@heptalogos/subject";
import { type RoleInvocation } from "./subject-roles.js";
import type { createNativeCognitionBridge } from "./native-cognition.js";
import type { createChannelRouteStore } from "./channel-routes.js";
import type { GatewayScope } from "./gateway-contracts.js";
import type { createSelectedMediaUploader } from "./selected-media.js";
import {
  activityDispatchInputSchema,
  type ActivityDispatchInput,
  type ActivityDispatchResult,
} from "./activity-dispatch-contracts.js";
/** All dependencies are existing semantic owners; the dispatcher owns no model loop. */
export interface ActivityDispatchOptions {
  readonly prepareMedia?: ReturnType<typeof createSelectedMediaUploader>;
  readonly life: Pick<ReturnType<typeof createLifeService>, "get" | "worldNow">;
  readonly messaging: Pick<MessagingService, "prepareRead" | "resolveConversations">;
  readonly identity: Pick<
    IdentityService,
    "resolveAccount" | "resolveGroup" | "readSubjectEntity"
  >;
  readonly native: Pick<
    ReturnType<typeof createNativeCognitionBridge>,
    "registerInput" | "readDispatch" | "finishDispatch" | "flushPendingFeedback"
  >;
  readonly routes: Pick<ReturnType<typeof createChannelRouteStore>, "read">;
  readonly scope: () => Promise<GatewayScope>;
  readonly authorizeActivity: (activity: LifeActivity) => Promise<void>;
  readonly nous: () => Promise<{
    runtime: {
      getWorkContext: (
        ...args: Parameters<NousClient["runtime"]["getWorkContext"]>
      ) => Promise<{
        workContext?: Pick<
          NonNullable<
            Awaited<ReturnType<NousClient["runtime"]["getWorkContext"]>>["workContext"]
          >,
          "subjectId" | "workContextId" | "state"
        >;
      }>;
    };
  }>;
  /** External selections notify the one foreground; they never read or invoke independently. */
  readonly wake: (input: {
    subjectId: string;
    naturalOpportunity: boolean;
  }) => Promise<{ runId?: string }>;
  readonly now: () => string;
}
function denied(detail: string): never {
  throw managementProblem(
    "gateway.activity_dispatch_denied",
    "Activity native dispatch denied",
    detail,
    "authorization",
  );
}
/** A service-only exact selection: no prompt, model role, source grants or tool permissions in input. */
export function createActivityDispatcher(options: ActivityDispatchOptions) {
  const codec = compileSchema<ActivityDispatchInput>(activityDispatchInputSchema);
  return {
    async dispatch(value: ActivityDispatchInput): Promise<ActivityDispatchResult> {
      const checked = compileSchema<ActivityDispatchInput>(
        activityDispatchInputSchema,
      ).validate(value);
      if (!checked.ok) denied("Use an exact adopted Activity notification");
      const result = await options.wake({
        subjectId: checked.value.subjectId,
        naturalOpportunity: true,
      });
      const actual = result.runId
        ? await options.native.readDispatch(checked.value.subjectId, result.runId)
        : undefined;
      if (!actual)
        denied(
          "The global foreground retained its current focus or no actual native call was selected",
        );
      return actual;
    },
    /** Only the Reactor's actual read action calls this exact permission-checked material path. */
    async prepare(value: ActivityDispatchInput): Promise<RoleInvocation> {
      const checked = codec.validate(value);
      if (!checked.ok)
        denied("Use an exact adopted Activity and bounded real message selection");
      const input = checked.value;
      const requestDigest = digestCanonicalJson(
        "host.activity-dispatch.v1",
        input as unknown as CanonicalJsonValue,
      ).hex;
      const current = await options.scope();
      if (input.subjectId !== current.subjectId)
        denied("The current Subject binding differs");
      const activity = await options.life.get(input.subjectId, input.activityId);
      if (
        !activity ||
        activity.state !== "active" ||
        activity.continuationRequired ||
        !activity.adoptedBy ||
        !activity.scope ||
        !activity.workContextId
      )
        denied(
          "Only an explicitly continued active adopted Activity with its existing WorkContext can dispatch",
        );
      await options.authorizeActivity(activity);
      const target = activity.scope.conversations.find(
        (c) => c.conversationRef === input.conversationRef,
      );
      if (!target?.operations.includes("observe"))
        denied("The selected target requires adopted observe permission");
      const conversationId = input.conversationRef.slice(
        "conversation:heptalogos:".length,
      );
      const authorized = await options.messaging.resolveConversations({
        conversations: current.conversations
          .filter((grant) => grant.receive && grant.observe)
          .map((grant) => ({
            platform: "qq",
            accountId: current.accountId,
            kind: grant.kind,
            conversationId: grant.conversationId,
          })),
      });
      if (!authorized.conversationIds.includes(conversationId))
        denied("The exact target has no current operator observe grant");
      if (!input.messageRefs.length)
        denied("A read action requires its actual bounded message selection");
      const prepared = input.messageRefs.length
        ? await options.messaging.prepareRead({
            messageRefs: input.messageRefs,
            audience: { subjectId: input.subjectId, conversationIds: [conversationId] },
            budget: { maxMessages: 64, maxBytes: 1024 * 1024 },
          })
        : { materials: [], omitted: [], coverage: undefined };
      if (
        prepared.omitted.length ||
        prepared.materials.length !== input.messageRefs.length ||
        prepared.materials.some(
          (m) =>
            m.conversationId !== conversationId ||
            m.withheld ||
            m.lifecycle !== "present",
        )
      )
        denied(
          "Exact current source materials are unavailable or exceed the bounded read; choose a smaller actual selection",
        );
      let actual = prepared.materials[0]?.conversation;
      if (!actual) {
        for (const candidate of current.conversations.filter(
          (c) => c.receive && c.observe,
        )) {
          const native = {
            platform: "qq",
            accountId: current.accountId,
            kind: candidate.kind,
            conversationId: candidate.conversationId,
          };
          const found = await options.messaging.resolveConversations({
            conversations: [native],
          });
          if (found.conversationIds.includes(conversationId)) {
            actual = native;
            break;
          }
        }
      }
      if (!actual) denied("The actual conversation metadata is unavailable");
      const grant = current.conversations.find(
        (c) => c.kind === actual.kind && c.conversationId === actual.conversationId,
      );
      if (
        actual.platform !== "qq" ||
        actual.accountId !== current.accountId ||
        !grant?.receive ||
        !grant.observe
      )
        denied(
          "Current operator grants must explicitly authorize this exact account/target for observation",
        );
      const route = await options.routes.read({
        kind: actual.kind,
        id: actual.conversationId,
      });
      if (
        route.accountId !== current.accountId ||
        route.nativeAgentId !== current.nativeAgentId
      )
        denied("The actual native route changed");
      const work = (
        await (
          await options.nous()
        ).runtime.getWorkContext(
          { subjectId: input.subjectId, workContextId: activity.workContextId },
          { timeoutMs: 5000 },
        )
      ).workContext;
      if (
        !work ||
        work.subjectId !== input.subjectId ||
        work.workContextId !== activity.workContextId ||
        work.state !== "open"
      )
        denied("The Activity's current same-Subject Nous WorkContext must be open");
      const self = (
        await options.identity.readSubjectEntity({ subjectId: input.subjectId })
      ).entity;
      if (!self || self.entityRef !== activity.adoptedBy)
        denied("Only the current actual bound Subject actor can dispatch");
      const group =
        actual.kind === "group"
          ? await options.identity.resolveGroup({
              platform: "qq",
              groupId: actual.conversationId,
            })
          : undefined;
      const authors = new Map<string, string>();
      for (const material of prepared.materials) {
        const author = await options.identity.resolveAccount({
          platform: "qq",
          accountId: material.author.accountId,
          ...(material.author.uid ? { uid: material.author.uid } : {}),
        });
        if (material.author.entityRef && material.author.entityRef !== author.entityRef)
          denied(
            "The recorded actual author identity differs from its formal account binding",
          );
        authors.set(material.messageId, author.entityRef);
      }
      const selected = prepared.materials.map((m) => ({
        ...m,
        author: { ...m.author, entityRef: authors.get(m.messageId)! },
      }));
      const usage = {
        agentInstanceId: input.requestId,
        purpose: "subject_deliberation",
        intent: activity.purpose,
        audience: {
          conversationRef: input.conversationRef,
          visibility: actual.kind === "group" ? "group" : "direct",
          channelRef: "heptalogos-qq",
          ...(group ? { groupEntityRef: group.entityRef } : {}),
        },
        participants: [...new Set(authors.values())].map((entityRef) => ({
          entityRef,
          role: "speaker",
        })),
        sourceRead: {
          subjectId: input.subjectId,
          sourceRefs: [{ kind: "work_context", value: activity.workContextId }],
          originConversationRefs: [input.conversationRef],
        },
      };
      const contacts = selected.map((material) => ({
        contactRef: "message:" + material.messageId,
        observation: encodeObservationInput({
          subjectId: input.subjectId,
          requestId: randomUUID(),
          sourceClass: "message",
          externalObjectRef: "object:heptalogos:message:" + material.messageId,
          conversationRef: input.conversationRef,
          actorEntityRef: authors.get(material.messageId)!,
          entities: [
            ...new Set([
              authors.get(material.messageId)!,
              ...(group ? [group.entityRef] : []),
            ]),
          ].map((entityRef) => ({ entityRef, surface: entityRef })),
          observedAt: timestampFromDate(new Date(options.now())),
          ...(material.platformSentAt
            ? {
                occurredTime: {
                  timeDomainRef: "time:real",
                  extent: {
                    value: {
                      case: "instant",
                      value: timestampFromDate(new Date(material.platformSentAt)),
                    },
                  },
                },
              }
            : {}),
          material: {
            case: "inlineText",
            value: { text: JSON.stringify(material), mediaType: "application/json" },
          },
          context: {
            message_ref: "message:" + material.messageId,
            activity_ref: activity.activityId,
            platform_sent_at: material.platformSentAt,
            host_received_at: material.receivedAt,
            actual_author: material.author,
            lifecycle: material.lifecycle,
            source_read: {
              partial: false,
              ...(prepared.coverage ? { coverage: prepared.coverage } : {}),
            },
          },
          admit: false,
        }),
      }));
      if (options.prepareMedia)
        contacts.push(
          ...(await options.prepareMedia(input.subjectId, selected, contacts)),
        );
      return {
        requestId: input.requestId,
        requestDigest,
        subjectId: input.subjectId,
        activityId: activity.activityId,
        role: "subject.deliberation",
        context: {
          trigger: { kind: "message" },
          selectedMessages: selected,
          outputContract: deliberationDecisionSchema,
        },
        contacts,
        sourceRefs: input.messageRefs.map((ref) => "message:" + ref),
        messageRefs: input.messageRefs,
        usage: encodeCognitionUsage(usage),
      };
    },
  };
}
