# @heptalogos/network-access

## Purpose

network-access owns the current Host-originated outbound transport policy and
the narrow custom fetch route required by configured AI gateways.

## Owns

- GatewayProfile-derived origin/path/method policy for AI protocol requests.
- The `ai.gateway.transport.v1` ConfigurationDefinition and JSON Schema for
  the transport values consumed by this package and AIRuntime.
- Requester, HTTPS origin/path/method, redirect, header, deadline, and byte
  budget enforcement.
- Abort/timeout and redacted transport diagnostics.
- Conversion of the admitted response back to the standard Fetch Response.

## Does not own

- Provider/model semantics, external-effect truth, retry policy, or proxy/VPN
  infrastructure.
- Networking inside OpenClaw, MCP stdio, or other opaque external processes.
- Configuration activation or Secret material resolution.

## Verification

Current provider and native access checks live in Product Host gateway
integration and OpenClaw Host tests. Run the affected consumer boundary and
package lint/typecheck when access handling changes.

## Knowledge references

- [NetworkAccess Spec](../../../specs/system/network-access.md)
- [AI Runtime Spec](../../../specs/system/ai-runtime.md)
- [Dependency route](../../../project/dependencies/dependency-routing.json)
