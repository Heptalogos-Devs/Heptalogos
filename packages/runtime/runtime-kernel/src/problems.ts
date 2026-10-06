// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Constructs Runtime Kernel Problem envelopes for illegal topology, lifecycle,
 * and generation operations without exposing framework failure objects.
 * @module problems
 */

import {
  createProblemError,
  type ProblemError,
  type ProblemInit,
  type RetryClass,
} from "@heptalogos/foundation-contracts";

interface RuntimeProblemSpec {
  readonly category: string;
  readonly retryClass: RetryClass;
  readonly title: string;
}

const runtimeProblemSpecs: Readonly<Record<string, RuntimeProblemSpec>> = {
  "runtime.activation.duplicate_capability_publication": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem published a Capability more than once",
  },
  "runtime.activation.duplicate_service_publication": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem published a Service more than once",
  },
  "runtime.activation.background_failure": {
    category: "unavailable",
    retryClass: "after-change",
    title: "MicroSystem activation observed a background failure",
  },
  "runtime.activation.missing_capability_publication": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem did not publish a declared Capability",
  },
  "runtime.activation.missing_service_publication": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem did not publish a declared Service",
  },
  "runtime.activation.undeclared_capability_access": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem requested an undeclared Capability",
  },
  "runtime.activation.undeclared_capability_publication": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem published an undeclared Capability",
  },
  "runtime.activation.undeclared_service_access": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem requested an undeclared Service",
  },
  "runtime.activation.undeclared_service_publication": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem published an undeclared Service",
  },
  "runtime.activation.duplicate_work_handler_publication": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem published a WorkHandler more than once",
  },
  "runtime.activation.missing_work_handler_publication": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem did not publish a declared WorkHandler",
  },
  "runtime.activation.undeclared_work_handler_publication": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem published an undeclared WorkHandler",
  },
  "runtime.contract.invalid_shape": {
    category: "validation",
    retryClass: "never",
    title: "Service or Capability contract shape is unsupported",
  },
  "runtime.contract.unsupported_accessor": {
    category: "validation",
    retryClass: "never",
    title: "Service or Capability accessor operation is unsupported",
  },
  "runtime.contract.unsupported_function_argument": {
    category: "validation",
    retryClass: "never",
    title: "Service or Capability function arguments are unsupported",
  },
  "runtime.contract.unsupported_function_result": {
    category: "validation",
    retryClass: "never",
    title: "Service or Capability function results are unsupported",
  },
  "runtime.contract.unsupported_input": {
    category: "validation",
    retryClass: "never",
    title: "Service or Capability input data is unsupported",
  },
  "runtime.contract.unsupported_provider_identity": {
    category: "validation",
    retryClass: "never",
    title: "Provider identity cannot cross a Service or Capability boundary",
  },
  "runtime.contract.unsupported_result": {
    category: "validation",
    retryClass: "never",
    title: "Service or Capability result data is unsupported",
  },
  "runtime.contract.unsupported_symbol": {
    category: "validation",
    retryClass: "never",
    title: "Symbol-driven Service or Capability protocols are unsupported",
  },
  "runtime.contract.unsupported_writable_property": {
    category: "validation",
    retryClass: "never",
    title: "Service or Capability data properties must be readonly",
  },
  "runtime.capability.duplicate_provider": {
    category: "validation",
    retryClass: "never",
    title: "Capability provider binding is duplicated",
  },
  "runtime.capability.explicit_unavailable": {
    category: "conflict",
    retryClass: "after-change",
    title: "Explicit Capability provider is unavailable",
  },
  "runtime.capability.invalid_priority": {
    category: "validation",
    retryClass: "never",
    title: "Capability provider priority is invalid",
  },
  "runtime.capability.missing": {
    category: "unavailable",
    retryClass: "after-change",
    title: "Required Capability is unavailable",
  },
  "runtime.capability.incompatible_contract": {
    category: "conflict",
    retryClass: "after-change",
    title: "Capability contract is incompatible",
  },
  "runtime.generation.invalid_operation_id": {
    category: "validation",
    retryClass: "never",
    title: "Runtime operation identifier is invalid",
  },
  "runtime.generation.invalid_reservation": {
    category: "validation",
    retryClass: "never",
    title: "Runtime generation invocation reservation is invalid",
  },
  "runtime.generation.invalid_settle_timeout": {
    category: "validation",
    retryClass: "never",
    title: "Runtime settlement timeout is invalid",
  },
  "runtime.generation.retired": {
    category: "conflict",
    retryClass: "after-change",
    title: "Runtime generation is retired",
  },
  "runtime.generation.settlement_timeout": {
    category: "unavailable",
    retryClass: "after-change",
    title: "Runtime generation did not settle in time",
  },
  "runtime.provider.invocation_failed": {
    category: "unavailable",
    retryClass: "after-change",
    title: "Provider invocation failed",
  },
  "runtime.work-handler.configuration-binding-unavailable": {
    category: "unavailable",
    retryClass: "after-change",
    title: "WorkHandler configuration binding is unavailable",
  },
  "runtime.work_handler.duplicate_registration": {
    category: "validation",
    retryClass: "never",
    title: "WorkHandler registration is duplicated",
  },
  "runtime.work_handler.invalid_descriptor": {
    category: "validation",
    retryClass: "never",
    title: "WorkHandler descriptor is invalid",
  },
  "runtime.work_handler.invalid_result": {
    category: "validation",
    retryClass: "never",
    title: "WorkHandler result is invalid",
  },
  "runtime.work_handler.package_generation_required": {
    category: "validation",
    retryClass: "never",
    title: "WorkHandler requires a PackageGenerationId",
  },
  "runtime.work_handler.payload_invalid": {
    category: "validation",
    retryClass: "never",
    title: "WorkHandler payload is invalid",
  },
  "runtime.work_handler.payload_version_unavailable": {
    category: "conflict",
    retryClass: "after-change",
    title: "WorkHandler payload version is unavailable",
  },
  "runtime.work_handler.outcome_invalid": {
    category: "validation",
    retryClass: "never",
    title: "WorkHandler outcome is invalid",
  },
  "runtime.graph.duplicate_node": {
    category: "validation",
    retryClass: "never",
    title: "Runtime graph contains a duplicate MicroSystem",
  },
  "runtime.graph.hard_service_cycle": {
    category: "validation",
    retryClass: "never",
    title: "Runtime graph contains a hard Service cycle",
  },
  "runtime.service.ambiguous_provider": {
    category: "conflict",
    retryClass: "after-change",
    title: "Service provider selection is ambiguous",
  },
  "runtime.service.binding_conflict": {
    category: "conflict",
    retryClass: "after-change",
    title: "Service provider bindings conflict",
  },
  "runtime.service.blocked_dependency": {
    category: "unavailable",
    retryClass: "after-change",
    title: "A required Service dependency is blocked",
  },
  "runtime.service.duplicate_provider": {
    category: "validation",
    retryClass: "never",
    title: "Service provider binding is duplicated",
  },
  "runtime.service.explicit_unavailable": {
    category: "conflict",
    retryClass: "after-change",
    title: "Explicit Service provider is unavailable",
  },
  "runtime.service.missing": {
    category: "unavailable",
    retryClass: "after-change",
    title: "Required Service is unavailable",
  },
  "runtime.service.incompatible_contract": {
    category: "conflict",
    retryClass: "after-change",
    title: "Service contract is incompatible",
  },
  "runtime.supervisor.duplicate_definition": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem definition is duplicated",
  },
  "runtime.supervisor.close_failed": {
    category: "unavailable",
    retryClass: "after-change",
    title: "Runtime supervisor close failed",
  },
  "runtime.supervisor.invalid_revision": {
    category: "validation",
    retryClass: "never",
    title: "Runtime desired-state revision is invalid",
  },
  "runtime.supervisor.not_active": {
    category: "conflict",
    retryClass: "after-change",
    title: "Runtime supervisor is not active",
  },
  "runtime.supervisor.unknown_system": {
    category: "validation",
    retryClass: "never",
    title: "MicroSystem is unknown",
  },
  "runtime.operating_mode.ineligible": {
    category: "unavailable",
    retryClass: "after-change",
    title: "MicroSystem is ineligible for the current operating mode",
  },
};

function fallbackSpec(problemCode: string): RuntimeProblemSpec {
  if (problemCode.includes("invalid") || problemCode.includes("undeclared")) {
    return {
      category: "validation",
      retryClass: "never",
      title: "Runtime request is invalid",
    };
  }
  return {
    category: "unavailable",
    retryClass: "after-change",
    title: "Runtime operation failed",
  };
}

function runtimeProblem(problemCode: string, detail: string): ProblemInit {
  const spec = runtimeProblemSpecs[problemCode] ?? fallbackSpec(problemCode);
  return {
    problemCode,
    category: spec.category,
    retryClass: spec.retryClass,
    title: spec.title,
    detail,
  };
}

/** Creates a typed Runtime Kernel Problem from a semantic failure code. */
export function runtimeKernelProblem(
  problemCode: string,
  detail: string,
  cause?: unknown,
): ProblemError {
  return createProblemError(
    runtimeProblem(problemCode, detail),
    cause === undefined ? undefined : { cause },
  );
}
