// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the two proposal-transport tools exposed to the isolated Subject
 * OpenClaw runtime. The handlers acknowledge a proposal and perform no
 * canonical mutation or external effect.
 * @module subject-openclaw-plugin
 */

import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "@heptalogos/schema-runtime/typebox";

const acknowledgementSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    accepted: Type.Literal(true),
  },
  { additionalProperties: false },
);

const semanticContentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    content: Type.String({ minLength: 1, maxLength: 65_536 }),
  },
  { additionalProperties: false },
);

/** Exact tool-plugin entry loaded by the Product-supervised Subject Gateway. */
export default defineToolPlugin({
  id: "heptalogos-subject-cognition",
  name: "Heptalogos Subject Cognition",
  description: "Provides the bounded Subject conversation proposal tools.",
  tools: (tool) => [
    tool({
      name: "heptalogos_propose_communication",
      description:
        "Propose one bounded semantic communication for the current conversation.",
      parameters: Type.Object(
        { semanticContent: semanticContentSchema },
        { additionalProperties: false },
      ),
      outputSchema: acknowledgementSchema,
      execute: async (_params, _config, context) => {
        context.signal?.throwIfAborted();
        return { schemaVersion: 1, accepted: true };
      },
    }),
    tool({
      name: "heptalogos_complete_without_communication",
      description:
        "Complete the current conversation opportunity without communication.",
      parameters: Type.Object({}, { additionalProperties: false }),
      outputSchema: acknowledgementSchema,
      execute: async (_params, _config, context) => {
        context.signal?.throwIfAborted();
        return { schemaVersion: 1, accepted: true };
      },
    }),
  ],
});
