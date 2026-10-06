// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates the structural shape of Runtime contract declarations before graph
 * planning, so malformed provider metadata cannot enter reconciliation.
 * @module contract-shape
 */

import { runtimeKernelProblem } from "../problems.js";

/** Locates one supported data or executable member in a Runtime contract. */
export interface SupportedContractMember {
  readonly owner: object;
  readonly descriptor: PropertyDescriptor;
}

function contractPath(path: string, property: PropertyKey): string {
  return typeof property === "symbol"
    ? `${path}.[symbol]`
    : `${path}.${String(property)}`;
}

function fail(problemCode: string, detail: string): never {
  throw runtimeKernelProblem(problemCode, detail);
}

function validateObject(value: object, path: string, visited: WeakSet<object>): void {
  if (visited.has(value)) return;
  visited.add(value);

  const members = new Map<PropertyKey, SupportedContractMember>();
  let current: object | null = value;
  while (current !== null && current !== Object.prototype) {
    for (const property of Reflect.ownKeys(current)) {
      if (property === "constructor" && current !== value) continue;
      if (!members.has(property)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
        if (descriptor !== undefined) {
          members.set(property, { owner: current, descriptor });
        }
      }
    }
    current = Object.getPrototypeOf(current) as object | null;
  }

  for (const [property, member] of members) {
    const memberPath = contractPath(path, property);
    if (typeof property === "symbol") {
      fail(
        "runtime.contract.unsupported_symbol",
        `Runtime contract member '${memberPath}' uses a Symbol property`,
      );
    }
    const descriptor = member.descriptor;
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      fail(
        "runtime.contract.unsupported_accessor",
        `Runtime contract member '${memberPath}' uses an accessor`,
      );
    }
    if (typeof descriptor.value === "function") continue;
    if (descriptor.writable === true) {
      fail(
        "runtime.contract.unsupported_writable_property",
        `Runtime contract data member '${memberPath}' must be readonly`,
      );
    }
    if (descriptor.value !== null && typeof descriptor.value === "object") {
      validateObject(descriptor.value, memberPath, visited);
    }
  }
}

/** Validates a Runtime contract as readonly data plus callable methods. */
export function validateSupportedContractShape(implementation: object): void {
  if (typeof implementation === "function" || implementation === null) {
    fail(
      "runtime.contract.invalid_shape",
      "Runtime Service/Capability contracts must be object surfaces, not callable objects",
    );
  }
  validateObject(implementation, "contract", new WeakSet<object>());
}

/** Finds an own or inherited member accepted by the Runtime contract membrane. */
export function findSupportedContractMember(
  implementation: object,
  property: PropertyKey,
): SupportedContractMember | undefined {
  if (typeof property === "symbol") return undefined;
  let current: object | null = implementation;
  while (current !== null && current !== Object.prototype) {
    if (property === "constructor" && current !== implementation) return undefined;
    const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) return { owner: current, descriptor };
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

/** Reports whether a contract exposes at least one executable member. */
export function hasExecutableContractMember(value: object): boolean {
  let current: object | null = value;
  while (current !== null && current !== Object.prototype) {
    for (const property of Reflect.ownKeys(current)) {
      if (typeof property === "symbol") continue;
      if (property === "constructor" && current !== value) continue;
      const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
      if (descriptor !== undefined && typeof descriptor.value === "function") {
        return true;
      }
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}
