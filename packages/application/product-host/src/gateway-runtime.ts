// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Composes current channel, Life and cognition owners without an agent loop.
 * @module gateway-runtime
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { PersistenceService } from "@heptalogos/persistence";
import { createMessagingService } from "@heptalogos/messaging";
import { createIdentityService } from "@heptalogos/identity";
import {
  createLifeService,
  createAgencyService,
  assertScopeWithin,
  type ActivityScope,
} from "@heptalogos/subject";
import { managementProblem, type ProductManagement } from "@heptalogos/management";
import { createArchiveStore } from "./archive-store.js";
import { createChannelRouteStore } from "./channel-routes.js";
import { createNativeCognitionBridge } from "./native-cognition.js";
import { connectProductNous } from "./nous.js";
import { createActivityOpportunity } from "./activity-opportunity.js";
import { createSelectedMediaUploader } from "./selected-media.js";
import { decodeCognitionUsage } from "@nous-wave/client/host-bridge";
import {
  hasCanonicalNativeMessages,
  hasAuthorizedNativeSources,
} from "./native-source-selection.js";
import { createActivityDispatcher } from "./activity-dispatch.js";
import type { NativeActivityDispatch } from "./activity-dispatch-contracts.js";
import type { GatewayScope } from "./gateway-contracts.js";
import type { GatewayHttpOptions } from "./gateway-http.js";
/** Existing Host lifecycle and current authenticated settings remain the owners. */
export interface GatewayRuntimeOptions {
  readonly dispatchNativeActivity?: NativeActivityDispatch;
  readonly persistence: PersistenceService;
  readonly product: Pick<ProductManagement, "configuration">;
  readonly secretRoot: string;
  readonly dataRoot: string;
  readonly now: () => string;
  readonly runMutation: GatewayHttpOptions["runMutation"];
}
function denied(detail: string): never {
  throw managementProblem(
    "gateway.scope_denied",
    "Current channel scope does not allow this operation",
    detail,
    "authorization",
  );
}
async function cognitionRead<T>(invoke: () => Promise<T>): Promise<T> {
  try {
    return await invoke();
  } catch (error) {
    if (error instanceof Error && "problem" in error) throw error;
    throw managementProblem(
      "gateway.cognition_unavailable",
      "The actual cognition dependency is unavailable",
      "Inspect the configured Nous service and required public operation",
      "unavailable",
      "after-change",
    );
  }
}
/** Creates or reuses only the dedicated local Channel credential; never an administrator session. */
async function serviceCredential(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "channel-service-token");
  try {
    await writeFile(path, randomBytes(32).toString("hex") + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  const stat = await lstat(path);
  if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0))
    throw Error("Channel credential requires a private regular file");
  const token = (await readFile(path, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(token))
    throw Error("Channel service credential is invalid");
  const expected = createHash("sha256").update(token).digest();
  return async (supplied: string | undefined) => {
    if (
      !supplied ||
      !timingSafeEqual(createHash("sha256").update(supplied).digest(), expected)
    )
      throw managementProblem(
        "gateway.service_invalid",
        "Invalid Channel service credential",
        "Use this installation's protected Channel service credential",
        "authentication",
      );
  };
}
/** Initializes only local owners; models, QQ and Nous need not be online to start Management. */
export async function createGatewayRuntime(options: GatewayRuntimeOptions) {
  const messaging = createMessagingService({ persistence: options.persistence });
  const identity = createIdentityService({ persistence: options.persistence });
  const scope = async (): Promise<GatewayScope> => {
    const current = await options.product.configuration();
    const settings = current.settings;
    if (!settings?.subject.id || !settings.qq || !current.revision)
      throw managementProblem(
        "gateway.unconfigured",
        "Channel authorization is not configured",
        "Bind the Subject and explicitly configure the installation's QQ grants",
        "unavailable",
      );
    return {
      subjectId: settings.subject.id,
      revision: current.revision,
      ...settings.qq,
    };
  };
  const nous = async () => {
    const current = await options.product.configuration();
    if (!current.settings)
      throw managementProblem(
        "gateway.unconfigured",
        "Nous binding is not configured",
        "Configure the official Nous discovery binding",
        "unavailable",
      );
    return connectProductNous(current.settings);
  };
  const self = async (subjectId: string, actor: string) => {
    const current = await scope();
    if (current.subjectId !== subjectId)
      denied("The operation names a different Subject");
    const binding = await identity.readSubjectEntity({ subjectId });
    if (binding.entity?.entityRef !== actor)
      denied("Only the actual bound Subject actor may adopt native work");
    return current;
  };
  const authority = async (
    subjectId: string,
    actor: string,
    requested: ActivityScope,
  ): Promise<ActivityScope> => {
    const current = await self(subjectId, actor);
    const conversations: ActivityScope["conversations"] = [];
    const readableIds: string[] = [];
    for (const grant of current.conversations) {
      if (!grant.receive) continue;
      const found = await messaging.resolveConversations({
        conversations: [
          {
            platform: "qq",
            accountId: current.accountId,
            kind: grant.kind,
            conversationId: grant.conversationId,
          },
        ],
      });
      for (const id of found.conversationIds) {
        if (grant.observe) readableIds.push(id);
        const operations: ActivityScope["conversations"][number]["operations"] =
          grant.observe ? ["observe"] : [];
        for (const effect of grant.effects)
          if (
            effect === "send" ||
            effect === "edit" ||
            effect === "withdraw" ||
            effect === "moderate"
          )
            operations.push(effect);
        conversations.push({
          conversationRef: "conversation:heptalogos:" + id,
          operations,
        });
      }
    }
    const messageRefs = requested.sourceRefs.flatMap(
      (ref) => /^message:([0-9a-f-]{36})$/i.exec(ref)?.[1] ?? [],
    );
    const material = messageRefs.length
      ? await messaging.messageSources({ messageRefs, conversationIds: readableIds })
      : { sources: [] };
    const sources = new Set(current.sourceRefs);
    for (const source of material.sources)
      if (source.lifecycle === "present") sources.add("message:" + source.messageRef);
    return {
      conversations,
      tools: current.tools,
      sourceRefs: [...sources],
      maxRunMs: current.maxRunMs,
    };
  };
  const life = createLifeService({
    persistence: options.persistence,
    now: options.now,
    scopeAuthority: authority,
    worldNow: async (subjectId) => {
      const clock = await cognitionRead(async () =>
        (await nous()).clocks.readClock({ subjectId }, { timeoutMs: 5000 }),
      );
      const stamp = clock.now;
      if (
        !stamp?.at ||
        stamp.timeDomainRef !== clock.timeDomainRef ||
        !clock.timeDomainRef
      )
        throw managementProblem(
          "gateway.clock_unavailable",
          "The actual Subject clock is unavailable",
          "Start the configured Nous version with the official clock service",
          "unavailable",
        );
      return {
        timeDomainRef: clock.timeDomainRef,
        at:
          new Date(Number(stamp.at.seconds) * 1000).toISOString().slice(0, -5) +
          "." +
          String(stamp.at.nanos).padStart(9, "0") +
          "Z",
      };
    },
  });
  const native = createNativeCognitionBridge({
    persistence: options.persistence,
    life,
    now: options.now,
    recordContact: (input) => messaging.recordContact(input),
    nous,
    authorizeInput: async (registration, activity) => {
      const current = await self(registration.subjectId, registration.actorEntityRef);
      const configured = await options.product.configuration();
      if (
        !configured.settings?.subject.enabled ||
        registration.nativeAgentId !== current.nativeAgentId
      )
        denied(
          "The current Subject must be enabled on its actual native account Agent",
        );
      if (!activity.scope) denied("The Activity has not adopted its permission scope");
      if (!(await hasCanonicalNativeMessages(registration, messaging)))
        denied(
          "Selected message contacts do not match the actual authorized conversation",
        );
      assertScopeWithin(
        activity.scope,
        await authority(
          activity.subjectId,
          registration.actorEntityRef,
          activity.scope,
        ),
      );
    },
  });
  const agency = createAgencyService({
    persistence: options.persistence,
    now: options.now,
    onDeliveryRecorded: (fact) => native.recordDeliveryFact(fact),
    checkSources: async (runId) => {
      const run = await native.readRun(runId);
      if (!run) denied("The producer run is not registered by the Host");
      const current = await scope();
      const checked = await cognitionRead(async () =>
        (await nous()).runtime.reportUse(
          {
            subjectId: current.subjectId,
            sessionId: run.nousSessionId,
            consumerRef: "consumer:heptalogos:qq-delivery",
            modelInput: true,
            events: [],
          },
          { timeoutMs: 5000 },
        ),
      );
      if (!checked.modelInputChecked)
        denied("The actual cognition source propagation barrier was not checked");
    },
    authority: async (runId, recipient) => {
      const run = await native.readRun(runId);
      if (!run) denied("The producer run is not registered by the Host");
      const current = await scope();
      if (
        recipient.channel !== "heptalogos-qq" ||
        recipient.accountId !== current.accountId ||
        run.registration.subjectId !== current.subjectId ||
        run.registration.nativeAgentId !== current.nativeAgentId
      )
        denied(
          "The actual producer and protocol account must match the current binding",
        );
      const target = /^(group|direct):([0-9]+)$/.exec(recipient.to);
      if (
        !target ||
        !current.conversations.some(
          (c) =>
            c.kind === target[1] &&
            c.conversationId === target[2] &&
            c.receive &&
            c.effects.includes("send"),
        )
      )
        denied("This exact recipient has no current send grant");
      const found = await messaging.resolveConversations({
        conversations: [
          {
            platform: "qq",
            accountId: current.accountId,
            kind: target[1] as "group" | "direct",
            conversationId: target[2]!,
          },
        ],
      });
      if (found.conversationIds.length !== 1)
        denied("The recipient has no actual canonical conversation");
      const activity = await life.get(current.subjectId, run.registration.activityId);
      if (!activity?.scope) denied("The original adopted Activity is unavailable");
      const audience = decodeCognitionUsage(run.registration.usage).audience
        ?.conversationRef;
      const targetRef = "conversation:heptalogos:" + found.conversationIds[0]!;
      if (
        audience !== targetRef ||
        !hasAuthorizedNativeSources(activity, run.registration) ||
        !(await hasCanonicalNativeMessages(run.registration, messaging))
      )
        denied(
          "The actual producer audience and selected canonical sources cannot be rebound to another delivery",
        );
      assertScopeWithin(
        activity.scope,
        await authority(
          current.subjectId,
          run.registration.actorEntityRef,
          activity.scope,
        ),
      );
      if (run.state !== "running")
        denied("The original native run no longer permits a new external effect");
      return {
        activity,
        role: run.registration.role,
        actorEntityRef: run.registration.actorEntityRef,
        conversationRef: "conversation:heptalogos:" + found.conversationIds[0]!,
        sourceRefs: run.registration.sourceRefs,
        messageSources: run.registration.messageRefs.map((ref) => ({
          sourceRef: "message:" + ref,
          conversationRef: targetRef,
        })),
      };
    },
  });
  const routes = createChannelRouteStore({
    persistence: options.persistence,
    scope,
    now: options.now,
  });
  const archive = createArchiveStore(
    join(options.dataRoot, "messaging", "protected-cas"),
  );
  const activities = createActivityDispatcher({
    prepareMedia: createSelectedMediaUploader({ archive, nous }),
    life,
    messaging,
    identity,
    native,
    routes,
    scope,
    nous,
    now: options.now,
    dispatch: options.dispatchNativeActivity,
    authorizeActivity: async (activity) => {
      if (!activity.scope || !activity.adoptedBy) denied("The Activity is not adopted");
      assertScopeWithin(
        activity.scope,
        await authority(activity.subjectId, activity.adoptedBy, activity.scope),
      );
    },
  });
  const opportunity = createActivityOpportunity({
    scope,
    life,
    messaging,
    activities,
    enabled: async () =>
      !!(await options.product.configuration()).settings?.subject.enabled,
  });
  const http: GatewayHttpOptions = {
    opportunity,
    authenticate: await serviceCredential(options.secretRoot),
    runMutation: options.runMutation,
    scope,
    messaging,
    identity,
    life,
    agency,
    routes,
    archive,
    cognition: native,
    activities,
  };
  return { http, life, native, routes, messaging, identity, activities };
}
