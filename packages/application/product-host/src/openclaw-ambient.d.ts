// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TypeScript 7's bundled runtime library omits the small DOM fetch aliases
 * referenced by the exact OpenClaw public declaration surface. These aliases
 * describe the existing Node 24 fetch primitives and do not alter runtime.
 * @module openclaw-ambient
 */

type RequestInfo = Request | string;
type HeadersInit = Headers | Record<string, string> | [string, string][];
type ReadableStreamReadResult<T> =
  | { readonly done: false; readonly value: T }
  | { readonly done: true; readonly value?: undefined };
