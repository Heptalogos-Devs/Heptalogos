import {createModels,createModelTest,modelSettingsModules,officialProviderAdapters,type Models} from '@nous-wave/platform/models';
import {createPrompts,promptsDefinition,type Prompts} from '@nous-wave/platform/prompts';
import {roleCatalog,promptCatalog} from './platform/model-config.js';
import {modelData} from './platform/model-data.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {subjectIdOf} from './platform/runtime.js';
import {createTime,timeSettingsModule} from './time/index.js';
import {projectDeadline,delaySecondsCeil} from '@nous-wave/platform/time';
import {readReal} from '@nous-wave/platform/time';
import {createTelemetry,telemetryDefinition,type Telemetry} from '@nous-wave/platform/telemetry';
import {createNetwork,networkSettingsModule,type Network} from '@nous-wave/platform/network';
import {createSecretRegistry} from '@nous-wave/platform/credentials';
import {resourceNetwork} from './platform/network.js';
import {createProductSettings} from './platform/settings.js';
import {sourcePolicies} from './management/sources.js';
import { cognitionConnection } from './platform/cognition.js';
import { dataManagement } from './management/data.js';
import { createAuthentication,type DelegationScope,type Authentication,type SecretRegistry } from '@nous-wave/platform/credentials';
import {operationPolicy,subjectOperations,issuancePolicy} from './platform/authorization.js';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {createStorage,registerProblemSerialization,dbosSystemDatabaseURL,describeDurableWorkflow,describeDurableSteps,resumeDurableWorkflow,type Kysely} from '@nous-wave/platform/storage';
import type { BootstrapView } from '@nous-wave/platform/bootstrap';
import { safeProblem } from '@nous-wave/platform/errors';
import type { CallContext,TimePoint } from '@nous-wave/contracts/common';
import { type MessagePart } from '@heptalogos/contracts';
import { v7 } from 'uuid';
import { migrationProvider,type Database,type Json } from './platform/database.js';
import { read,list,put,type Authorization,operationTrace,now,makeRef,digest,problem } from './platform/runtime.js';
import { identity } from './identity/index.js';
import { management } from './management/index.js';
import { readableParts,communication } from './communication/index.js';
import { world } from './world/index.js';
import { agency } from './agency/index.js';
import { models,type CognitionConnection } from './platform/models.js';
import {work,type ExecutionHost} from './work/index.js';
import {executionHost} from './platform/execution.js';
import {nativeAccounting} from './work/native-accounting.js';
import {nativeCognition} from './work/native-cognition.js';
import type {TimeRecordings} from '@nous-wave/contracts/time';
import type {OperationView,OperationTrace} from '@nous-wave/contracts/runtime';
export { callContext } from './platform/runtime.js';
export type { CognitionConnection,ExecutionHost };
export interface HeptOptions {
 bootstrap:BootstrapView;
 mode?:'service'|'cli';
 databaseURL:string;
 authSecret:Uint8Array;
 cognition?:CognitionConnection;
 executionHost?:ExecutionHost;
}
export async function createHept(options:HeptOptions):Promise<Hept>{
 globalThis.AI_SDK_LOG_WARNINGS=false;
 const {bootstrap:config,paths}=options.bootstrap;
 if(config.product!=='hept')problem('invalid_input','Bootstrap belongs to a different product');
 const processBootId=v7();const telemetry:Telemetry=createTelemetry({product:'hept',installationId:config.installationId,paths,mode:options.mode??'service',bootstrapLevel:config.logging.level,processBootId,events:['http.completed','http.failed','network.request','time.failed','time.reproject_failed','models.failed']});
 DBOS.setConfig({name:`hept-${config.installationId}`,systemDatabaseUrl:dbosSystemDatabaseURL(options.databaseURL),applicationVersion:'0.2.0-infrastructure.1',logger:telemetry.dbosLogger,enableOTLP:false,tracingEnabled:true});
 registerProblemSerialization();
 const storage=createStorage<Database>({pool:{connectionString:options.databaseURL,max:config.database.maxConnections,application_name:`hept-${config.installationId}`},datasourceName:`hept-${config.installationId}`});
 const {db,datasource:ds}=storage;
 try {
 const migrated=await storage.migrate(migrationProvider);
 if(migrated.error){await storage.close();throw migrated.error;}
 let state:'initialized'|'running'|'draining'|'stopped'='initialized';
 let launched=false,worldStarted=false,closing:Promise<void>|undefined;
 const assertDispatch=()=>{if(state!=='running')problem('dependency_unavailable','Host is not accepting new work',503);};
 const transaction=<T>(name:string,use:(tx:Kysely<Database>)=>Promise<T>):Promise<T>=>DBOS.isInWorkflow()?ds.runTransaction(()=>use(ds.client),{name}):db.transaction().execute(use);
 const baseURL=config.listen.publicBaseURL??`http://${config.listen.host}:${config.listen.port}`;

 let authentication:Authentication;
 try {authentication=await createAuthentication({pool:storage.pool,db,product:'hept',installationId:config.installationId,secret:new TextDecoder().decode(options.authSecret),baseURL,trustedOrigins:config.listen.trustedOrigins,operationPolicy,
  issuancePolicy:issuancePolicy(db,config.installationId)});}
 catch(error){await storage.close();await telemetry.close();throw error;}
 const authorize=authentication.authorize;
 async function subjectContext(ctx:CallContext):Promise<CallContext>{const sid=subjectIdOf(ctx);const state=await read(db,'subjects',sid,sid);const runtime=state.runtimeAuthority as {authorityRef:string;id:string;consumer:CallContext['consumer']}|undefined;if(!runtime)problem('forbidden','Subject runtime authority has not been granted',403);const next={...ctx,actor:{kind:'subject' as const,id:runtime.id,authorityRef:runtime.authorityRef},consumer:runtime.consumer,purpose:'deliberation',audience:[]};await authorize(next,'agency.react');return next;}
 const productConfig=createProductSettings(db,config.installationId,authorize,processBootId,[networkSettingsModule,telemetryDefinition,timeSettingsModule,promptsDefinition,...modelSettingsModules(roleCatalog,officialProviderAdapters).modules]);
 await productConfig.settings.registerDefinitions();await telemetry.bindSettings(productConfig.settings);
 let settingsListener:Awaited<ReturnType<typeof productConfig.settings.listen>>|undefined;
 let network:Network;let sharedModels:Models;
 const secrets=createSecretRegistry({db,product:'hept',installationId:config.installationId,secretRoot:paths.secret,authorize,purposes:{
  'model.provider':{operation:'models.invoke',resourceKinds:['Provider'],resolveUse:(ctx,input)=>sharedModels.credentialTarget(ctx,input)},
  'channel.control':{operation:'channels.use',resourceKinds:['Channel']},
  'native.gateway':{operation:'native.connect',resourceKinds:['NativeRuntime']},
  'cognition.connection':{operation:'cognition.invoke',resourceKinds:['subject']},
  ...Object.fromEntries(['network.ca','network.proxy','network.client_certificate','network.client_key'].map(purpose=>[purpose,{operation:'network.read',resourceKinds:['NetworkProfile'],resolveUse:(ctx:CallContext,input:import('@nous-wave/contracts/credentials').SecretUse & {useRef:import('@nous-wave/contracts/common').Ref})=>network.credentialTarget(ctx,input)}])),
 }});
 network=createNetwork({product:'hept',installationId:config.installationId,processBootId,settings:productConfig.settings,authorize,resolveResourceNetwork:resourceNetwork(db,productConfig,config.installationId,(ctx,ref)=>sharedModels.networkSelection(ctx,ref)),withMaterial:secrets.withSecret,onDiagnostic:event=>telemetry.component('network').info({event:'network.request',...event})});
 const identityApi=identity(db,authorize);
 const managementApi=management(db,authorize);
 const communicationApi=communication(db,config.installationId,paths.blob,secrets,network,
  async subjectId=>(await productConfig.communication(subjectId)).media,
  {baseURL,withSigningSecret:async use=>use(options.authSecret),assertDispatch,
   settings:async sid=>productConfig.communication(sid)},authorize);
 let recordings!:TimeRecordings;
 const time=createTime({installationId:config.installationId,db,createSession:storage.createSession,transaction:(name,use)=>transaction(name,tx=>use(tx)),authorize},{settings:productConfig.settings,processBootId,recordings:cap=>{recordings=cap;},onError:value=>telemetry.component('time').warn({event:'time.failed',problem:value})});
 const worldApi=world(db,config.installationId,authorize,time);
 let workApi:ReturnType<typeof work>;
 const cognitionApi=options.cognition??cognitionConnection(productConfig,secrets,network,config.installationId,ctx=>workApi.cognitionAuthority(ctx));
 const prompts:Prompts=createPrompts({db,installationId:config.installationId,programRoot:path.join(path.dirname(fileURLToPath(import.meta.resolve('@heptalogos/hept/package.json'))),'resources/prompts'),overrideRoot:path.join(paths.config,'prompts'),catalog:promptCatalog,settings:productConfig.settings,processBootId,authorize:async(ctx,request)=>{if(request.scope.kind==='subject'&&ctx.subjectId!==request.scope.subjectId)problem('forbidden','Prompt belongs to a different Subject',403);await authorize(ctx,`prompts.${request.action}`,request.promptId?{product:'hept',installationId:config.installationId,...(request.scope.kind==='subject'?{subjectId:request.scope.subjectId}:{}),kind:'Prompt',id:request.promptId}:undefined);}});await prompts.initialize();
 const nativeHost=options.executionHost??executionHost(productConfig,secrets,network,config.installationId);
 const actualModelData=modelData(db,paths.blob,config.installationId,authorize,cognitionApi);
 sharedModels=createModels({product:'hept',installationId:config.installationId,db,processBootId,settings:productConfig.settings,credentials:secrets,network,prompts,roleCatalog,providerAdapters:officialProviderAdapters,authorize,clock:{read:async(ctx,selection)=>(await time.read(ctx,selection)).now,capture:time.capture,captureTerminal:(ctx,input)=>recordings.captureTerminal(ctx,input),validateCapture:time.validateCapture},data:actualModelData,beforeDispatch:assertDispatch,nativeBindings:{read:(ctx,input,local)=>nativeHost.withClient(local?.hostContext??ctx,input.runtimeId,client=>client.readBinding(input,(local?.hostContext??ctx).trace.traceparent)),authorizeCall:(ctx,input,local)=>workApi.authorizeNativeCall(ctx,input,local)},budgetScopes:{resolve:ctx=>workApi.budgetConstraints(ctx)},diagnostic:(ctx,value)=>telemetry.forContext(ctx,'models').warn({event:'models.failed',problem:value})});
 const modelApi=models(sharedModels,cognitionApi);
 const agencyApi=agency(db,transaction,config.installationId,worldApi,communicationApi,modelApi,productConfig,authorize,cognitionApi);
 workApi=work(db,config.installationId,assertDispatch,nativeHost,authorize,authentication,sharedModels,time,cognitionApi);
 const reflect=DBOS.registerWorkflow(async(ctx:CallContext)=>{
  if(cognitionApi.available&&!await cognitionApi.available(ctx))return {skipped:true};
  return DBOS.runStep(()=>cognitionApi.growth({...ctx,purpose:'growth',audience:[],trace:{...ctx.trace,operationId:`${DBOS.workflowID}:growth`}},{apply:true}),{name:'cognition.growth',retriesAllowed:false});
 },{name:'hept.cognition.reflect'});
 const send=DBOS.registerWorkflow(async(ctx:CallContext,expressionId:string)=>{
  const result=await DBOS.runStep(()=>communicationApi.dispatch(ctx,expressionId),{name:'messages.dispatch',retriesAllowed:false});
  const observed=await DBOS.runStep(async()=>(await worldApi.situation(subjectIdOf(ctx))).time,{name:'messages.sentTime'});
  await DBOS.runStep(async()=>{
   if(cognitionApi.available&&!await cognitionApi.available(ctx))return;
   const expression=await read(db,'expressions',subjectIdOf(ctx),expressionId);const intent=expression.intent as Json;const inputs=expression.modelOperationId?await actualModelData.outputSources(ctx,expression.modelOperationId as string):[];
   const material=await cognitionApi.capture({...ctx,purpose:'growth',audience:[],trace:{...ctx.trace,operationId:`send:${expressionId}:result`}},{kind:'communication_result',mediaType:'text/plain',text:`向 ${intent.conversationId} 表达：${readableParts(expression.parts as MessagePart[])}\n实际平台结果：${JSON.stringify(result.parts.map(part=>({status:part.status,platformMessageId:part.platformMessageId})))}`,source:{ref:makeRef(config.installationId,subjectIdOf(ctx),'expression',expressionId),inputs,roots:result.parts.map(part=>makeRef(config.installationId,subjectIdOf(ctx),'delivery',part.id as string))},occurred:{start:observed},policy:{readers:[subjectIdOf(ctx)],purposes:['deliberation','expression','growth'],audiences:intent.audience}});
   await cognitionApi.accept({...ctx,purpose:'growth',audience:[],trace:{...ctx.trace,operationId:`send:${expressionId}:accept`}},{consumer:{kind:'subject',host:config.installationId,id:subjectIdOf(ctx)},invocationId:`send:${expressionId}`,step:'delivery',portions:[{ref:material.ref}],observed,purpose:'communication'});
  },{name:'messages.acceptActualResult',retriesAllowed:false});
  await DBOS.startWorkflow(reflect,{workflowID:`reflect:send:${expressionId}`,queueName:'hept.cognition',enqueueOptions:{queuePartitionKey:subjectIdOf(ctx)},workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'growth.run'}})(ctx);return result;
 },{name:'hept.messages.sendExpression'});
 const express=DBOS.registerWorkflow(async(ctx:CallContext,input:{intent:Json;parts:MessagePart[];clientSubmissionId:string})=>{const expression=await ds.runTransaction(()=>communicationApi.createExpression(ds.client,ctx,input),{name:'messages.prepareAuthorizedExpression'});await DBOS.startWorkflow(send,{workflowID:`send:${expression.id}`,workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'messages.sendExpression'}})(ctx,expression.id as string);return expression;},{name:'hept.messages.prepareExpression'});
 const next=DBOS.registerWorkflow(async(ctx:CallContext,nodeId:string,revision:number)=>{
  const node=await DBOS.runStep(()=>read(db,'nextNodes',subjectIdOf(ctx),nodeId),{name:'agency.readNode'});if(node.revision!==revision||node.state==='cancelled')return;
  const snapshot=await DBOS.runStep(()=>time.read(ctx,{domainId:(node.at as TimePoint).domainId}),{name:'agency.wakeClock'}),projection=projectDeadline(snapshot,node.at as TimePoint);
  if(('revision'in snapshot?snapshot.revision:undefined)!==node.clockRevision||projection.kind!=='due'||projection.at>readReal().at){await schedule(ctx,node.at as TimePoint);return;}
  await DBOS.startWorkflow(react,{workflowID:`node:${nodeId}:${revision}`,queueName:'hept.subject',enqueueOptions:{queuePartitionKey:subjectIdOf(ctx)},workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'agency.react'}})(ctx,'natural');
 },{name:'hept.agency.nextNode'});
 async function schedule(ctx:CallContext,chosenAt?:TimePoint){
  const at=chosenAt??await DBOS.runStep(()=>worldApi.nextBoundary(subjectIdOf(ctx)),{name:'world.nextBoundary'});
  const snapshot=await DBOS.runStep(()=>time.read(ctx,{domainId:at.domainId}),{name:'agency.projectClock'}),projection=projectDeadline(snapshot,at);
  const node=await agencyApi.nextNode(ctx,at,'natural_boundary',{...('revision'in snapshot?{clockRevision:snapshot.revision}:{}),...('clockRef'in snapshot?{clockRef:snapshot.clockRef,segmentRef:snapshot.segment.ref}:{})});
  if(projection.kind==='due')await DBOS.startWorkflow(next,{workflowID:`wait:${node.id}:${node.revision}`,queueName:'hept.nodes',enqueueOptions:{delaySeconds:delaySecondsCeil(projection.at,readReal().at)},workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'agency.nextNode'}})(ctx,node.id,node.revision);return node;
 }
 const submitModelTest=createModelTest({product:'hept',installationId:config.installationId,models:sharedModels,authorize,beforeDispatch:assertDispatch});
 const reproject=DBOS.registerWorkflow(async(domainId:string)=>{
  const nodes=await DBOS.runStep(()=>db.selectFrom('nextNodes').selectAll().where('document','@>',{state:'active',at:{domainId}}).execute(),{name:'agency.nodesForClock'});
  for(const node of nodes){const subject=await DBOS.runStep(()=>read(db,'subjects',node.subjectId,node.subjectId),{name:'agency.reprojectSubject'});if(subject.runtime!=='running')continue;const runtime=subject.runtimeAuthority as {authorityRef:string;id:string;consumer:CallContext['consumer']}|undefined;if(!runtime)continue;const ctx:CallContext={actor:{kind:'subject',id:runtime.id,authorityRef:runtime.authorityRef},consumer:runtime.consumer,subjectId:node.subjectId,purpose:'deliberation',audience:[node.subjectId],trace:{...operationTrace(),operationId:`clock-reproject:${domainId}:${node.id}:${node.revision}`}};await authorize(ctx,'agency.react');await schedule(ctx,node.document.at as TimePoint);}
 },{name:'hept.agency.reprojectClock'});
 const changeClock=DBOS.registerWorkflow(async(ctx:CallContext,action:'configure'|'pause'|'resume'|'advance',input:any)=>{const receipt=await time[action](ctx,input);await DBOS.startWorkflow(reproject,{workflowID:`clock-reproject:${receipt.record.ref.id}:${receipt.record.revision}`,queueName:'hept.nodes',workflowAttributes:{operation:'clock.reproject'}})(receipt.record.domainId);return receipt;},{name:'hept.time.changeClock'});
 async function submitClockChange(ctx:CallContext,action:'configure'|'pause'|'resume'|'advance',input:any){assertDispatch();const workflowID=`clock-change:${ctx.trace.operationId}`,handle=await DBOS.startWorkflow(changeClock,{workflowID,workflowAttributes:{subjectId:ctx.subjectId,operation:`clock.${action}`}})(ctx,action,input);const original=(await DBOS.listWorkflows({workflowIDs:[workflowID],loadInput:true,loadOutput:false}))[0]?.input;if(original&&(original[1]!==action||digest(original[2])!==digest(input)))problem('conflict','Clock submission contains different input',409);return handle.getResult();}
 const unsubscribeTime=time.subscribe(change=>{if(state==='running')void DBOS.startWorkflow(reproject,{workflowID:`clock-reproject:${change.clockRef.id}:${change.clockRef.revision}`,queueName:'hept.nodes',workflowAttributes:{operation:'clock.reproject'}})(change.domainId).catch(error=>telemetry.component('time').warn({event:'time.reproject_failed',problem:safeProblem(error)}));});
 async function enqueueTaskPoll(ctx:CallContext,taskId:string,attempt:number,phase?:string){await DBOS.startWorkflow(taskPoll,{workflowID:`task-poll:${taskId}:${phase?`${phase}:`:''}${attempt}`,queueName:'hept.work',enqueueOptions:{queuePartitionKey:taskId,delaySeconds:Math.min(60,2**Math.min(attempt,6))},workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'tasks.inspect'}})(ctx,taskId,attempt,phase);}
 const taskPoll=DBOS.registerWorkflow(async(ctx:CallContext,taskId:string,attempt:number,phase?:string)=>{
  let state:Json;try{state=await DBOS.runStep(()=>workApi.inspect(ctx,taskId),{name:'tasks.inspectNative',retriesAllowed:false});}catch(error){await DBOS.runStep(async()=>{const old=await read(db,'tasks',subjectIdOf(ctx),taskId);return put(db,'tasks',subjectIdOf(ctx),{...old,lastInspectionError:safeProblem(error)},taskId,old.revision as number);},{name:'tasks.recordInspectionFailure'});await enqueueTaskPoll(ctx,taskId,attempt+1,phase);return;}
  if(state.status==='result_ready'){const subject=await DBOS.runStep(()=>read(db,'subjects',subjectIdOf(ctx),subjectIdOf(ctx)),{name:'tasks.returnSubject'});if(subject.runtime==='running')await DBOS.startWorkflow(react,{workflowID:`task-result:${taskId}`,queueName:'hept.subject',enqueueOptions:{queuePartitionKey:subjectIdOf(ctx)},workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'agency.react'}})(await subjectContext(ctx),'work');}
  else if(!state.paused&&['running','waiting','unknown','starting'].includes(state.status as string)&&(state.runId||['unknown','starting'].includes(state.status as string)))await enqueueTaskPoll(ctx,taskId,attempt+1,phase);
  return state;
 },{name:'hept.tasks.poll'});
 const task=DBOS.registerWorkflow(async(ctx:CallContext,taskId:string)=>{const state=await DBOS.runStep(()=>workApi.startNative(ctx,taskId),{name:'tasks.startNative',retriesAllowed:false});if(state.runId||state.status==='unknown')await enqueueTaskPoll(ctx,taskId,0);return state;},{name:'hept.tasks.start'});
 const react=DBOS.registerWorkflow(async(ctx:CallContext,trigger:string='manual')=>{
  await ds.runTransaction(()=>worldApi.advanceIn(ds.client,ctx,undefined,'react_prepare'),{name:'world.advanceTo'});
  const prepared=await DBOS.runStep(()=>agencyApi.prepare(ctx,trigger),{name:'agency.prepare'});const initialNode=await schedule(ctx);if(prepared.deferred)return {deferred:true,nextNode:initialNode};
  let chosen=await agencyApi.choose(ctx,prepared,`${DBOS.workflowID}:deliberation:0`);
  for(let round=1;round<=3;round++){const readIds=chosen.actions.flatMap(a=>a.kind==='read'?a.messageIds:[]);if(readIds.length===0)break;const materials=await DBOS.runStep(()=>agencyApi.readMessages(ctx,readIds),{name:'agency.readSelectedMessages'});chosen=await agencyApi.choose(ctx,{...prepared,materials},`${DBOS.workflowID}:deliberation:${round}`);await agencyApi.noteRead(ctx,readIds);}
  const adopted=await agencyApi.adopt(ctx,chosen,prepared.opportunities.map(o=>o.id as string),trigger);
  const expression=await agencyApi.render(ctx,adopted,`${DBOS.workflowID}:expression`);
  if(expression)await DBOS.startWorkflow(send,{workflowID:`send:${expression.id}`,workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'messages.sendExpression'}})(ctx,expression.id as string);
  for(const effect of adopted.effects as Json[]){const tasks=await DBOS.runStep(()=>list(db,'tasks',subjectIdOf(ctx)),{name:'tasks.readPending'});if(tasks.some(t=>t.id===effect.id))await DBOS.startWorkflow(task,{workflowID:`task:${effect.id}`,workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'tasks.start'}})(ctx,effect.id as string);}
  const node=await schedule(ctx,chosen.reconsiderAt);
  if(!expression)await DBOS.startWorkflow(reflect,{workflowID:`reflect:${DBOS.workflowID}`,queueName:'hept.cognition',enqueueOptions:{queuePartitionKey:subjectIdOf(ctx)},workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'growth.run'}})(ctx);
  return {decisionId:adopted.id,expressionId:expression?.id,nextNode:node};
 },{name:'hept.agency.react'});
 const receive=DBOS.registerWorkflow(async(ctx:CallContext,input:unknown)=>{
  const settings=await DBOS.runStep(()=>productConfig.agency(subjectIdOf(ctx),'receive'),{name:'messages.receivePolicy'});if(!settings.communication.behavior.receive)throw new Error('Receiving is disabled for this subject');
  const message=await ds.runTransaction(()=>communicationApi.accept(ds.client,ctx,input),{name:'messages.receive'});
  const subject=await DBOS.runStep(()=>read(db,'subjects',subjectIdOf(ctx),subjectIdOf(ctx)),{name:'subjects.runtime'});
  if(subject.runtime==='running')await DBOS.startWorkflow(react,{workflowID:`react:${message.id}`,queueName:'hept.subject',enqueueOptions:{queuePartitionKey:subjectIdOf(ctx),delaySeconds:settings.attention.aggregationMs/1000},workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'agency.react'}})(await subjectContext(ctx),'notification');
  return message;
 },{name:'hept.messages.receive'});
 async function start(){
  if(state==='running')return;
  if(state!=='initialized')problem('conflict','This Host cannot be started again',409);
  settingsListener=await productConfig.settings.listen(storage.createSession);
  await DBOS.launch();launched=true;
  await DBOS.registerQueue('hept.subject',{partitionConcurrency:1,workerConcurrency:8});
  await DBOS.registerQueue('hept.nodes',{globalConcurrency:2});
  await DBOS.registerQueue('hept.work',{partitionConcurrency:1,workerConcurrency:8});
  await DBOS.registerQueue('hept.cognition',{partitionConcurrency:1,workerConcurrency:2});
  state='running';await worldApi.hostStart();worldStarted=true;
  const pending=await db.selectFrom('nextNodes').select('document').where('document','@>',{state:'active'}).execute();
  for(const domainId of new Set(pending.map(node=>(node.document.at as TimePoint).domainId)))await DBOS.startWorkflow(reproject,{workflowID:`clock-reproject:boot:${processBootId}:${domainId}`,queueName:'hept.nodes',workflowAttributes:{operation:'clock.reproject'}})(domainId);
 }
 async function drain(){if(state==='running')state='draining';return {state,acceptingWork:false};}
 async function close(mode:'graceful'|'force'='graceful'){
  return closing??=(async()=>{
   await drain();
   try {
    if(worldStarted)await worldApi.hostStop();
    unsubscribeTime();await settingsListener?.close();
    if(launched)await DBOS.shutdown({workflowCompletionTimeoutMS:mode==='force'?0:30000});
    await network.close();sharedModels.close();await prompts.close();productConfig.close();await time.close();
   }finally{state='stopped';await storage.close();await telemetry.close();}
  })();
 }
 async function status():Promise<import('@heptalogos/contracts').HostStatus>{
  const subjects=await db.selectFrom('subjects').select(({fn})=>fn.countAll<string>().as('count')).executeTakeFirstOrThrow();
  const running=await db.selectFrom('subjects').where('document','@>',{runtime:'running'}).select(({fn})=>fn.countAll<string>().as('count')).executeTakeFirstOrThrow();
  const resources=await sharedModels.status();
  const nativeConfigured=Boolean(options.executionHost)||Object.keys((await productConfig.execution()).runtimes).length>0;
  const channels=await db.selectFrom('channels').select(({fn})=>fn.countAll<string>().as('count')).executeTakeFirstOrThrow();
  return {product:'hept',installationId:config.installationId,state,
   process:{state:state==='stopped'?'unavailable':'available',acceptingWork:state==='running'},
   database:{state:'available'},auth:{state:'available'},
   native:{state:nativeConfigured?'degraded':'unavailable',required:false,reason:nativeConfigured?'not_probed':'not_configured'},
   models:{state:resources.resources.configured>0?'degraded':'unavailable',required:false,configured:String(resources.resources.configured),reason:'not_probed'},
   index:{state:'unavailable',required:false,reason:'product_does_not_own_index'},
   channels:{local:{state:'available'},configured:channels.count,externalProbe:'not_requested'},
   subjects:{count:subjects.count,running:running.count}};
 }

 async function revokeRuntime(ctx:CallContext,runtime:Json|undefined){if(!runtime)return;const delegation=await authentication.delegations.read(ctx,runtime.delegationId as string);if(delegation.state!=='revoked')await authentication.delegations.revoke(ctx,delegation.id,{expectedRevision:delegation.revision});}
 async function runtimeSubject(ctx:CallContext,action:'start'|'pause'|'stop'){
  await authorize(ctx,'subjects.control');const sid=subjectIdOf(ctx),old=await read(db,'subjects',sid,sid),previous=old.runtimeAuthority as Json|undefined;
  if(action==='start'){
   assertDispatch();const scope:DelegationScope={plane:'subject',operations:[...subjectOperations],subjectIds:[sid],consumer:{kind:'subject',host:config.installationId,id:sid},purposes:['deliberation','expression','growth','worker'],audiences:['*'],targets:[],inputRefs:[],expiresAt:null,mayDelegate:true};
   const grant=await authentication.createRuntimeKey(ctx,{name:`Subject ${sid}`,scope});let saved=false;
   try{const result=await db.transaction().execute(tx=>put(tx,'subjects',sid,{...old,runtime:'running',runtimeAuthority:{delegationId:grant.delegationId,authorityRef:grant.authorityRef,id:sid,consumer:scope.consumer}},sid,old.revision as number));saved=true;await revokeRuntime(ctx,previous);return result;}
   catch(error){if(!saved)await revokeRuntime(ctx,{delegationId:grant.delegationId});throw error;}
  }
  await revokeRuntime(ctx,previous);const {runtimeAuthority:ignored,...document}=old;const result=await db.transaction().execute(tx=>put(tx,'subjects',sid,{...document,runtime:action==='pause'?'paused':'stopped'},sid,old.revision as number));await agencyApi.cancelNode(ctx);return result;
 }
 return {authorize,nativeCognition:nativeCognition(workApi,cognitionApi,time,sharedModels),nativeAccounting:nativeAccounting(sharedModels,workApi),time:{...time,configure:(ctx:CallContext,input:Parameters<typeof time.configure>[1])=>submitClockChange(ctx,'configure',input),pause:(ctx:CallContext,input:Parameters<typeof time.pause>[1])=>submitClockChange(ctx,'pause',input),resume:(ctx:CallContext,input:Parameters<typeof time.resume>[1])=>submitClockChange(ctx,'resume',input),advance:(ctx:CallContext,input:Parameters<typeof time.advance>[1])=>submitClockChange(ctx,'advance',input)},models:sharedModels,testModel:submitModelTest,prompts,settings:productConfig.settings,secrets,network,networkSelection:resourceNetwork(db,productConfig,config.installationId,(ctx,ref)=>sharedModels.networkSelection(ctx,ref)),telemetry,db,bootstrap:config,paths,authentication,host:{start,status,drain,stop:close},schedule,sourcePolicies:sourcePolicies(db,config.installationId,authorize),data:dataManagement(db,paths.blob,config.installationId,authorize,productConfig,network,time,sharedModels,workApi),identity:{...identityApi,runtime:runtimeSubject},management:managementApi,communication:communicationApi,world:worldApi,agency:agencyApi,work:{...workApi,resume:async(ctx:CallContext,id:string,input:unknown)=>{assertDispatch();const issuer=await subjectContext(ctx),resumed=await workApi.resume(ctx,id,input,issuer);if(!resumed.paused&&['waiting','running','starting','unknown'].includes(resumed.status as string))await enqueueTaskPoll(issuer,id,0,`recovery:${ctx.trace.operationId}`);return resumed;},createContinuation:async(ctx:CallContext,id:string,input:unknown)=>{const continued=await workApi.createContinuation(ctx,id,input);await DBOS.startWorkflow(task,{workflowID:`task:${continued.id}`,workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'tasks.start'}})(await subjectContext(ctx),continued.id);return continued;}},
  async receive(ctx:CallContext,input:unknown){assertDispatch();const parsed=await communicationApi.authorizeIngress(ctx,input);const id=`receive:${subjectIdOf(ctx)}:${parsed.channelAccount}:${parsed.conversationKey}:${parsed.platformMessageId}`;await DBOS.startWorkflow(receive,{workflowID:id,workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'messages.receive',traceId:ctx.trace.traceId}})(ctx,parsed);const existing=(await DBOS.listWorkflows({workflowIDs:[id],loadInput:true,loadOutput:false}))[0];if(existing?.input&&digest(existing.input[1])!==digest(parsed))problem('conflict','Source identity was already accepted with different input',409);return {operationId:id,statusUrl:`/v1/operations/${encodeURIComponent(id)}`};},
  async react(ctx:CallContext){assertDispatch();await authorize(ctx,'agency.react');const id=ctx.trace.operationId;await DBOS.startWorkflow(react,{workflowID:id,queueName:'hept.subject',enqueueOptions:{queuePartitionKey:subjectIdOf(ctx)},workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'agency.react'}})(await subjectContext(ctx));return {operationId:id,statusUrl:`/v1/operations/${encodeURIComponent(id)}`};},
  async sendExpression(ctx:CallContext,input:{intent:Json;parts:MessagePart[];clientSubmissionId:string}){assertDispatch();await authorize(ctx,'messages.send',makeRef(config.installationId,subjectIdOf(ctx),'conversation',input.intent.conversationId as string));const id=`expression:${subjectIdOf(ctx)}:${ctx.actor.id}:${input.clientSubmissionId}`;await DBOS.startWorkflow(express,{workflowID:id,workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'messages.sendExpression'}})(ctx,input);const existing=(await DBOS.listWorkflows({workflowIDs:[id],loadInput:true,loadOutput:false}))[0];if(existing?.input&&digest(existing.input[1])!==digest(input))problem('conflict','Expression submission has different input',409);return {operationId:id,statusUrl:`/v1/operations/${encodeURIComponent(id)}`};},
  async startTask(ctx:CallContext,input:unknown){assertDispatch();const created=await workApi.create(ctx,input);await DBOS.startWorkflow(task,{workflowID:`task:${created.id}`,workflowAttributes:{subjectId:subjectIdOf(ctx),operation:'tasks.start'}})(await subjectContext(ctx),created.id);return created;},
  async operation(ctx:CallContext,id:string){const state=await DBOS.getWorkflowStatus(id);if(!state)problem('not_found','Operation not found',404);await authorize({...ctx,subjectId:state.attributes?.subjectId as string|undefined??ctx.subjectId},'operations.read');return describeDurableWorkflow(state);},
  async resumeOperation(ctx:CallContext,id:string){const state=await DBOS.getWorkflowStatus(id);if(!state)problem('not_found','Operation not found',404);await authorize({...ctx,subjectId:state.attributes?.subjectId as string|undefined??ctx.subjectId},'operations.control');await resumeDurableWorkflow(id);const updated=await DBOS.getWorkflowStatus(id);if(!updated)problem('not_found','Operation not found',404);return describeDurableWorkflow(updated);},
  async traceOperation(ctx:CallContext,id:string){const state=await DBOS.getWorkflowStatus(id);if(!state)problem('not_found','Operation not found',404);await authorize({...ctx,subjectId:state.attributes?.subjectId as string|undefined??ctx.subjectId},'operations.debug');return {operation:describeDurableWorkflow(state),steps:describeDurableSteps(await DBOS.listWorkflowSteps(id))};},
  close
 };
 }catch(error){await storage.close();await telemetry.close();throw error;}
}
export interface Hept {
 nativeCognition:ReturnType<typeof nativeCognition>;nativeAccounting:ReturnType<typeof nativeAccounting>;
 authorize:Authorization;authentication:Authentication;db:Kysely<Database>;bootstrap:BootstrapView['bootstrap'];paths:BootstrapView['paths'];
 testModel(ctx:CallContext,input:import('@nous-wave/contracts/models').ModelTestInput):Promise<{operationId:string;statusUrl:string}>;
 settings:import('@nous-wave/platform/settings').Settings;secrets:SecretRegistry;network:Network;telemetry:Telemetry;models:Models;prompts:Prompts;time:import('./time/index.js').Time;
 networkSelection:ReturnType<typeof resourceNetwork>;sourcePolicies:ReturnType<typeof sourcePolicies>;
 host:{start():Promise<void>;status():Promise<import('@heptalogos/contracts').HostStatus>;drain():Promise<{state:string;acceptingWork:boolean}>;stop(mode?:'graceful'|'force'):Promise<void>};
 schedule(ctx:CallContext,chosenAt?:TimePoint):ReturnType<ReturnType<typeof agency>['nextNode']>;
 data:ReturnType<typeof dataManagement>;identity:ReturnType<typeof identity>&{runtime(ctx:CallContext,action:'start'|'pause'|'stop'):Promise<Json>};management:ReturnType<typeof management>;communication:ReturnType<typeof communication>;world:ReturnType<typeof world>;agency:ReturnType<typeof agency>;work:Omit<ReturnType<typeof work>,'resume'>&{resume(ctx:CallContext,id:string,input:unknown):Promise<Json>};
 receive(ctx:CallContext,input:unknown):Promise<{operationId:string;statusUrl:string}>;
 react(ctx:CallContext):Promise<{operationId:string;statusUrl:string}>;
 sendExpression(ctx:CallContext,input:{intent:Json;parts:MessagePart[];clientSubmissionId:string}):Promise<{operationId:string;statusUrl:string}>;
 startTask(ctx:CallContext,input:unknown):ReturnType<ReturnType<typeof work>['create']>;
 operation(ctx:CallContext,id:string):Promise<OperationView>;
 resumeOperation(ctx:CallContext,id:string):Promise<OperationView>;
 traceOperation(ctx:CallContext,id:string):Promise<OperationTrace>;
 close(mode?:'graceful'|'force'):Promise<void>;
}
