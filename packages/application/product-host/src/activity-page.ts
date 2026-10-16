// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reads a bounded active Life page for world scheduling and lifecycle consumers.
 * @module activity-page
 */
import type { createLifeService } from "@heptalogos/subject";
/** Both consumers enumerate the same active owner records before applying their own world policy. */
export function readActiveLifePage(
  life: Pick<ReturnType<typeof createLifeService>, "schedule">,
  subjectId: string,
  afterId?: string,
) {
  return life.schedule({
    subjectId,
    states: ["active"],
    limit: 128,
    ...(afterId ? { afterId } : {}),
  });
}
