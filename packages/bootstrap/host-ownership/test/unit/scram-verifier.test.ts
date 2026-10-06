// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  HOST_LEASE_SCRAM_ITERATIONS,
  HOST_LEASE_SCRAM_SALT_BYTES,
} from "../../src/contracts.js";
import {
  encodePostgresScramSha256Verifier,
  matchesPostgresScramSha256Verifier,
} from "../../src/scram-verifier.js";

const password = new TextEncoder().encode("A".repeat(32));
const salt = new TextEncoder().encode("salt-for-test-16");

describe("PostgreSQL SCRAM-SHA-256 verifier", () => {
  it("encodes the frozen verifier format deterministically", () => {
    const verifier = encodePostgresScramSha256Verifier(password, {
      iterations: HOST_LEASE_SCRAM_ITERATIONS,
      salt,
    });

    expect(verifier).toBe(
      "SCRAM-SHA-256$4096:c2FsdC1mb3ItdGVzdC0xNg==$tfUIjnoNpJ3yHpuImtLkq3Frw0Q5rSv0f1VJt/GH16k=:zWyviVVrIgQ3bd1aVeFVv7G8i9fSiiY4tDk8IQyLWJs=",
    );
    expect(verifier).not.toContain("A".repeat(32));
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/u,
    );
  });

  it("changes the verifier when the password or salt changes", () => {
    const baseline = encodePostgresScramSha256Verifier(password, {
      iterations: HOST_LEASE_SCRAM_ITERATIONS,
      salt,
    });
    const changedPassword = encodePostgresScramSha256Verifier(
      new TextEncoder().encode("B".repeat(32)),
      { iterations: HOST_LEASE_SCRAM_ITERATIONS, salt },
    );
    const changedSalt = encodePostgresScramSha256Verifier(password, {
      iterations: HOST_LEASE_SCRAM_ITERATIONS,
      salt: new TextEncoder().encode("salt-for-test-17"),
    });

    expect(changedPassword).not.toBe(baseline);
    expect(changedSalt).not.toBe(baseline);
  });

  it("matches an existing verifier without rewriting the stored credential", () => {
    const verifier = encodePostgresScramSha256Verifier(password, {
      iterations: HOST_LEASE_SCRAM_ITERATIONS,
      salt,
    });

    expect(matchesPostgresScramSha256Verifier(password, verifier)).toBe(true);
    expect(
      matchesPostgresScramSha256Verifier(
        new TextEncoder().encode("B".repeat(32)),
        verifier,
      ),
    ).toBe(false);
    expect(matchesPostgresScramSha256Verifier(password, "SCRAM-SHA-256$4096:bad")).toBe(
      false,
    );
  });

  it("rejects credentials and verifier inputs outside the bounded contract", () => {
    const invalidPasswords = [
      new Uint8Array(),
      new TextEncoder().encode("A".repeat(31)),
      new TextEncoder().encode("A".repeat(32) + " "),
      new Uint8Array([65, 0, ...new TextEncoder().encode("A".repeat(31))]),
      new Uint8Array([65, 10, ...new TextEncoder().encode("A".repeat(31))]),
      new Uint8Array([65, 13, ...new TextEncoder().encode("A".repeat(31))]),
      new Uint8Array([65, 0xc3, 0xa9, ...new TextEncoder().encode("A".repeat(29))]),
    ];

    for (const invalidPassword of invalidPasswords) {
      expect(() =>
        encodePostgresScramSha256Verifier(invalidPassword, {
          iterations: HOST_LEASE_SCRAM_ITERATIONS,
          salt,
        }),
      ).toThrow();
    }

    expect(() =>
      encodePostgresScramSha256Verifier(password, {
        iterations: HOST_LEASE_SCRAM_ITERATIONS - 1,
        salt,
      }),
    ).toThrow();
    expect(() =>
      encodePostgresScramSha256Verifier(password, {
        iterations: HOST_LEASE_SCRAM_ITERATIONS,
        salt: new Uint8Array(HOST_LEASE_SCRAM_SALT_BYTES - 1),
      }),
    ).toThrow();
  });
});
