// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bounded dependency observations, without starting models or gating Management.
 * @module dependencies
 */
import { inspectNous } from "./nous.js";
import type { DependencyStatus, ProductSettings } from "@heptalogos/management";

async function inspect(
  name: string,
  url: string,
  signal?: AbortSignal,
): Promise<DependencyStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(2_000)])
        : AbortSignal.timeout(2_000),
      redirect: "error",
    });
    await response.body?.cancel();
    return {
      name,
      checkedAt,
      state: response.ok ? "available" : "unavailable",
      code: response.ok ? "dependency.http_available" : "dependency.http_rejected",
      message: `HTTP ${response.status}; this probe does not verify model execution or QQ login`,
      ...(response.ok
        ? {}
        : { nextStep: "Inspect the dependency service and its authenticated status" }),
    };
  } catch {
    return {
      name,
      checkedAt,
      state: "unavailable",
      code: "dependency.unreachable",
      message:
        "The configured local dependency did not answer within the probe deadline",
      nextStep: "Check its service status and configured endpoint",
    };
  }
}
/** Reports exactly the independently observed service endpoints. */
export async function inspectProductDependencies(
  settings: ProductSettings | undefined,
  signal?: AbortSignal,
): Promise<readonly DependencyStatus[]> {
  if (!settings)
    return [
      {
        name: "product",
        checkedAt: new Date().toISOString(),
        state: "unconfigured",
        code: "product.configuration_required",
        message: "Product settings have not been supplied",
        nextStep: "heptalogos config set",
      },
    ];
  return Promise.all([
    inspectNous(settings, signal),
    inspect(
      "subject_gateway",
      new URL("/readyz", settings.subjectGateway.origin).href,
      signal,
    ),
    inspect(
      "maintenance_gateway",
      new URL("/readyz", settings.maintenanceGateway.origin).href,
      signal,
    ),
  ]);
}
