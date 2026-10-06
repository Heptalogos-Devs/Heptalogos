// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  asContentDigest,
  createContinuityEpochId,
  createInstallationId,
  createInstanceId,
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import {
  BOOTSTRAP_STATE_DIGEST_DOMAIN,
  parseBootstrapState,
  sealBootstrapState,
} from "../../src/codec.js";
import type { BootstrapStateBodyV1 } from "../../src/model.js";

function makeState(): BootstrapStateBodyV1 {
  return {
    schemaVersion: 1,
    revision: 1,
    activeBootstrapRuntimeGeneration: asContentDigest(
      "BootstrapRuntimeGenerationId",
      digestCanonicalJson("test.bootstrap-runtime/v1", { generation: "bootstrap" }),
    ),
    activeProductGeneration: asContentDigest(
      "ProductGenerationId",
      digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
    ),
    continuityEpochId: createContinuityEpochId(),
  };
}

function makeStateWithPrivatePostgres(): BootstrapStateBodyV1 {
  return {
    schemaVersion: 1,
    revision: 1,
    activeBootstrapRuntimeGeneration: asContentDigest(
      "BootstrapRuntimeGenerationId",
      digestCanonicalJson("test.bootstrap-runtime/v1", { generation: "bootstrap" }),
    ),
    activeProductGeneration: asContentDigest(
      "ProductGenerationId",
      digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
    ),
    continuityEpochId:
      "0197cfe0-0000-7000-8000-000000000001" as BootstrapStateBodyV1["continuityEpochId"],
    privatePostgres: {
      schemaVersion: 1,
      postgresMajor: 18,
      initializedByPostgresVersion: "18.6",
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      bootstrapRoleName: "heptalogos_bootstrap",
      dataPlacement: {
        rootId: "DATA",
        relativePath: "private-postgres",
        dataLayoutVersion: 1,
      },
      persistedPort: 55432,
      clusterSystemIdentifier: "12345678901234567890",
      initializationProfileRevision: asContentDigest(
        "PrivatePostgresInitializationProfileRevision",
        digestCanonicalJson("test.private-postgres-profile/v1", {
          profile: "canonical",
        }),
      ),
    },
  };
}

