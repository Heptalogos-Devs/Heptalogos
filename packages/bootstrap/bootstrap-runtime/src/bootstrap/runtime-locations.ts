// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Projects the validated installation roots into the small location contract
 * consumed by replaceable Product runtime components.
 * @module runtime-locations
 */

import type { BootstrapPathProfile } from "./roots.js";

/** Runtime filesystem roots shared by repository and installed Product modes. */
export interface RuntimeLocations {
  /** Configuration owned by the installed Product instance. */
  readonly configRoot: string;
  /** Durable Product state root. */
  readonly stateRoot: string;
  /** Rebuildable runtime cache root. */
  readonly cacheRoot: string;
  /** Ephemeral runtime and discovery root. */
  readonly runRoot: string;
}

/** Projects a validated Bootstrap profile without exposing repository topology. */
export function resolveRuntimeLocations(
  profile: BootstrapPathProfile,
): RuntimeLocations {
  return Object.freeze({
    configRoot: profile.resolve("CONFIGURATION").canonicalPath,
    stateRoot: profile.resolve("DATA").canonicalPath,
    cacheRoot: profile.resolve("CACHE").canonicalPath,
    runRoot: profile.resolve("RUN").canonicalPath,
  });
}
