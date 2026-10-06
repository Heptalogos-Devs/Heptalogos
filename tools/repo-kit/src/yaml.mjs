// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Provides the shared YAML parsing seam for workspace and workflow inspection,
 * preserving parser diagnostics instead of using line-oriented approximations.
 * @module yaml
 */

import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";

function assertYamlText(text, label) {
  if (typeof text !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
}

/** Parse strict YAML through the shared parser and preserve useful diagnostics. */
export function parseYaml(text, label = "YAML") {
  assertYamlText(text, label);
  const document = parseDocument(text, {
    prettyErrors: true,
    strict: true,
  });
  if (document.errors.length > 0) {
    throw new Error(
      `${label} is invalid YAML: ${document.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
  return document.toJS({ mapAsMap: false });
}

/** Read and strictly parse one YAML file from disk. */
export function readYamlFile(path) {
  return parseYaml(readFileSync(path, "utf8"), path);
}
