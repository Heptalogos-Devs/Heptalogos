// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Completes normal service startup with the existing native scheduling entry. @module service-reactor */
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { openLocalManagementClient } from "@heptalogos/management-client/node";
import { openOperatorGateway } from "./gateway-access.js";
/** A projected opportunity is scheduling, rather than a claim that an Agent ran. */
export async function projectStartedReactor(
  anchorRoot: string,
  waitForSubject: boolean,
) {
  try {
    const discovered = await openLocalManagementClient({ anchorRoot });
    const sessionToken = await discovered.readSessionToken();
    if (!sessionToken)
      return {
        state: "unavailable" as const,
        code: "management.session_required_for_reactor_projection",
      };
    const local = await openLocalManagementClient({ anchorRoot, sessionToken });
    const configuration = await local.client.getConfiguration(),
      settings = configuration.settings;
    if (!settings?.subject.id || !settings.subject.enabled)
      return { state: "disabled" as const };
    const deadline = Date.now() + (waitForSubject ? 90_000 : 2000);
    let ready = false;
    do {
      try {
        const response = await fetch(
          new URL("/readyz", settings.subjectGateway.origin),
          { signal: AbortSignal.timeout(2000), redirect: "error" },
        );
        ready = response.ok;
        await response.body?.cancel();
      } catch {
        /* The real dependency may still be starting. */
      }
      if (ready || !waitForSubject) break;
      await delay(200);
    } while (Date.now() < deadline);
    if (!ready)
      return {
        state: "unavailable" as const,
        code: "installation.subject_gateway_not_ready",
      };
    const gateway = await openOperatorGateway(local);
    await gateway.reactorWake({
      subjectId: settings.subject.id,
      operationRef: "service-start:" + randomUUID(),
    });
    return { state: "projected" as const };
  } catch {
    return {
      state: "unavailable" as const,
      code: "installation.reactor_projection_unavailable",
    };
  }
}
