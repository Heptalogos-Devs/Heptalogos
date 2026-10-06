// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wraps provider access with a generation fence so stale runtime handles fail
 * before invoking a retired provider or crossing the lifecycle boundary.
 * @module fenced-proxy
 */

import { ProblemError, type ProviderId } from "@heptalogos/foundation-contracts";
import { GenerationFence } from "./generation-fence.js";
import {
  findSupportedContractMember,
  hasExecutableContractMember,
  validateSupportedContractShape,
} from "../model/contract-shape.js";
import { runtimeKernelProblem } from "../problems.js";

function operationIdFor(providerId: ProviderId, property: PropertyKey): string {
  return `${providerId}.${String(property)}`.slice(0, 256);
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isNativePromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type Callable = (...args: readonly unknown[]) => unknown;
type MemberKind = "method";

const fencedProxies = new WeakSet<object>();

function unsupportedInput(problemCode: string, detail: string): never {
  throw runtimeKernelProblem(problemCode, detail);
}

function projectInputValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "function") {
    return unsupportedInput(
      "runtime.contract.unsupported_function_argument",
      `Runtime provider argument '${path}' contains a function`,
    );
  }
  if (typeof value === "symbol") {
    return unsupportedInput(
      "runtime.contract.unsupported_symbol",
      `Runtime provider argument '${path}' contains a Symbol`,
    );
  }
  if (value === null || typeof value !== "object") return value;
  if (fencedProxies.has(value)) {
    return unsupportedInput(
      "runtime.contract.unsupported_provider_identity",
      `Runtime provider argument '${path}' contains a Host-owned contract facade`,
    );
  }
  if (seen.has(value)) {
    return unsupportedInput(
      "runtime.contract.unsupported_input",
      `Runtime provider argument '${path}' contains a cyclic object`,
    );
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const projected = value.map((entry, index) =>
      projectInputValue(entry, `${path}[${index}]`, seen),
    );
    seen.delete(value);
    return Object.freeze(projected);
  }
  if (!isPlainObject(value)) {
    return unsupportedInput(
      "runtime.contract.unsupported_input",
      `Runtime provider argument '${path}' must be plain data`,
    );
  }

  const projected = Object.create(Object.getPrototypeOf(value)) as Record<
    string,
    unknown
  >;
  for (const property of Reflect.ownKeys(value)) {
    if (typeof property === "symbol") {
      return unsupportedInput(
        "runtime.contract.unsupported_symbol",
        `Runtime provider argument '${path}' contains a Symbol property`,
      );
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
    if (descriptor === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      return unsupportedInput(
        "runtime.contract.unsupported_accessor",
        `Runtime provider argument '${path}.${property}' uses an accessor`,
      );
    }
    Object.defineProperty(projected, property, {
      configurable: false,
      enumerable: descriptor.enumerable,
      writable: false,
      value: projectInputValue(descriptor.value, `${path}.${property}`, seen),
    });
  }
  seen.delete(value);
  return Object.freeze(projected);
}

function normalizeProviderFailure(cause: unknown, owner: object): ProblemError {
  if (cause instanceof ProblemError) return cause;
  if (cause instanceof Error && cause !== owner) {
    return runtimeKernelProblem(
      "runtime.provider.invocation_failed",
      "Provider invocation failed",
      cause,
    );
  }
  return runtimeKernelProblem(
    "runtime.provider.invocation_failed",
    "Provider invocation failed",
  );
}

