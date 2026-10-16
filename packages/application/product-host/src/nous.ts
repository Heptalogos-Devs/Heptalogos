// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sole official Client binding to the configured cognition instance.
 * @module nous
 */
import { NousError } from "@nous-wave/client";
import { connectNousInstance } from "@nous-wave/client/node";
import {
  managementProblem,
  type ProductSettings,
  type CreateProductSubject,
  type ManagedSubject,
  type DependencyStatus,
} from "@heptalogos/management";

/** Connects only through official discovery and verifies the configured instance identity. */
export async function connectProductNous(settings: ProductSettings) {
  const connected = await connectNousInstance({ runRoot: settings.nous.runRoot });
  if (
    settings.nous.expectedInstanceId &&
    connected.instanceId !== settings.nous.expectedInstanceId
  )
    throw managementProblem(
      "management.cognition_instance_mismatch",
      "Nous instance changed",
      "Inspect the configured discovery and intended instance before binding",
      "conflict",
    );
  return connected;
}
async function operation<T>(
  settings: ProductSettings,
  invoke: (connected: Awaited<ReturnType<typeof connectProductNous>>) => Promise<T>,
): Promise<T> {
  try {
    return await invoke(await connectProductNous(settings));
  } catch (error) {
    if (error instanceof Error && "problem" in error) throw error;
    if (error instanceof NousError) {
      if (error.codeName === "NOT_FOUND")
        throw managementProblem(
          "management.subject_not_found",
          "Subject was not found",
          "The configured Nous instance does not contain this Subject",
          "conflict",
        );
      if (error.codeName === "INVALID_ARGUMENT")
        throw managementProblem(
          "management.subject_invalid",
          "Subject request is invalid",
          "Inspect the supplied Subject creation or identity fields",
          "validation",
        );
      if (["PERMISSION_DENIED", "UNAUTHENTICATED"].includes(error.codeName))
        throw managementProblem(
          "management.cognition_forbidden",
          "Nous access is denied",
          "Check the Host service credential and configured authority",
          "conflict",
        );
    }
    throw managementProblem(
      "management.cognition_unavailable",
      "Nous is unavailable",
      "Check the configured Nous discovery, credential and service",
      "unavailable",
      "after-change",
    );
  }
}
const view = (subject: {
  subjectId: string;
  status: string;
  capabilities?: { memory: boolean; selfCognition: boolean };
}): ManagedSubject => ({
  subjectId: subject.subjectId,
  status: subject.status,
  memory: subject.capabilities?.memory ?? false,
  selfCognition: subject.capabilities?.selfCognition ?? false,
});
/** Reads only the owning public Subject operation. */
export function getNousSubject(
  settings: ProductSettings,
  id: string,
  signal?: AbortSignal,
) {
  return operation(settings, async (connected) =>
    view(
      await connected.subjects.getSubject(
        { subjectId: id },
        { signal, timeoutMs: 5_000 },
      ),
    ),
  );
}
/** Creates through the official SDK; absent Seed stays absent. */
export function createNousSubject(
  settings: ProductSettings,
  input: CreateProductSubject,
  signal?: AbortSignal,
) {
  return operation(settings, async (connected) =>
    view(
      await connected.subjects.createSubject(
        {
          operationId: input.operationId,
          capabilities: input.capabilities,
          ...(input.seed
            ? {
                cognitiveSeed: {
                  text: input.seed.text,
                  format:
                    input.seed.format === "markdown"
                      ? "text/markdown"
                      : "application/vnd.nous-wave.cognitive-seed+toml;version=1",
                },
              }
            : {}),
        },
        { signal, timeoutMs: 10_000 },
      ),
    ),
  );
}
/** Authenticated status covers Core/Kernel/model-role facts rather than an invented HTTP health path. */
export async function inspectNous(
  settings: ProductSettings,
  signal?: AbortSignal,
): Promise<DependencyStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const result = await operation(settings, (connected) =>
      connected.system.getStatus({}, { signal, timeoutMs: 2_000 }),
    );
    const kernel = result.components.find((component) => component.name === "kernel");
    return {
      name: "nous",
      checkedAt,
      state: kernel?.state === "READY" ? "available" : "unavailable",
      code:
        kernel?.state === "READY"
          ? "nous.public_status_available"
          : "nous.kernel_unavailable",
      message: result.components
        .map((component) => `${component.name}:${component.state}`)
        .join(", "),
      ...(kernel?.state === "READY"
        ? {}
        : { nextStep: "Check the Nous kernel service" }),
    };
  } catch {
    return {
      name: "nous",
      checkedAt,
      state: "unavailable",
      code: "nous.public_status_unavailable",
      message: "Authenticated Nous status is unavailable",
      nextStep: "Check Nous discovery, credentials and service status",
    };
  }
}
