import { v7 } from 'uuid';
import type { CallContext } from '@nous-wave/contracts/common';
import { taskRequest,type TaskRequest,taskBudget } from '@heptalogos/contracts';
import { sql,type Kysely } from 'kysely';
import type { Database,Json } from '../platform/database.js';
import { authorize,read,list,put,problem,realTime,makeRef,idempotent } from '../platform/runtime.js';
export interface NativeProgress {status:string;progress?:string;result?:{conclusion?:string;outputRef?:unknown;outputRefs?:unknown[];sourceRefs?:unknown[];artifacts?:unknown[];unresolved?:string[]};runId?:string;sessionId?:string}
export interface ExecutionHost {
 start(taskId:string,request:TaskRequest,ctx:CallContext):Promise<{runId:string;sessionId?:string}>;
 inspect(runId:string,sessionId?:string):Promise<NativeProgress>;
 locate?(taskId:string,subjectId:string):Promise<NativeProgress>;
 transcript?(runId:string,sessionId:string,options?:{cursor?:string;offset?:number}):Promise<unknown>;
 purge?(runId:string,sessionId:string):Promise<{deleted:string[];pending:string[]}>;
 cancel(runId:string,sessionId?:string):Promise<unknown>;
}
export function work(db:Kysely<Database>,installationId:string,host?:ExecutionHost){
 async function inspect(ctx:CallContext,id:string){
  authorize(ctx,'tasks.read');let task=await read(db,'tasks',ctx.subjectId,id);if(!host||['completed','result_ready','cancelled','failed'].includes(task.status as string)||task.paused)return task;
  const native=task.runId?await host.inspect(task.runId as string,task.sessionId as string):['starting','unknown'].includes(task.status as string)&&host.locate?await host.locate(id,ctx.subjectId):undefined;if(!native)return task;
  return db.transaction().execute(async tx=>{
   await tx.selectFrom('tasks').select('id').where('subjectId','=',ctx.subjectId).where('id','=',id).forUpdate().execute();task=await read(tx,'tasks',ctx.subjectId,id);if(['completed','result_ready','cancelled','failed'].includes(task.status as string)||task.paused)return task;
   const status=native.result?'result_ready':native.status;const updated=await put(tx,'tasks',ctx.subjectId,{...task,status,nativeStatus:native.status,progress:native.progress,...(native.runId?{runId:native.runId,sessionId:native.sessionId}:{}),...(native.result?{result:native.result,resultFormedAt:realTime()}:{}),lastInspectedAt:realTime()},id,task.revision as number);
   if(native.result)await put(tx,'opportunities',ctx.subjectId,{kind:'work',originRef:makeRef(installationId,ctx.subjectId,'task',id,updated.revision),availableAt:realTime(),state:'unnoticed',conversationId:(task.returnTarget as Json|undefined)?.conversationId,notice:{title:task.goal,resultReady:true}});
   return updated;
  });
 }
 return {
 async create(ctx:CallContext,input:unknown){authorize(ctx,'tasks.start');const request=taskRequest.parse(input);return idempotent(db,`task:${ctx.subjectId}:${ctx.actor.id}:${request.clientSubmissionId}`,request,async tx=>{const id=v7();return put(tx,'tasks',ctx.subjectId,{...request,status:'queued',budgetOwnerId:id},id);},ctx.subjectId);},
 async startNative(ctx:CallContext,id:string){authorize(ctx,'tasks.start');const task=await read(db,'tasks',ctx.subjectId,id);if(task.runId||['starting','unknown'].includes(task.status as string))return inspect(ctx,id);if(!host)return put(db,'tasks',ctx.subjectId,{...task,status:'waiting',waitingReason:'OpenClaw execution host is not configured'},id,task.revision as number);await put(db,'tasks',ctx.subjectId,{...task,status:'starting'},id,task.revision as number);try{const run=await host.start(id,task as unknown as TaskRequest,ctx);const latest=await read(db,'tasks',ctx.subjectId,id);return put(db,'tasks',ctx.subjectId,{...latest,...run,status:'waiting',nativeStatus:'accepted',waitingReason:'Awaiting native run confirmation'},id,latest.revision as number);}catch(error){const latest=await read(db,'tasks',ctx.subjectId,id);return put(db,'tasks',ctx.subjectId,{...latest,status:'unknown',error:String(error)},id,latest.revision as number);}},
 inspect,
 async result(ctx:CallContext,id:string){authorize(ctx,'tasks.read');const task=await read(db,'tasks',ctx.subjectId,id);if(!task.result)problem('capability_unavailable','Task result is not ready',409);return {taskId:id,returnTarget:task.returnTarget,result:task.result};},
 async transcript(ctx:CallContext,id:string,options?:{cursor?:string;offset?:number}){authorize(ctx,'tasks.debug');const task=await read(db,'tasks',ctx.subjectId,id);if(!host?.transcript||!task.runId||!task.sessionId)problem('capability_unavailable','Native history is unavailable',409);return host.transcript(task.runId as string,task.sessionId as string,options);},
 async purgeNative(ctx:CallContext){authorize(ctx,'data.purge');const tasks=(await list(db,'tasks',ctx.subjectId)).filter(t=>t.runId&&t.sessionId);const deleted:string[]=[],pending:string[]=[];for(const task of tasks){if(!host?.purge){pending.push(`native:${task.id}`);continue;}try{const result=await host.purge(task.runId as string,task.sessionId as string);deleted.push(...result.deleted);pending.push(...result.pending);}catch(error){pending.push(`native:${task.id}:${String(error)}`);}}return {deleted,pending};},
 async cancel(ctx:CallContext,id:string){authorize(ctx,'tasks.cancel');const task=await read(db,'tasks',ctx.subjectId,id);if(task.runId&&host)await host.cancel(task.runId as string,task.sessionId as string);return put(db,'tasks',ctx.subjectId,{...task,status:'cancelled'},id,task.revision as number);},
 async pause(ctx:CallContext,id:string){authorize(ctx,'tasks.cancel');const task=await read(db,'tasks',ctx.subjectId,id);if(task.runId&&host)await host.cancel(task.runId as string,task.sessionId as string);return put(db,'tasks',ctx.subjectId,{...task,status:'waiting',paused:true,waitingReason:'Paused; resume creates a continuation of the cancelled native run.'},id,task.revision as number);},
 async resume(ctx:CallContext,id:string){authorize(ctx,'tasks.start');const task=await read(db,'tasks',ctx.subjectId,id);if(!task.paused&&!['failed','cancelled'].includes(task.status as string))problem('conflict','Cancel or pause the original native task before starting a continuation',409);const next=v7();return put(db,'tasks',ctx.subjectId,{...task,continuedFrom:id,budgetOwnerId:task.budgetOwnerId??id,paused:false,runId:undefined,sessionId:undefined,result:undefined,status:'queued',clientSubmissionId:`continuation:${id}:${task.revision}`},next);},
 async list(ctx:CallContext){authorize(ctx,'tasks.read');return {items:await list(db,'tasks',ctx.subjectId)};},
 async workspaces(ctx:CallContext,input?:Json){authorize(ctx,input?'workspaces.write':'workspaces.read');return input?put(db,'workspaces',ctx.subjectId,input):{items:await list(db,'workspaces',ctx.subjectId)};}
 };}
export async function readTaskBudget(db:Kysely<Database>,subjectId:string,id:string){const task=await read(db,'tasks',subjectId,id);const ownerId=(task.budgetOwnerId as string|undefined)??id;const owner=ownerId===id?task:await read(db,'tasks',subjectId,ownerId);return {ownerId,budget:taskBudget.parse(owner.budget??{})};}
