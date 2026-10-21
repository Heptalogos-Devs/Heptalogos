import type {CallContext} from '@nous-wave/contracts/common';
import type {ContextPrepareInput} from '@nous-wave/contracts/cognition';
import type {NativeClient} from '../platform/execution.js';
import type {CognitionConnection} from '../platform/models.js';
import type {work} from './index.js';
import type {Time} from '../time/index.js';
import type {Models} from '@nous-wave/platform/models';
import {NativeOriginSchema} from '@nous-wave/contracts/models';
import {EncounterAcceptSchema} from '@nous-wave/contracts/materials';
import {digest} from '../platform/runtime.js';
import {problem} from '../platform/runtime.js';
type NativeSession=Parameters<NativeClient['readSession']>[0];
/** Four semantic operations reuse the same actual Task Worker and its Nous child authority. */
export function nativeCognition(tasks:ReturnType<typeof work>,cognition:CognitionConnection,time:Time,models:Models){return {
 async capture(host:CallContext,native:NativeSession,input:unknown){const {ctx}=await tasks.sessionContext(host,native);return cognition.capture(ctx,input);},
 async prepare(host:CallContext,native:NativeSession,input:ContextPrepareInput){const {ctx}=await tasks.sessionContext(host,native);return cognition.prepare(ctx,{...input,consumer:ctx.consumer,observed:(await time.read(ctx)).now.point});},
 async accept(host:CallContext,native:NativeSession,input:unknown){const accepted=EncounterAcceptSchema.parse(input),{ctx}=await tasks.sessionContext(host,native),call=await models.invocations.read(host,{invocationId:accepted.invocationId}),origin=NativeOriginSchema.parse(call.native);if(origin.runtimeId!==native.runtimeId||origin.sessionKey!==native.sessionKey||origin.sessionId!==native.sessionId||origin.runId!==native.runId||call.subjectId!==ctx.subjectId||digest(call.consumer)!==digest(ctx.consumer)||!call.observed)problem('forbidden','Encounter does not belong to the actual observed native invocation',403);const proof=await tasks.workerContext(host,origin,'complete');if(!proof.facts.terminal)problem('conflict','Native invocation has no actual terminal outcome',409);return cognition.accept(ctx,{...accepted,observed:call.observed.point,purpose:ctx.purpose});},
 async uploadBlob(host:CallContext,native:NativeSession,body:ReadableStream<Uint8Array>,mediaType:string){const {ctx}=await tasks.sessionContext(host,native);if(!cognition.uploadBlob)problem('capability_unavailable','Nous blob capture is unavailable',503);return cognition.uploadBlob(ctx,body,mediaType);},
};}
