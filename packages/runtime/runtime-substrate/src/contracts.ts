// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines RuntimeSubstrate activation scopes, handles, task tracking, and
 * failure contracts while keeping Cordis objects out of Heptalogos APIs.
 * @module contracts
 */

/** Represents an owned resource disposer that may complete asynchronously. */
export type RuntimeDisposer = () => void | Promise<void>;

/** Tracks resources and process-memory tasks under one activation owner. */
export interface ActivationResourceScope {
  readonly signal: AbortSignal;
  /** Registers a disposer for bounded reverse-order cleanup. */
  defer(label: string, disposer: RuntimeDisposer): void;
  /** Tracks a task whose settlement is required before disposal completes. */
  track(label: string, task: Promise<unknown>): void;
}

/** Normalizes a background, disposal, or settlement failure from Substrate. */
export interface RuntimeSubstrateFailure {
  readonly phase: "BACKGROUND" | "DISPOSAL" | "SETTLEMENT_TIMEOUT";
  readonly label: string;
  readonly cause: unknown;
}

/** Supplies activation work and its failure sink to RuntimeSubstrate. */
export interface SubstrateActivationRequest {
  readonly label: string;
  /** Activates one resource scope under the substrate owner. */
  activate(scope: ActivationResourceScope): Promise<void>;
  /** Receives a normalized failure without escaping substrate cleanup. */
  onFailure(failure: RuntimeSubstrateFailure): void;
}

/** Represents one active or disposed substrate activation handle. */
export interface SubstrateActivationHandle {
  readonly state: "ACTIVE" | "FAILED" | "DISPOSING" | "DISPOSED";
  /** Disposes the activation and drains its owned resources. */
  dispose(): Promise<void>;
}

/** Owns generic activation and bounded disposal behind Heptalogos contracts. */
export interface RuntimeSubstrate {
  /** Activates one request and returns its lifecycle handle. */
  activate(request: SubstrateActivationRequest): Promise<SubstrateActivationHandle>;
  /** Closes the substrate after all activations settle. */
  close(): Promise<void>;
}

/** Configures the bounded settlement budget for substrate disposal. */
export interface RuntimeSubstrateOptions {
  readonly settleTimeoutMs: number;
}
