// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Exposes the explicitly routed Runtime Kernel lineage integration without
 * moving runtime lifecycle or generation Authority into execution-lineage.
 * @module runtime-kernel
 */

import type {
  ActivityRequest,
  ExecutionContext,
  ExecutionContextRuntime,
  LineageContextRefV1,
  RuntimeExecutionOrigin,
} from "./contracts.js";
import { bindRuntimeOriginInternal } from "./execution-context-runtime.js";

/** Minimal lineage runner exposed to Runtime Kernel without persistence details. */
export interface RuntimeActivityRunner {
  /** Returns the current Runtime Activity context. */
  current(): ExecutionContext | undefined;
  /** Runs a Runtime operation under an Activity origin. */
  runActivity<T>(
    request: ActivityRequest,
    operation: (context: ExecutionContext) => Promise<T>,
  ): Promise<T>;
  /** Optionally resumes Runtime work from a durable lineage reference. */
  runFromLineageContextRef?<T>(
    ref: LineageContextRefV1,
    request: Omit<ActivityRequest, "causationActivityId">,
    operation: (context: ExecutionContext) => Promise<T>,
  ): Promise<T>;
}

/** Binds a Runtime origin to the shared execution-context runtime. */
export function bindRuntimeExecutionOrigin(
  runtime: ExecutionContextRuntime,
  origin: RuntimeExecutionOrigin,
): RuntimeActivityRunner {
  return bindRuntimeOriginInternal(runtime, origin);
}

export type { RuntimeExecutionOrigin } from "./contracts.js";