/** Creates a proxy that fences provider calls and reprojects nested results. */
export function createFencedProxy<TContract extends object>(
  implementation: TContract,
  fence: GenerationFence,
  providerId: ProviderId,
): TContract {
  const facades = new WeakMap<object, object>();
  const rawValues = new WeakMap<object, object>();
  const methodWrappers = new WeakMap<
    object,
    Map<PropertyKey, Map<MemberKind, (...args: readonly unknown[]) => unknown>>
  >();

  const unwrap = (value: unknown): unknown => {
    if (!isObjectLike(value)) return value;
    return rawValues.get(value) ?? value;
  };

  function projectResult(
    value: unknown,
    seen: WeakSet<object> = new WeakSet<object>(),
  ): unknown {
    if (isNativePromise(value)) {
      return Promise.resolve(value).then(
        (resolved) => projectResult(resolved, seen),
        (cause) => {
          throw normalizeProviderFailure(cause, implementation);
        },
      );
    }
    if (typeof value === "function") {
      return unsupportedInput(
        "runtime.contract.unsupported_function_result",
        "Runtime provider methods cannot return functions",
      );
    }
    if (typeof value === "symbol") {
      return unsupportedInput(
        "runtime.contract.unsupported_symbol",
        "Runtime provider methods cannot return Symbol values",
      );
    }
    if (value === null || typeof value !== "object") return value;
    const rawValue = unwrap(value);
    if (rawValue === null || typeof rawValue !== "object") return rawValue;
    if (fencedProxies.has(rawValue)) return rawValue;
    if (hasExecutableContractMember(rawValue)) {
      validateSupportedContractShape(rawValue);
      return wrap(rawValue);
    }
    return projectResultData(rawValue, seen);
  }

  // Intentional duplication: input and result projection share traversal shape
  // but retain separate failure codes and messages for the public contract.
  /* jscpd:ignore-start */
  function projectResultData(value: object, seen: WeakSet<object>): unknown {
    if (fencedProxies.has(value)) return value;
    if (seen.has(value)) {
      return unsupportedInput(
        "runtime.contract.unsupported_result",
        "Runtime provider result data cannot be cyclic",
      );
    }
    seen.add(value);

    if (Array.isArray(value)) {
      const projected = value.map((entry) => projectResult(entry, seen));
      seen.delete(value);
      return Object.freeze(projected);
    }
    if (!isPlainObject(value)) {
      return unsupportedInput(
        "runtime.contract.unsupported_result",
        "Runtime provider results must be plain data or nested contract objects",
      );
    }

    const projected = Object.create(Object.getPrototypeOf(value)) as Record<
      string,
      unknown
    >;
    for (const property of Reflect.ownKeys(value)) {
      if (typeof property === "symbol") {
        return unsupportedInput(
          "runtime.contract.unsupported_symbol",
          "Runtime provider result data cannot contain Symbol properties",
        );
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
      if (descriptor === undefined) continue;
      if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        return unsupportedInput(
          "runtime.contract.unsupported_accessor",
          `Runtime provider result '${String(property)}' uses an accessor`,
        );
      }
      Object.defineProperty(projected, property, {
        configurable: false,
        enumerable: descriptor.enumerable,
        writable: false,
        value: projectResult(descriptor.value, seen),
      });
    }
    seen.delete(value);
    return Object.freeze(projected);
  }
  /* jscpd:ignore-end */

  function invokeProvider(
    owner: object,
    member: Callable,
    args: readonly unknown[],
  ): unknown {
    try {
      const result = Reflect.apply(member, owner, args as unknown[]);
      if (isNativePromise(result)) {
        return Promise.resolve(result).then(
          (resolved) => projectResult(resolved),
          (cause) => {
            throw normalizeProviderFailure(cause, owner);
          },
        );
      }
      return projectResult(result);
    } catch (cause) {
      throw normalizeProviderFailure(cause, owner);
    }
  }

  function wrapMember(
    receiver: object,
    property: PropertyKey,
    kind: MemberKind,
    member: Callable,
  ): (...args: readonly unknown[]) => unknown {
    let wrappers = methodWrappers.get(receiver);
    if (wrappers === undefined) {
      wrappers = new Map();
      methodWrappers.set(receiver, wrappers);
    }
    let members = wrappers.get(property);
    if (members === undefined) {
      members = new Map();
      wrappers.set(property, members);
    }
    const previous = members.get(kind);
    if (previous !== undefined) return previous;
    const wrapper = (...args: readonly unknown[]) => {
      fence.assertActive();
      const projectedArgs = args.map((value, index) =>
        projectInputValue(value, `argument[${index}]`, new WeakSet<object>()),
      );
      return fence.invoke(operationIdFor(providerId, property), () =>
        invokeProvider(receiver, member, projectedArgs),
      );
    };
    members.set(kind, wrapper);
    return wrapper;
  }

  function projectDescriptor(
    owner: object,
    target: object,
    property: PropertyKey,
  ): PropertyDescriptor | undefined {
    const shadowDescriptor = Reflect.getOwnPropertyDescriptor(target, property);
    if (shadowDescriptor !== undefined) return shadowDescriptor;
    const descriptor = Reflect.getOwnPropertyDescriptor(owner, property);
    if (descriptor === undefined) return undefined;
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw runtimeKernelProblem(
        "runtime.contract.unsupported_accessor",
        `Runtime contract member '${String(property)}' uses an accessor`,
      );
    }
    return {
      configurable: true,
      enumerable: descriptor.enumerable,
      writable: false,
      value:
        typeof descriptor.value === "function"
          ? wrapMember(owner, property, "method", descriptor.value as Callable)
          : projectResult(descriptor.value),
    };
  }

  function wrap<T extends object>(value: T): T {
    const rawValue = unwrap(value);
    if (!isObjectLike(rawValue)) return rawValue as T;
    const previous = facades.get(rawValue);
    if (previous !== undefined) return previous as T;

    const target = Object.create(null) as object;
    let proxy!: object;
    const handler: ProxyHandler<object> = {
      get(shadow, property) {
        fence.assertActive();
        if (Object.prototype.hasOwnProperty.call(shadow, property)) {
          return Reflect.get(shadow, property, shadow);
        }
        const member = findSupportedContractMember(rawValue, property);
        if (member === undefined) return undefined;
        const descriptor = member.descriptor;
        if (descriptor.get !== undefined || descriptor.set !== undefined) {
          throw runtimeKernelProblem(
            "runtime.contract.unsupported_accessor",
            `Runtime contract member '${String(property)}' uses an accessor`,
          );
        }
        return typeof descriptor.value === "function"
          ? wrapMember(rawValue, property, "method", descriptor.value as Callable)
          : projectResult(descriptor.value);
      },
      set(_shadow, _property, _nextValue) {
        fence.assertActive();
        return false;
      },
      deleteProperty(_shadow, _property) {
        fence.assertActive();
        return false;
      },
      defineProperty(_shadow, _property, _descriptor) {
        fence.assertActive();
        return false;
      },
      getOwnPropertyDescriptor(shadow, property) {
        fence.assertActive();
        return projectDescriptor(rawValue, shadow, property);
      },
      ownKeys(shadow) {
        fence.assertActive();
        const keys = new Set<string>();
        for (const key of Reflect.ownKeys(shadow)) {
          if (typeof key === "string") keys.add(key);
        }
        for (const key of Reflect.ownKeys(rawValue)) {
          if (typeof key === "string") keys.add(key);
        }
        return [...keys];
      },
      has(shadow, property) {
        fence.assertActive();
        return (
          Reflect.has(shadow, property) ||
          findSupportedContractMember(rawValue, property) !== undefined
        );
      },
      getPrototypeOf(_shadow) {
        fence.assertActive();
        return null;
      },
      setPrototypeOf(_shadow, _prototype) {
        fence.assertActive();
        return false;
      },
      isExtensible(shadow) {
        fence.assertActive();
        return Reflect.isExtensible(shadow);
      },
      preventExtensions() {
        fence.assertActive();
        return false;
      },
    };
    proxy = new Proxy(target, handler);
    facades.set(rawValue, proxy);
    rawValues.set(proxy, rawValue);
    fencedProxies.add(proxy);
    return proxy as T;
  }

  validateSupportedContractShape(implementation);
  return wrap(implementation);
}
