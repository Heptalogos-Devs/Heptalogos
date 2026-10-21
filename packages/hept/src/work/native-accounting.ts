import type {CallContext} from '@nous-wave/contracts/common';
import {NativeOriginSchema,type NativeInvocationPrepare,type NativeInvocationCompletion} from '@nous-wave/contracts/models';
import type {TimeCaptureReceipt} from '@nous-wave/contracts/time';
import type {Models} from '@nous-wave/platform/models';
import type {work} from './index.js';
import {problem} from '../platform/runtime.js';
/** Host credential proves source facts; the saved Task supplies the actual Worker identity. */
export function nativeAccounting(models:Models,tasks:ReturnType<typeof work>){return {
 async prepare(hostContext:CallContext,input:NativeInvocationPrepare){
  const ctx=await tasks.validatePreparation(hostContext,input);
  const call=await models.native.prepare(ctx,input,{hostContext});await tasks.registerInvocation(ctx,call);return call;
 },
 async dispatch(hostContext:CallContext,input:{invocationId:string;observed?:TimeCaptureReceipt}){
  const call=await models.invocations.read(hostContext,{invocationId:input.invocationId});const native=NativeOriginSchema.parse(call.native);
  const {ctx}=await tasks.workerContext(hostContext,native,'dispatch');
  return models.native.dispatch(ctx,{invocationId:input.invocationId,observed:input.observed},{hostContext});
 },
 async complete(hostContext:CallContext,input:NativeInvocationCompletion){
  if(input.formed)problem('invalid_input','Native completion time is recorded from the original observation proof');
  const call=await models.invocations.read(hostContext,{invocationId:input.invocationId});const native=NativeOriginSchema.parse(call.native);
  const ctx=await tasks.validateCompletion(hostContext,{...input,native});
  return models.native.complete(ctx,input,{hostContext});
 },
};}
