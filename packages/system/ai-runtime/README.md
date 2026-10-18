# @heptalogos/ai-runtime

## Purpose

ai-runtime owns the current GatewayProfile, ModelProfile, ModelBinding, and
structured InvocationSpec semantics. It materializes AI SDK 7 Chat-compatible
and Open Responses-compatible protocol mechanics only inside the runtime boundary.

## Owns

- The current gateway/profile/model/binding identities and generations.
- Exact binding/configuration/Secret/NetworkAccess readiness.
- Provider-neutral ephemeral messages and structured generation results.
- SchemaRuntime validation and Lineage/Evidence attribution.

The internal module split is `repository.ts` for persistence and row codecs,
`routing.ts` for profile/binding and readiness semantics, `invocation.ts` for
bounded provider invocation mechanics, and `service.ts` for composition. AI
SDK objects remain behind the runtime boundary; this package does not add a
ProviderRegistry.

## Does not own

- Subject identity, prompt/context Authority, behavior commit, or tools/MCP.
- Provider-hosted state, streaming, embeddings, files, failover, or agents.
- Configuration activation, Secret storage, Network policy, or Management auth.

## Verification

Current Product Host model work uses the native role/provider path. Its
protocol, trusted effects and delivery checks live in Product Host integration
and OpenClaw Host tests. The earlier AIRuntime qualification results remain in
`project/qualification/results/Q-AI-GATEWAY-CHAT-01.md` as historical evidence.

## Knowledge references

- [AI Runtime Spec](../../../specs/system/ai-runtime.md)
- [NetworkAccess Spec](../../../specs/system/network-access.md)
- [Configuration Spec](../../../specs/system/configuration.md)
