// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bridges execution lineage to OpenTelemetry context as an observational
 * projection; telemetry never becomes the identity or persistence authority.
 * @module observability-adapter
 */

import {
  context as otelContext,
  isSpanContextValid,
  trace,
  type Context as OTelContext,
} from "@opentelemetry/api";
import type { ActivityTelemetryCorrelation } from "./contracts.js";

/** Names the OpenTelemetry context used only for observational correlation. */
export type LineageTelemetryContext = OTelContext;

/** Returns the active observational telemetry context. */
export function activeTelemetryContext(): LineageTelemetryContext {
  return otelContext.active();
}

/** Runs a callback under the supplied observational telemetry context. */
export function withTelemetryContext<T>(
  context: LineageTelemetryContext,
  operation: () => T,
): T {
  return otelContext.with(context, operation);
}

/** Projects a valid OpenTelemetry span context into retained correlation fields. */
export function projectTelemetryCorrelation(
  context: LineageTelemetryContext,
): ActivityTelemetryCorrelation | undefined {
  const spanContext = trace.getSpanContext(context);
  if (!spanContext || !isSpanContextValid(spanContext)) return undefined;
  return Object.freeze({
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  });
}
