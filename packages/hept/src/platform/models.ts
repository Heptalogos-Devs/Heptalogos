import {DBOS} from '@dbos-inc/dbos-sdk';
import {Output} from 'ai';
import type {z} from 'zod';
import type {Models} from '@nous-wave/platform/models';
import type {CallContext,Ref,Policy,TimeRange,Consumer} from '@nous-wave/contracts/common';
import type {ContextPrepareInput,ContextView} from '@nous-wave/contracts/cognition';
import type {MaterialView,BlobResult} from '@nous-wave/contracts/materials';
import {permits} from '../communication/media.js';
import {problem} from './runtime.js';
export interface RemoteWorkerAuthority {delegationId:string;authorityRef:string;revision:number;consumer:Consumer;parentAuthorityRef:string;baseURL:string}
export interface CognitionConnection {
 workerBindings?:{bind(ctx:CallContext,input:{taskRef:Ref;scope:import('@nous-wave/platform/credentials').DelegationScope}):Promise<RemoteWorkerAuthority|undefined>;revoke(ctx:CallContext,input:RemoteWorkerAuthority):Promise<void>};
 uploadBlob?(ctx:CallContext,bytes:Uint8Array|Blob|ReadableStream<Uint8Array>,mediaType:string):Promise<BlobResult>;
 available?(ctx:CallContext):Promise<boolean>;
 validateSources?(ctx:CallContext,refs:readonly Ref[]):Promise<void>;
 prepare(ctx:CallContext,input:ContextPrepareInput):Promise<ContextView>;
 readContextView(ctx:CallContext,ref:Ref):Promise<ContextView>;
 accept(ctx:CallContext,input:unknown):Promise<unknown>;
 capture(ctx:CallContext,input:unknown):Promise<{ref:Ref}>;
 publish(ctx:CallContext,ref:Ref):Promise<MaterialView>;
 read(ctx:CallContext,ref:Ref):Promise<MaterialView>;
 growth(ctx:CallContext,input:{apply:boolean}):Promise<unknown>;
}
/** Product semantics use the shared physical-call owner and the SDK's actual prepareStep. */
export function models(shared:Models,cognition:CognitionConnection){return {
 async generate<T=string>(ctx:CallContext,role:string,input:{promptParams:unknown;situation:string;query?:string;materials:{ref:Ref;text:string;policy?:Policy;occurred?:TimeRange}[];schema?:z.ZodType<T>;invocationId:string}):Promise<T>{
  const callCtx={...ctx,trace:{...ctx.trace,operationId:input.invocationId}},connected=!cognition.available||await cognition.available(callCtx);
  for(const material of input.materials)if(material.policy&&!permits(material.policy,ctx))problem('forbidden','Model input policy denies this purpose or audience',403);
  const capture=async()=>{if(!connected)return input.materials;const captured=[];for(let index=0;index<input.materials.length;index++){const material=input.materials[index];if(material.ref.product==='nous'){captured.push(material);continue;}const saved=await cognition.capture({...callCtx,trace:{...callCtx.trace,operationId:`${input.invocationId}/source/${index}`}},{kind:'message',mediaType:'text/plain',text:material.text,source:{ref:material.ref,roots:[material.ref]},policy:material.policy,occurred:material.occurred});captured.push({...material,ref:saved.ref});}return captured;};
  const materials=DBOS.isWithinWorkflow()?await DBOS.runStep(capture,{name:`${role}.captureActualSources`,retriesAllowed:false}):await capture();
  const result=await shared.text.generate(callCtx,{roleId:role,inputRefs:materials.map(item=>item.ref),promptParams:input.promptParams,
   contextHooks:{async prepare(actual,step){
    const definition=step.snapshot.definition.managedBy==='sdk'?step.snapshot.definition.definition:step.snapshot.definition.binding;
    if(input.schema&&!definition.capabilities.includes('structured'))problem('capability_unavailable','This role requires structured output capability',503);
    if(!connected)return {inputRefs:materials.map(item=>item.ref)};
    if(!definition.contextLimit||!definition.outputLimit)problem('capability_unavailable','Model context and output metadata are required',503);
    const instructions=typeof step.baseInstructions==='string'?step.baseInstructions:JSON.stringify(step.baseInstructions);
    const contextCtx={...actual,trace:{...actual.trace,operationId:`${input.invocationId}/step${step.stepNumber}/context`}};
    const prepared=step.previousPreparation?.contextRef
     ?await cognition.readContextView(contextCtx,step.previousPreparation.contextRef)
     :await cognition.prepare(contextCtx,{consumer:actual.consumer,role,roleTask:instructions,situation:JSON.stringify({situation:input.situation,messages:step.messages,tools:Object.keys(step.tools)}),query:input.query,latestMaterials:materials.map(material=>({ref:material.ref,text:material.text,required:true})),model:{resourceId:step.snapshot.actualResource.id,modelId:step.snapshot.actualModelId,contextLimit:definition.contextLimit},budget:{outputTokens:Math.min(definition.outputLimit,step.snapshot.policy.kind==='language'?step.snapshot.policy.inference.maxOutputTokens:definition.outputLimit),toolTokens:0,requiredTokens:0,mediaTokens:0},observed:step.referenceTime.point});
    return {instructions:prepared.blocks.filter(block=>block.kind!=='task').map(block=>block.text).join('\n\n'),inputRefs:prepared.inputPortions.map(portion=>({...portion.ref,...(portion.selector?{selector:portion.selector}:{})})),contextRef:prepared.ref};
   }},
   options:{prompt:connected?'依据当前情境完成本次职责。':`${input.situation}\n\n${materials.map(item=>item.text).join('\n')}`,output:(input.schema?Output.object({schema:input.schema}):Output.text()) as any},
  });return result.output as T;
 },
};}
