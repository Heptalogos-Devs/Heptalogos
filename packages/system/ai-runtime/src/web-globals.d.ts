// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Supplies the small browser-name type surface referenced by AI SDK's broad
 * client declarations when AIRuntime is compiled in the repository's Node
 * library context. The runtime uses Node's global fetch and does not expose a
 * browser API surface.
 * @module web-globals
 */

type HeadersInit =
  Headers | readonly (readonly [string, string])[] | Record<string, string>;
type RequestCredentials = "omit" | "include" | "same-origin";
type FileList = unknown;
type MediaStream = unknown;
