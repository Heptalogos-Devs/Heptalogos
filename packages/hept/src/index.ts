import {startTelemetry,operationTrace} from './platform/telemetry.js';
import {sourcePolicies} from './management/sources.js';
import { executionHost } from './platform/execution.js';
import { invocations } from './management/invocations.js';
import { cognitionConnection } from './platform/cognition.js';
import { dataManagement } from './management/data.js';
import pg from 'pg';
import { createAuthentication } from './platform/auth.js';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { KyselyDataSource } from '@dbos-inc/kysely-datasource';
import type { CallContext } from '@nous-wave/contracts/common';
import { receiveMessage,bootstrapSchema,type MessagePart } from '@heptalogos/contracts';
import { v7 } from 'uuid';
import { connect,type Database,type Json } from './platform/database.js';
import { read,list,put,authorize,realTime,now,makeRef,digest,problem } from './platform/runtime.js';
import { identity } from './identity/index.js';
import { management } from './management/index.js';
import { readableParts,communication } from './communication/index.js';
import { world } from './world/index.js';
import { agency } from './agency/index.js';
import { models,type CognitionConnection } from './platform/models.js';
import { work,type ExecutionHost } from './work/index.js';
export { callContext } from './platform/runtime.js';
export type { CognitionConnection,ExecutionHost };
export async function createHept(options:{bootstrap:unknown;cognition?:CognitionConnection;executionHost?:ExecutionHost;launch?:boolean}){
 const config=bootstrapSchema.parse(options.bootstrap),db=await connect(config.databaseURL);const telemetry=startTelemetry(config.installationId);
 const subjectContext=(ctx:CallContext):CallContext=>({...ctx,actor:{kind:'subject',id:ctx.subjectId,subjectIds:[ctx.subjectId],grants:['agency.*','subjects.read','messages.read','messages.send','world.*','activities.*','pursuits.*','tasks.*','commitments.*','models.invoke']},purpose:'deliberation'});
 const ds=new KyselyDataSource<Database>('hept-business',db);
 const identityApi=identity(db),managementApi=management(db,config.dataRoot),communicationApi=communication(db,config.installationId,config.dataRoot,managementApi.secret,async subjectId=>(await managementApi.effective(subjectId)).effective.media,{baseURL:config.publicURL??`http://${config.host}:${config.port}`,signingSecret:()=>managementApi.secret(config.authSecretRef),settings:async sid=>(await managementApi.effective(sid)).effective}),worldApi=world(db,config.installationId),cognitionApi=options.cognition??cognitionConnection(managementApi),modelApi=models(db,config.installationId,managementApi,cognitionApi),agencyApi=agency(db,ds,config.installationId,worldApi,communicationApi,modelApi,managementApi),workApi=work(db,config.installationId,options.executionHost??(config.openclaw?executionHost(config.openclaw,managementApi.secret):undefined));
 const authPool=new pg.Pool({connectionString:config.databaseURL,max:2});
 const authentication=await createAuthentication(authPool,await managementApi.secret(config.authSecretRef),`http://${config.host}:${config.port}`);
 const reflect=DBOS.registerWorkflow(async(ctx:CallContext)=>{
  if(cognitionApi.available&&!await cognitionApi.available(ctx))return {skipped:true};
  return DBOS.runStep(()=>cognitionApi.growth({...ctx,purpose:'growth',audience:[],traceContext:{...ctx.traceContext,operationId:`${DBOS.workflowID}:growth`}},{apply:true}),{name:'cognition.growth',retriesAllowed:false});
 },{name:'hept.cognition.reflect'});
 const send=DBOS.registerWorkflow(async(ctx:CallContext,expressionId:string)=>{
  const result=await DBOS.runStep(()=>communicationApi.dispatch(ctx,expressionId),{name:'messages.dispatch',retriesAllowed:false});
  const observed=await DBOS.runStep(async()=>(await worldApi.situation(ctx.subjectId)).time,{name:'messages.sentTime'});
  await DBOS.runStep(async()=>{
   if(cognitionApi.available&&!await cognitionApi.available(ctx))return;
   const expression=await read(db,'expressions',ctx.subjectId,expressionId);const intent=expression.intent as Json;const invocation=expression.modelInvocationId?await read(db,'modelInvocations',ctx.subjectId,expression.modelInvocationId as string):undefined;
   const material=await cognitionApi.capture({...ctx,purpose:'growth',audience:[],traceContext:{...ctx.traceContext,operationId:`send:${expressionId}:result`}},{kind:'communication_result',mediaType:'text/plain',text:`向 ${intent.conversationId} 表达：${readableParts(expression.parts as MessagePart[])}\n实际平台结果：${JSON.stringify(result.parts.map(part=>({status:part.status,platformMessageId:part.platformMessageId})))}`,source:{ref:makeRef(config.installationId,ctx.subjectId,'expression',expressionId),inputs:invocation?.cognitionOutputRef?[invocation.cognitionOutputRef]:[],roots:result.parts.map(part=>makeRef(config.installationId,ctx.subjectId,'delivery',part.id as string))},occurred:{start:observed},policy:{readers:[ctx.subjectId],purposes:['deliberation','expression','growth'],audiences:intent.audience}});
   await cognitionApi.accept({...ctx,purpose:'growth',audience:[],traceContext:{...ctx.traceContext,operationId:`send:${expressionId}:accept`}},{consumer:{kind:'subject',host:config.installationId,id:ctx.subjectId},invocationId:`send:${expressionId}`,step:'delivery',portions:[{ref:material.ref}],observed,purpose:'communication'});
  },{name:'messages.acceptActualResult',retriesAllowed:false});
  await DBOS.startWorkflow(reflect,{workflowID:`reflect:send:${expressionId}`,queueName:'hept.cognition',enqueueOptions:{queuePartitionKey:ctx.subjectId},workflowAttributes:{subjectId:ctx.subjectId,operation:'growth.run'}})(ctx);return result;
 },{name:'hept.messages.sendExpression'});
 const express=DBOS.registerWorkflow(async(ctx:CallContext,input:{intent:Json;parts:MessagePart[];clientSubmissionId:string})=>{const expression=await ds.runTransaction(()=>communicationApi.createExpression(ds.client,ctx,input),{name:'messages.prepareAuthorizedExpression'});await DBOS.startWorkflow(send,{workflowID:`send:${expression.id}`,workflowAttributes:{subjectId:ctx.subjectId,operation:'messages.sendExpression'}})(ctx,expression.id as string);return expression;},{name:'hept.messages.prepareExpression'});
 const next=DBOS.registerWorkflow(async(ctx:CallContext,nodeId:string,revision:number)=>{const node=await DBOS.runStep(()=>read(db,'nextNodes',ctx.subjectId,nodeId),{name:'agency.readNode'});if(node.revision!==revision||node.state==='cancelled')return;await DBOS.startWorkflow(react,{workflowID:`node:${nodeId}:${revision}`,queueName:'hept.subject',enqueueOptions:{queuePartitionKey:ctx.subjectId},workflowAttributes:{subjectId:ctx.subjectId,operation:'agency.react'}})(ctx,'natural');},{name:'hept.agency.nextNode'});
 async function schedule(ctx:CallContext,chosenAt?:{clockId:string;at:string}){
  const at=chosenAt??await DBOS.runStep(()=>worldApi.nextBoundary(ctx.subjectId),{name:'world.nextBoundary'});
  const node=await agencyApi.nextNode(ctx,at,'natural_boundary');const w=await DBOS.runStep(()=>worldApi.current(ctx.subjectId),{name:'world.nodeClock'});const clock=w?.clock as any;const delay=clock?.paused||clock?.rate===0?null:Math.max(0,(Date.parse(at.at)-Date.parse((w?.realizedThrough as string)??now()))/(clock?.rate??1));if(delay!==null)await DBOS.startWorkflow(next,{workflowID:`wait:${node.id}:${node.revision}`,queueName:'hept.nodes',enqueueOptions:{delaySeconds:delay/1000},workflowAttributes:{subjectId:ctx.subjectId,operation:'agency.nextNode'}})(ctx,node.id,node.revision);return node;
 }
 async function enqueueTaskPoll(ctx:CallContext,taskId:string,attempt:number){await DBOS.startWorkflow(taskPoll,{workflowID:`task-poll:${taskId}:${attempt}`,queueName:'hept.work',enqueueOptions:{queuePartitionKey:taskId,delaySeconds:Math.min(60,2**Math.min(attempt,6))},workflowAttributes:{subjectId:ctx.subjectId,operation:'tasks.inspect'}})(ctx,taskId,attempt);}
 const taskPoll=DBOS.registerWorkflow(async(ctx:CallContext,taskId:string,attempt:number)=>{
  let state:Json;try{state=await DBOS.runStep(()=>workApi.inspect(ctx,taskId),{name:'tasks.inspectNative',retriesAllowed:false});}catch(error){await DBOS.runStep(async()=>{const old=await read(db,'tasks',ctx.subjectId,taskId);return put(db,'tasks',ctx.subjectId,{...old,lastInspectionError:String(error)},taskId,old.revision as number);},{name:'tasks.recordInspectionFailure'});await enqueueTaskPoll(ctx,taskId,attempt+1);return;}
  if(state.status==='result_ready'){const subject=await DBOS.runStep(()=>read(db,'subjects',ctx.subjectId,ctx.subjectId),{name:'tasks.returnSubject'});if(subject.runtime==='running')await DBOS.startWorkflow(react,{workflowID:`task-result:${taskId}`,queueName:'hept.subject',enqueueOptions:{queuePartitionKey:ctx.subjectId},workflowAttributes:{subjectId:ctx.subjectId,operation:'agency.react'}})(subjectContext(ctx),'work');}
  else if(!state.paused&&['running','waiting','unknown','starting'].includes(state.status as string)&&(state.runId||['unknown','starting'].includes(state.status as string)))await enqueueTaskPoll(ctx,taskId,attempt+1);
  return state;
 },{name:'hept.tasks.poll'});
 const task=DBOS.registerWorkflow(async(ctx:CallContext,taskId:string)=>{const state=await DBOS.runStep(()=>workApi.startNative(ctx,taskId),{name:'tasks.startNative',retriesAllowed:false});if(state.runId||state.status==='unknown')await enqueueTaskPoll(ctx,taskId,0);return state;},{name:'hept.tasks.start'});
 const react=DBOS.registerWorkflow(async(ctx:CallContext,trigger:string='manual')=>{
  await ds.runTransaction(()=>worldApi.advanceIn(ds.client,ctx.subjectId),{name:'world.advanceTo'});
  const prepared=await DBOS.runStep(()=>agencyApi.prepare(ctx,trigger),{name:'agency.prepare'});const initialNode=await schedule(ctx);if(prepared.deferred)return {deferred:true,nextNode:initialNode};
  let chosen=await agencyApi.choose(ctx,prepared,`${DBOS.workflowID}:deliberation:0`);
  for(let round=1;round<=3;round++){const readIds=chosen.actions.flatMap(a=>a.kind==='read'?a.messageIds:[]);if(readIds.length===0)break;const materials=await DBOS.runStep(()=>agencyApi.readMessages(ctx,readIds),{name:'agency.readSelectedMessages'});chosen=await agencyApi.choose(ctx,{...prepared,materials},`${DBOS.workflowID}:deliberation:${round}`);await agencyApi.noteRead(ctx,readIds);}
  const adopted=await agencyApi.adopt(ctx,chosen,prepared.opportunities.map(o=>o.id as string),trigger);
  const expression=await agencyApi.render(ctx,adopted,`${DBOS.workflowID}:expression`);
  if(expression)await DBOS.startWorkflow(send,{workflowID:`send:${expression.id}`,workflowAttributes:{subjectId:ctx.subjectId,operation:'messages.sendExpression'}})(ctx,expression.id as string);
  for(const effect of adopted.effects as Json[]){const tasks=await DBOS.runStep(()=>list(db,'tasks',ctx.subjectId),{name:'tasks.readPending'});if(tasks.some(t=>t.id===effect.id))await DBOS.startWorkflow(task,{workflowID:`task:${effect.id}`,workflowAttributes:{subjectId:ctx.subjectId,operation:'tasks.start'}})(ctx,effect.id as string);}
  const node=await schedule(ctx,chosen.reconsiderAt);
  if(!expression)await DBOS.startWorkflow(reflect,{workflowID:`reflect:${DBOS.workflowID}`,queueName:'hept.cognition',enqueueOptions:{queuePartitionKey:ctx.subjectId},workflowAttributes:{subjectId:ctx.subjectId,operation:'growth.run'}})(ctx);
  return {decisionId:adopted.id,expressionId:expression?.id,nextNode:node};
 },{name:'hept.agency.react'});
 const receive=DBOS.registerWorkflow(async(ctx:CallContext,input:unknown)=>{
  const settings=await DBOS.runStep(()=>managementApi.effective(ctx.subjectId),{name:'messages.receivePolicy'});if(!settings.effective.behavior.receive)throw new Error('Receiving is disabled for this subject');
  const message=await ds.runTransaction(()=>communicationApi.accept(ds.client,ctx,input),{name:'messages.receive'});
  const subject=await DBOS.runStep(()=>identityApi.read({...ctx,actor:{kind:'service',id:config.installationId,grants:['subjects.read']}}),{name:'subjects.runtime'});
  if(subject.runtime==='running')await DBOS.startWorkflow(react,{workflowID:`react:${message.id}`,queueName:'hept.subject',enqueueOptions:{queuePartitionKey:ctx.subjectId,delaySeconds:settings.effective.attention.aggregationMs/1000},workflowAttributes:{subjectId:ctx.subjectId,operation:'agency.react'}})(subjectContext(ctx),'notification');
  return message;
 },{name:'hept.messages.receive'});
 DBOS.setConfig({name:`hept-${config.installationId}`,systemDatabaseUrl:config.databaseURL,applicationVersion:'0.1.2'});
 if(options.launch!==false){await worldApi.hostStart();await DBOS.launch();await DBOS.registerQueue('hept.subject',{partitionConcurrency:1,workerConcurrency:8});await DBOS.registerQueue('hept.nodes',{globalConcurrency:2});await DBOS.registerQueue('hept.work',{partitionConcurrency:1,workerConcurrency:8});await DBOS.registerQueue('hept.cognition',{partitionConcurrency:1,workerConcurrency:2});}
 return {db,config,authentication,schedule,sourcePolicies:sourcePolicies(db,config.installationId),async reconcileChannels(){const subjects=await db.selectFrom('subjects').select('id').execute();const results=[];for(const subject of subjects){const ctx={actor:{kind:'service' as const,id:config.installationId,grants:['channels.write'],subjectIds:[subject.id]},subjectId:subject.id,purpose:'channel_history',audience:[],traceContext:{...operationTrace(),operationId:v7()}};for(const channel of await list(db,'channels',subject.id)){try{results.push(await communicationApi.synchronizeChannel(ctx,channel.id as string));}catch(error){results.push({channelId:channel.id,error:String(error)});}}}return results;},invocations:invocations(db,managementApi),data:dataManagement(db,config.dataRoot,config.installationId,workApi),identity:{...identityApi,runtime:async(ctx:CallContext,action:'start'|'pause'|'stop')=>{const result=await identityApi.runtime(ctx,action);if(action!=='start')await agencyApi.cancelNode(ctx);return result;}},management:managementApi,communication:communicationApi,world:worldApi,agency:agencyApi,work:{...workApi,resume:async(ctx:CallContext,id:string)=>{const continued=await workApi.resume(ctx,id);await DBOS.startWorkflow(task,{workflowID:`task:${continued.id}`,workflowAttributes:{subjectId:ctx.subjectId,operation:'tasks.start'}})(ctx,continued.id);return continued;}},
  async receive(ctx:CallContext,input:unknown){const parsed=receiveMessage.parse(input);const id=`receive:${ctx.subjectId}:${parsed.channelAccount}:${parsed.conversationKey}:${parsed.platformMessageId}`;await DBOS.startWorkflow(receive,{workflowID:id,workflowAttributes:{subjectId:ctx.subjectId,operation:'messages.receive',traceId:ctx.traceContext.traceId}})(ctx,parsed);const existing=(await DBOS.listWorkflows({workflowIDs:[id],loadInput:true,loadOutput:false}))[0];if(existing?.input&&digest(existing.input[1])!==digest(parsed))problem('conflict','Source identity was already accepted with different input',409);return {operationId:id,statusUrl:`/v1/operations/${encodeURIComponent(id)}`};},
  async react(ctx:CallContext){authorize(ctx,'agency.react');const id=ctx.traceContext.operationId;await DBOS.startWorkflow(react,{workflowID:id,queueName:'hept.subject',enqueueOptions:{queuePartitionKey:ctx.subjectId},workflowAttributes:{subjectId:ctx.subjectId,operation:'agency.react'}})(subjectContext(ctx));return {operationId:id,statusUrl:`/v1/operations/${encodeURIComponent(id)}`};},
  async sendExpression(ctx:CallContext,input:{intent:Json;parts:MessagePart[];clientSubmissionId:string}){authorize(ctx,'messages.send');const id=`expression:${ctx.subjectId}:${ctx.actor.id}:${input.clientSubmissionId}`;await DBOS.startWorkflow(express,{workflowID:id,workflowAttributes:{subjectId:ctx.subjectId,operation:'messages.sendExpression'}})(ctx,input);const existing=(await DBOS.listWorkflows({workflowIDs:[id],loadInput:true,loadOutput:false}))[0];if(existing?.input&&digest(existing.input[1])!==digest(input))problem('conflict','Expression submission has different input',409);return {operationId:id,statusUrl:`/v1/operations/${encodeURIComponent(id)}`};},
  async startTask(ctx:CallContext,input:unknown){const created=await workApi.create(ctx,input);await DBOS.startWorkflow(task,{workflowID:`task:${created.id}`,workflowAttributes:{subjectId:ctx.subjectId,operation:'tasks.start'}})(ctx,created.id);return created;},
  async operation(ctx:CallContext,id:string){const state=await DBOS.getWorkflowStatus(id);if(!state)problem('not_found','Operation not found',404);authorize({...ctx,subjectId:state.attributes?.subjectId as string??ctx.subjectId},'operations.read');const status=state.status==='SUCCESS'?'completed':state.status==='ERROR'?'failed':state.status==='CANCELLED'?'cancelled':['ENQUEUED','DELAYED'].includes(state.status)?'queued':'running';return {operationId:id,status,resourceRefs:state.attributes,result:status==='completed'?await DBOS.retrieveWorkflow(id).getResult():undefined,error:status==='failed'?String(state.error):undefined};},
  async resumeOperation(ctx:CallContext,id:string){const state=await DBOS.getWorkflowStatus(id);if(!state)problem('not_found','Operation not found',404);authorize({...ctx,subjectId:state.attributes?.subjectId as string??ctx.subjectId},'operations.control');await DBOS.resumeWorkflow(id);return {operationId:id,statusUrl:`/v1/operations/${encodeURIComponent(id)}`};},
  async traceOperation(ctx:CallContext,id:string){const state=await DBOS.getWorkflowStatus(id);if(!state)problem('not_found','Operation not found',404);authorize({...ctx,subjectId:state.attributes?.subjectId as string??ctx.subjectId},'operations.debug');return {operationId:id,status:state,steps:await DBOS.listWorkflowSteps(id)};},
  async close(){if(options.launch!==false)await worldApi.hostStop();if(options.launch!==false)await DBOS.shutdown({workflowCompletionTimeoutMS:1000});await authPool.end();await db.destroy();await telemetry.close();}
 };
}
export type Hept=Awaited<ReturnType<typeof createHept>>;
