import {permits} from '../communication/media.js';
import { invocations } from '../management/invocations.js';
import { APICallError,generateText,Output,wrapLanguageModel,type LanguageModelMiddleware } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { durableCalls } from '@dbos-inc/vercel-ai';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { z } from 'zod';
import type { CallContext,Ref,Policy,TimeRange } from '@nous-wave/contracts/common';
import type { ContextPrepareInput,ContextView } from '@nous-wave/contracts/cognition';
import type { ModelResource } from '@heptalogos/contracts';
import type { Kysely } from 'kysely';
import type { Database,Json } from './database.js';
import { list,put,read,problem,now,realTime,makeRef } from './runtime.js';
import type { management } from '../management/index.js';
export interface CognitionConnection {
 available?(ctx:CallContext):Promise<boolean>;
 prepare(ctx:CallContext,input:ContextPrepareInput):Promise<ContextView>;
 accept(ctx:CallContext,input:unknown):Promise<unknown>;
 capture(ctx:CallContext,input:unknown):Promise<{ref:Ref}>;
 growth(ctx:CallContext,input:unknown):Promise<unknown>;
}
export function models(db:Kysely<Database>,installationId:string,managementApi:ReturnType<typeof management>,cognition?:CognitionConnection){
 const billing=invocations(db,managementApi);
 return {async generate<T=string>(ctx:CallContext,role:string,input:{system:string;situation:string;query?:string;materials:{ref:Ref;text:string;policy?:Policy;occurred?:TimeRange}[];schema?:z.ZodType<T>;invocationId:string;observed?:{clockId:string;at:string}}):Promise<T>{
  for(const material of input.materials)if(material.policy&&!permits(material.policy,ctx))problem('forbidden','Model input policy denies current purpose or audience',403);
  const settings=(await managementApi.effective(ctx.subjectId,role)).effective;
  const resourceId=role==='expression'?settings.expressionModel:role==='author'?settings.authorModel:settings.deliberationModel;
  const resource=(await list(db,'modelResources','installation')).find(m=>m.id===resourceId) as ModelResource|undefined;if(!resource)problem('capability_unavailable',`Configure a model for ${role}`,503);
  if(input.schema&&!resource.capabilities.includes('structured'))problem('capability_unavailable',`Role ${role} needs structured output capability`,503);
  const invocationId=input.invocationId;const observedTime=await DBOS.runStep(async()=>input.observed??realTime(),{name:`${role}.observedTime`});const useCognition=cognition&&(!cognition.available||await cognition.available(ctx))?cognition:undefined;
  const latestMaterials=await DBOS.runStep(async()=>{if(!useCognition)return input.materials;const captured=[];for(let index=0;index<input.materials.length;index++){const material=input.materials[index];const value=await useCognition!.capture({...ctx,purpose:role,traceContext:{...ctx.traceContext,operationId:`${invocationId}:input:${index}`}},{kind:'message',mediaType:'text/plain',text:material.text,source:{ref:material.ref,roots:[material.ref]},policy:material.policy,occurred:material.occurred??{start:observedTime}});captured.push({ref:value.ref,text:material.text});}return captured;},{name:`${role}.captureInputs`,retriesAllowed:false});
  const prepared=await DBOS.runStep(async()=>useCognition?useCognition.prepare({...ctx,purpose:role,traceContext:{...ctx.traceContext,operationId:`${invocationId}:prepare`}},{consumer:{kind:'subject',host:installationId,id:ctx.subjectId},role,roleTask:input.system,situation:input.situation,query:input.query,latestMaterials:latestMaterials.map(m=>({...m,required:true})),model:{resourceId:resource.id,modelId:resource.modelId,contextLimit:resource.contextLimit},budget:{outputTokens:resource.outputLimit,toolTokens:0,requiredTokens:0,mediaTokens:0},observed:observedTime}):null,{name:`${role}.prepare`,retriesAllowed:false});
  const system=prepared?prepared.blocks.map(b=>b.text).join('\n\n'):input.system;
  const prompt=prepared?'依据上述情境完成本次职责。':`${input.situation}\n\n${input.materials.map(m=>m.text).join('\n')}`;
  const metadata:LanguageModelMiddleware={specificationVersion:'v4',wrapGenerate:async({doGenerate})=>{
   await billing.prepare(ctx,{invocationId,role,modelResourceId:resource.id,inputTokensEstimate:Array.from(system+prompt+(input.schema?JSON.stringify(z.toJSONSchema(input.schema)):'')).length,maxOutputTokens:resource.outputLimit,inputRefs:latestMaterials.map(m=>m.ref)});
   await billing.dispatch(ctx,invocationId);
   try{return await doGenerate();}catch(error){await billing.complete(ctx,invocationId,{status:APICallError.isInstance(error)&&error.statusCode!==undefined&&error.statusCode>=400&&error.statusCode<500&&error.statusCode!==408?'not_sent':'unknown'});throw error;}
  }};
  const provider=createOpenAICompatible({name:resource.provider,baseURL:resource.baseURL,apiKey:await managementApi.secret(resource.credentialRef),supportsStructuredOutputs:resource.capabilities.includes('structured')});
  const accept:LanguageModelMiddleware={specificationVersion:'v4',wrapGenerate:async({doGenerate})=>{const raw=await doGenerate();
   await DBOS.runStep(async()=>{
    await billing.complete(ctx,invocationId,{status:'completed',inputTokens:raw.usage.inputTokens.total,outputTokens:raw.usage.outputTokens.total,cacheReadTokens:raw.usage.inputTokens.cacheRead,cacheWriteTokens:raw.usage.inputTokens.cacheWrite,providerRequestId:raw.response?.id});
    if(useCognition){const output=await useCognition!.capture({...ctx,purpose:role,traceContext:{...ctx.traceContext,operationId:`${invocationId}:output`}},{kind:'model_output',mediaType:'application/json',text:JSON.stringify(raw.content),source:{inputs:prepared?prepared.inputPortions.map(m=>m.ref):latestMaterials.map(m=>m.ref)},occurred:{start:observedTime}});const invocation=await read(db,'modelInvocations',ctx.subjectId,invocationId);if(!invocation.cognitionOutputRef)await put(db,'modelInvocations',ctx.subjectId,{...invocation,cognitionOutputRef:output.ref},invocationId,invocation.revision as number);await useCognition.accept({...ctx,purpose:role,traceContext:{...ctx.traceContext,operationId:`${invocationId}:accept`}},{consumer:{kind:'subject',host:installationId,id:ctx.subjectId},invocationId,step:0,contextViewRef:prepared?.ref,portions:(prepared?.inputPortions??latestMaterials).map(m=>({ref:m.ref})),resultRef:output.ref,observed:observedTime,purpose:role,completion:'complete'});}
   },{name:`${role}.accept`,retriesAllowed:false});return raw;
  }};
  const inner=wrapLanguageModel({model:provider.chatModel(resource.modelId),middleware:metadata});
  const durable=wrapLanguageModel({model:inner,middleware:durableCalls({name:`${role}.model`,retriesAllowed:false})});
  const model=wrapLanguageModel({model:durable,middleware:accept});
  const result=await generateText({model,system,prompt,output:(input.schema?Output.object({schema:input.schema}):Output.text()) as any,maxOutputTokens:resource.outputLimit,providerOptions:resource.providerOptions,maxRetries:0});
  return result.output as T;
 }};
}
