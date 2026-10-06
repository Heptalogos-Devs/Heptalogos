// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public PostgreSQL Signal contracts, codecs, and service construction for
 * wakeup hints; listener client and query mechanics remain internal.
 * @packageDocumentation
 */

export {
  SIGNAL_CHANNEL,
  SIGNAL_HINT_MAX_BYTES,
  createSignalTopic,
  decodeSignalHint,
  encodeSignalHint,
  parseSignalTopic,
  type SignalHintV1,
} from "./hint-codec.js";
export {
  createPostgresSignalService,
  postgresSignalPublisher,
} from "./postgres-signal.js";
export type {
  PostgresSignalRuntimeOptions,
  SignalHostAuthority,
  SignalPublisher,
  SignalService,
  SignalSubscription,
  SignalListener,
  SignalTopic,
} from "./contracts.js";
