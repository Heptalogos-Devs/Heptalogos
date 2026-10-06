// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shares the bounded cursor mechanics used by WorkQueue reconciliation lanes.
 * Each lane scans to a snapshot ceiling before starting a new cycle, so rows
 * beyond a stable page cannot be starved by continuously arriving work.
 * @module fair-scan
 */

import type { WorkItem } from "./contracts.js";
import type { WorkItemScanCursor } from "./repository.js";

/** Process-memory cursor state for one fair canonical WorkItem scan lane. */
export interface FairScanLane {
  after?: WorkItemScanCursor;
  through?: WorkItemScanCursor;
}

/** Reset a lane so its next page begins a fresh ceiling-bounded cycle. */
export function resetFairScanLane(lane: FairScanLane): void {
  delete lane.after;
  delete lane.through;
}

function itemCursor(item: WorkItem): WorkItemScanCursor {
  return { createdAt: item.createdAt, workItemId: item.workItemId };
}

function sameCursor(left: WorkItemScanCursor, right: WorkItemScanCursor): boolean {
  return left.createdAt === right.createdAt && left.workItemId === right.workItemId;
}

/** Read one bounded page and advance or reset the supplied fair lane. */
export async function readFairWorkItemPage(
  lane: FairScanLane,
  snapshotCeiling: () => Promise<WorkItemScanCursor | undefined>,
  readPage: (input: {
    readonly after?: WorkItemScanCursor;
    readonly through: WorkItemScanCursor;
    readonly limit: number;
  }) => Promise<readonly WorkItem[]>,
  limit: number,
): Promise<readonly WorkItem[]> {
  if (lane.through === undefined) {
    const through = await snapshotCeiling();
    if (through === undefined) return [];
    lane.through = through;
    delete lane.after;
  }
  const through = lane.through;
  const page = await readPage({
    ...(lane.after === undefined ? {} : { after: lane.after }),
    through,
    limit,
  });
  const last = page.at(-1);
  if (
    last === undefined ||
    page.length < limit ||
    sameCursor(itemCursor(last), through)
  ) {
    resetFairScanLane(lane);
  } else {
    lane.after = itemCursor(last);
  }
  return page;
}