describe("BootstrapState codec", () => {
  it("seals and parses a valid state", () => {
    const sealed = sealBootstrapState(makeState());
    const result = parseBootstrapState(JSON.stringify(sealed));

    expect(result).toEqual({ ok: true, value: sealed });
    expect(sealed.digest.domain).toBe(BOOTSTRAP_STATE_DIGEST_DOMAIN);
  });

  it("rejects canonical V1 missing required continuityEpochId", () => {
    const sealed = sealBootstrapState(makeState());
    const { continuityEpochId: _drop, ...invalidState } = sealed.state;

    const result = parseBootstrapState(
      JSON.stringify({
        state: invalidState,
        digest: digestCanonicalJson(
          BOOTSTRAP_STATE_DIGEST_DOMAIN,
          invalidState as unknown as CanonicalJsonValue,
        ),
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { problemCode: "bootstrap.state.invalid_schema" },
    });
  });

  it("seals and parses canonical V1 with private PostgreSQL", () => {
    const sealed = sealBootstrapState(makeStateWithPrivatePostgres());
    const result = parseBootstrapState(JSON.stringify(sealed));

    expect(result).toEqual({ ok: true, value: sealed });
    expect(sealed.state.schemaVersion).toBe(1);
    expect(sealed.digest.domain).toBe(BOOTSTRAP_STATE_DIGEST_DOMAIN);
  });

  it("rejects an unsupported outer V2 shape", () => {
    const sealed = sealBootstrapState(makeStateWithPrivatePostgres());
    const unsupportedSchema = {
      ...sealed,
      state: { ...sealed.state, schemaVersion: 2 },
    };

    expect(parseBootstrapState(JSON.stringify(unsupportedSchema))).toMatchObject({
      ok: false,
      problem: { problemCode: "bootstrap.state.unsupported_schema" },
    });
  });

  it("rejects unknown fields in canonical V1 state", () => {
    const sealed = sealBootstrapState(makeStateWithPrivatePostgres());
    const result = parseBootstrapState(
      JSON.stringify({
        ...sealed,
        state: { ...sealed.state, unexpected: true },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { problemCode: "bootstrap.state.invalid_schema" },
    });
  });

  it("rejects invalid canonical identity, port, and cluster identifier fields", () => {
    const sealed = sealBootstrapState(makeStateWithPrivatePostgres());
    const cases = [
      {
        state: {
          ...sealed.state,
          privatePostgres: {
            ...sealed.state.privatePostgres,
            installationId: "not-a-uuid",
          },
        },
      },
      {
        state: {
          ...sealed.state,
          privatePostgres: {
            ...sealed.state.privatePostgres,
            persistedPort: 65536,
          },
        },
      },
      {
        state: {
          ...sealed.state,
          privatePostgres: {
            ...sealed.state.privatePostgres,
            clusterSystemIdentifier: "12x",
          },
        },
      },
    ];

    for (const value of cases) {
      expect(parseBootstrapState(JSON.stringify(value))).toMatchObject({
        ok: false,
        problem: { problemCode: "bootstrap.state.invalid_schema" },
      });
    }
  });

  it("uses the canonical V1 digest domain", () => {
    expect(sealBootstrapState(makeState()).digest.domain).toBe(
      "heptalogos.bootstrap-state/v1",
    );
  });

  it("rejects an unsupported future schema", () => {
    const sealed = sealBootstrapState(makeStateWithPrivatePostgres());
    const future = {
      ...sealed,
      state: { ...sealed.state, schemaVersion: 3 },
    };

    expect(parseBootstrapState(JSON.stringify(future))).toMatchObject({
      ok: false,
      problem: { problemCode: "bootstrap.state.unsupported_schema" },
    });
  });

  it("rejects a canonical V1 digest mismatch", () => {
    const sealed = sealBootstrapState(makeStateWithPrivatePostgres());
    const result = parseBootstrapState(
      JSON.stringify({
        ...sealed,
        digest: { ...sealed.digest, hex: "0".repeat(64) },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { problemCode: "bootstrap.state.digest_mismatch" },
    });
  });

  it("rejects a state digest mismatch", () => {
    const sealed = sealBootstrapState(makeState());
    const text = JSON.stringify({
      ...sealed,
      digest: { ...sealed.digest, hex: "0".repeat(64) },
    });

    const result = parseBootstrapState(text);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.problem.problemCode).toBe("bootstrap.state.digest_mismatch");
  });

  it("rejects unknown top-level and state fields", () => {
    const sealed = sealBootstrapState(makeState());
    const topLevel = parseBootstrapState(
      JSON.stringify({ ...sealed, unexpected: true }),
    );
    const stateLevel = parseBootstrapState(
      JSON.stringify({ ...sealed, state: { ...sealed.state, unexpected: true } }),
    );

    expect(topLevel.ok).toBe(false);
    expect(stateLevel.ok).toBe(false);
    if (!topLevel.ok)
      expect(topLevel.problem.problemCode).toBe("bootstrap.state.invalid_schema");
    if (!stateLevel.ok)
      expect(stateLevel.problem.problemCode).toBe("bootstrap.state.invalid_schema");
  });

  it("rejects revision values that are zero, negative, or non-integer", () => {
    for (const revision of [0, -1, 1.5]) {
      const state = { ...makeState(), revision } as BootstrapStateBodyV1;
      const result = parseBootstrapState(JSON.stringify(sealBootstrapState(state)));
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.problem.problemCode).toBe("bootstrap.state.invalid_schema");
    }
  });

  it("rejects missing generation references", () => {
    const { activeProductGeneration: _product, ...withoutProduct } = makeState();
    const result = parseBootstrapState(
      JSON.stringify(sealBootstrapState(withoutProduct as BootstrapStateBodyV1)),
    );

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.problem.problemCode).toBe("bootstrap.state.invalid_schema");
  });

  it("does not coerce a string revision into a number", () => {
    const sealed = sealBootstrapState(makeState());
    const raw = { ...sealed, state: { ...sealed.state, revision: "1" } };
    const result = parseBootstrapState(JSON.stringify(raw));

    expect(raw.state.revision).toBe("1");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.problem.problemCode).toBe("bootstrap.state.invalid_schema");
  });

  it("rejects generation references that are not lowercase SHA-256 digests", () => {
    const sealed = sealBootstrapState(makeState());
    const invalid = {
      ...sealed,
      state: { ...sealed.state, activeProductGeneration: "banana" },
    };

    const result = parseBootstrapState(JSON.stringify(invalid));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.problemCode).toBe("bootstrap.state.invalid_schema");
    }
  });

  it("keeps parser and schema details stable and bounded", () => {
    const invalidJson = parseBootstrapState('{"state":');
    const invalidSchema = parseBootstrapState(
      JSON.stringify({ state: {}, digest: {} }),
    );

    expect(invalidJson).toMatchObject({
      ok: false,
      problem: {
        detail: "Bootstrap state JSON could not be parsed",
      },
    });
    expect(invalidSchema).toMatchObject({
      ok: false,
      problem: {
        detail: "Bootstrap state does not match the supported schema",
      },
    });
  });
});
