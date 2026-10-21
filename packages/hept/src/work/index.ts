import {v7} from 'uuid';
import type {Kysely} from 'kysely';
import {addMicros,readReal} from '@nous-wave/platform/time';
import {safeProblem} from '@nous-wave/platform/errors';
import type {Authentication,DelegationScope} from '@nous-wave/platform/credentials';
import type {Models,ModelsOptions} from '@nous-wave/platform/models';
import {RefSchema,type CallContext,type Ref} from '@nous-wave/contracts/common';
import type {TimeCaptureReceipt} from '@nous-wave/contracts/time';
import {NativeOriginSchema,type ModelCallView,type NativeInvocationPrepare,type NativeInvocationCompletion} from '@nous-wave/contracts/models';
import {taskRequest,taskBudget,taskContinuation,taskRecovery,taskRecoveryPlanInput,nativeTaskProgress} from '@heptalogos/contracts';
import {invocationIdOf,type NativeOrigin,type NativeExecutionScope,type NativeProgress} from '@heptalogos/openclaw/client';
import type {Database,Json} from '../platform/database.js';
import type {ExecutionHost,NativeClient} from '../platform/execution.js';
import type {Time} from '../time/index.js';
import type {CognitionConnection,RemoteWorkerAuthority} from '../platform/models.js';
import {type Authorization,read,list,put,problem,makeRef,idempotent,subjectIdOf,digest} from '../platform/runtime.js';
import {workerScope,revokeTaskAuthority,taskIsActive,type TaskAuthority} from './authority.js';
export type {ExecutionHost} from '../platform/execution.js';

export function work(db:Kysely<Database>,installationId:string,assertDispatch:()=>void,host:ExecutionHost,authorize:Authorization,authentication:Authentication,models:Models,time:Time,cognition:CognitionConnection){
 const taskRef=(subjectId:string,id:string):Ref=>({product:'hept',installationId,subjectId,kind:'task',id});
 function taskView(task:Json):Json{const {progress:storedProgress,...record}=task,progress=nativeTaskProgress.safeParse(storedProgress),current:Json={...record,...(progress.success?{progress:progress.data}:{})};if(!task.cognitionBound&&!task.cognitionAuthority&&!task.resultPublication)return current;const publication=task.resultPublication as Json|undefined,{result,...visible}=current;return {...visible,result:publication?.status==='published'?{outputRefs:publication.refs}:undefined,resultAvailability:publication?.status==='published'?'available':['failed','cancelled'].includes(task.status as string)?'unavailable':'pending_publication'};}
 const runtime=(task:Json)=>(task.executionScope as NativeExecutionScope|undefined)?.runtimeId;
 async function using<T>(ctx:CallContext,task:Json,use:(client:NativeClient)=>Promise<T>):Promise<T>{const id=runtime(task);if(!id)problem('capability_unavailable','Task has no saved native runtime',409);return host.withClient(ctx,id,use);}
 function nativeRun(task:Json){if(!task.runId||!task.sessionKey)problem('capability_unavailable','Task has no confirmed native run',409);return {runId:task.runId as string,sessionKey:task.sessionKey as string,...(task.sessionId?{sessionId:task.sessionId as string}:{})};}
 async function inspect(ctx:CallContext,id:string){
  await authorize(ctx,'tasks.read',taskRef(subjectIdOf(ctx),id));const task=await read(db,'tasks',subjectIdOf(ctx),id);
  if(!runtime(task)||['completed','result_ready','cancelled','failed'].includes(task.status as string)||task.paused)return taskView(task);
  const native:NativeProgress|undefined=task.runId?await using(ctx,task,client=>client.inspect(nativeRun(task))):['starting','unknown'].includes(task.status as string)?await using(ctx,task,client=>client.locate({taskId:id,subjectId:subjectIdOf(ctx)})):undefined;
  const failed=Boolean(native&&['failed','cancelled'].includes(native.status));
  const result=failed?undefined:native?native.result:task.result as NativeProgress['result'];
  if(!native&&!result)return taskView(task);
  let publication=task.resultPublication as {status:'pending'|'published';sourceRefs:Ref[];refs:Ref[];problem?:ReturnType<typeof safeProblem>}|undefined;
  const needsPublication=Boolean(task.cognitionBound||task.cognitionAuthority||result?.outputRef&&typeof result.outputRef==='object'&&'product'in result.outputRef&&result.outputRef.product==='nous'||result?.outputRefs?.some(ref=>ref&&typeof ref==='object'&&'product'in ref&&ref.product==='nous'));
  if(result&&needsPublication){
   const refs:Ref[]=[];let sourceRefs:Ref[]=[];
   try{
    const selected=RefSchema.array().safeParse(result.outputRefs);
    if(!selected.success||!selected.data.length)problem('capability_unavailable','Task has no saved selected Nous output to publish',409);
    sourceRefs=selected.data;
    const authority=task.runtimeAuthority as TaskAuthority|undefined;
    if(!authority||!task.cognitionAuthority)problem('capability_unavailable','Original Task Worker publication authority is unavailable',409);
    const worker:CallContext={...ctx,actor:{kind:'worker',id:authority.id,authorityRef:authority.authorityRef},consumer:authority.consumer,purpose:'worker',audience:[],subjectId:subjectIdOf(ctx)};
    await authentication.currentAuthority(worker);
    for(let index=0;index<sourceRefs.length;index++){
     const current=await read(db,'tasks',subjectIdOf(ctx),id);
     if(!taskIsActive(current)||digest(current.runtimeAuthority)!==digest(authority)||digest(current.cognitionAuthority)!==digest(task.cognitionAuthority))problem('forbidden','Task no longer permits publication by its original Worker',403);
     const source=sourceRefs[index]!;
     if(publication?.refs[index]&&digest(publication.sourceRefs[index])===digest(source)){refs.push(publication.refs[index]!);continue;}
     const published=await cognition.publish({...worker,trace:{...worker.trace,operationId:`task:${id}/publication/${digest(source)}`}},source);
     refs.push(published.ref);
    }
    publication={status:'published',sourceRefs,refs};
   }catch(error){publication={status:'pending',sourceRefs,refs,problem:safeProblem(error,'hept.task_publication_pending')};}
  }
  return db.transaction().execute(async tx=>{
   await tx.selectFrom('tasks').select('id').where('subjectId','=',subjectIdOf(ctx)).where('id','=',id).forUpdate().execute();const current=await read(tx,'tasks',subjectIdOf(ctx),id);
   await authorize(ctx,'tasks.read',taskRef(subjectIdOf(ctx),id),tx);
   if(['completed','result_ready'].includes(current.status as string))return taskView(current);
   const previous=current.result as NativeProgress['result'];if(previous?.outputRef&&result?.outputRef&&digest(previous.outputRef)!==digest(result.outputRef))problem('conflict','Task native output identity changed during publication',409);
   const capture=result?(current.resultTimeCapture as TimeCaptureReceipt|undefined)??await time.captureIn(tx,ctx,{operationId:`task:${id}/result/observed`}):undefined;
   const active=taskIsActive(current),ready=Boolean(result&&(!needsPublication||publication?.status==='published'));
   const updated=await put(tx,'tasks',subjectIdOf(ctx),{...current,...(active?{status:failed?native!.status:result?ready?'result_ready':'waiting':native!.status}:{}),...(native?.problem?{error:native.problem}:{}),...(native?{nativeStatus:native.status,progress:native.progress,runId:native.runId,sessionKey:native.sessionKey,...(native.sessionId?{sessionId:native.sessionId}:{})}:{}),...(result?{result,resultRecordedAt:capture!.point,resultTimeCapture:capture}:{}),...(publication?{resultPublication:publication}:{}),lastInspectedAt:readReal()},id,current.revision as number);
   if(active&&ready)await put(tx,'opportunities',subjectIdOf(ctx),{kind:'work',originRef:taskRef(subjectIdOf(ctx),id),availableAt:capture!.point,state:'unnoticed',conversationId:(current.returnTarget as Json|undefined)?.conversationId,notice:{title:current.goal,resultReady:true}});
   return taskView(updated);
  });
 }
 async function prepareAuthority(ctx:CallContext,id:string){
  let task=await read(db,'tasks',subjectIdOf(ctx),id);if(ctx.actor.kind!=='subject'||ctx.consumer.kind!=='subject'||ctx.consumer.id!==subjectIdOf(ctx))problem('forbidden','Native task execution requires the saved Subject authority',403);
  const previousAuthority=task.runtimeAuthority,previousCognition=task.cognitionAuthority as RemoteWorkerAuthority|undefined;const request=taskRequest.parse({...task,clientSubmissionId:task.clientSubmissionId??`decision:${task.decisionId}:${id}`});
  if(request.workspaceRef){const ref=request.workspaceRef;if(ref.product!=='hept'||ref.installationId!==installationId||ref.subjectId!==subjectIdOf(ctx)||ref.kind!=='workspace'||ref.selector)problem('forbidden','Task workspace is outside its actual Subject',403);await authorize(ctx,'workspaces.read',ref);await read(db,'workspaces',subjectIdOf(ctx),ref.id);}
  const snapshot=await models.prepare(ctx,'worker');if(snapshot.definition.managedBy!=='native')problem('capability_unavailable','The worker role requires a native OpenClaw resource',503);
  const binding=snapshot.definition.binding,executionScope=await host.withClient(ctx,binding.runtimeId,client=>client.describe({taskId:id,subjectId:subjectIdOf(ctx),workspaceRef:request.workspaceRef,allowedTools:request.allowedTools}));
  if(executionScope.model.nativeResourceId!==binding.nativeResourceId||executionScope.model.configRevision!==binding.configRevision||executionScope.model.actualProvider!==snapshot.actualProvider||executionScope.model.actualModelId!==snapshot.actualModelId)problem('conflict','Native task selection differs from the approved worker role',409);
  const current=await authentication.currentAuthority(ctx),now=readReal();let expiresAt=task.authorityExpiresAt as DelegationScope['expiresAt']??request.expiresAt??{domainId:'real',at:addMicros(now.at,86_400_000_000n)};
  if(current.expiresAt&&current.expiresAt.at<expiresAt.at)expiresAt=current.expiresAt;if(expiresAt.at<=now.at)problem('forbidden','Task authority has expired',403);
  const prior=previousAuthority?await authentication.delegations.read(ctx,(previousAuthority as TaskAuthority).delegationId):undefined;
  const authorityOperationId=task.authorityOperationId as string|undefined??`task:${id}/start`;
  const adopted=await db.transaction().execute(async tx=>{
   await tx.selectFrom('tasks').select('id').where('subjectId','=',subjectIdOf(ctx)).where('id','=',id).forUpdate().executeTakeFirstOrThrow();
   const latest=await read(tx,'tasks',subjectIdOf(ctx),id);if(!taskIsActive(latest)||latest.revision!==task.revision)problem('conflict','Task changed before its execution scope was adopted',409);
   await authorize(ctx,'tasks.start',taskRef(subjectIdOf(ctx),id),tx);
   const prepared=await put(tx,'tasks',subjectIdOf(ctx),{...latest,...request,budgetOwnerId:latest.budgetOwnerId??id,executionScope,authorityExpiresAt:expiresAt,authorityOperationId,modelRef:{product:'hept',installationId,kind:'ModelResource',...snapshot.actualResource}},id,latest.revision as number);
   const scope=workerScope(installationId,subjectIdOf(ctx),prepared),grant=await authentication.delegations.create(ctx,{name:`Task ${id}`,principalKind:'worker',scope},tx);
   if(prior&&prior.state!=='revoked')await authentication.delegations.revoke(ctx,prior.id,{expectedRevision:prior.revision},tx);
   const runtimeAuthority:TaskAuthority={delegationId:grant.delegationId,authorityRef:grant.authorityRef,id:scope.consumer.id,consumer:scope.consumer};
   return {task:await put(tx,'tasks',subjectIdOf(ctx),{...prepared,runtimeAuthority},id,prepared.revision as number),scope,runtimeAuthority};
  });
  task=adopted.task;const {scope,runtimeAuthority}=adopted;let grantedRemote:RemoteWorkerAuthority|undefined;
  try{const latest=await read(db,'tasks',subjectIdOf(ctx),id);if(!taskIsActive(latest)||digest(latest.runtimeAuthority)!==digest(runtimeAuthority))problem('conflict','Task changed before remote Worker admission',409);grantedRemote=await cognition.workerBindings?.bind({...ctx,trace:{...ctx.trace,operationId:authorityOperationId}},{taskRef:taskRef(subjectIdOf(ctx),id),scope});if(grantedRemote){const current=await read(db,'tasks',subjectIdOf(ctx),id);if(!taskIsActive(current)||digest(current.runtimeAuthority)!==digest(runtimeAuthority))problem('conflict','Task changed before its remote Worker authority was adopted',409);task=await put(db,'tasks',subjectIdOf(ctx),{...current,cognitionBound:true,cognitionAuthority:grantedRemote},id,current.revision as number);}if(previousCognition&&previousCognition.authorityRef!==grantedRemote?.authorityRef)await cognition.workerBindings?.revoke(ctx,previousCognition);return {task,request,executionScope};}
  catch(error){const cleanup=await Promise.allSettled([revokeTaskAuthority(authentication,ctx,{delegationId:runtimeAuthority.delegationId}),...(grantedRemote&&cognition.workerBindings?[cognition.workerBindings.revoke(ctx,grantedRemote)]:[])]);if(cleanup.some(result=>result.status==='rejected')){const current=await read(db,'tasks',subjectIdOf(ctx),id);await put(db,'tasks',subjectIdOf(ctx),{...current,preparationCleanupPending:true},id,current.revision as number);}throw error;}
 }
 async function registerInvocation(ctx:CallContext,call:ModelCallView){
  const native=NativeOriginSchema.parse(call.native),id=ctx.consumer.id;
  if(ctx.actor.kind!=='worker'||ctx.consumer.kind!=='worker'||call.subjectId!==subjectIdOf(ctx)||digest(call.consumer)!==digest(ctx.consumer))problem('forbidden','Task invocation is not produced by its actual Worker',403);
  await db.transaction().execute(async tx=>{await tx.selectFrom('tasks').select('id').where('subjectId','=',subjectIdOf(ctx)).where('id','=',id).forUpdate().executeTakeFirstOrThrow();const task=await read(tx,'tasks',subjectIdOf(ctx),id),scope=task.executionScope as NativeExecutionScope;await authentication.currentAuthority(ctx,tx);if(!taskIsActive(task)||scope.runtimeId!==native.runtimeId||scope.sessionKey!==native.sessionKey||digest((task.runtimeAuthority as TaskAuthority).authorityRef)!==digest(ctx.actor.authorityRef))problem('forbidden','Task no longer admits this prepared invocation',403);await put(tx,'tasks',subjectIdOf(ctx),{...task,lastNativeInvocation:{ref:{product:'hept',installationId,subjectId:subjectIdOf(ctx),kind:'ModelInvocation',id:call.identity.invocationId},native}},id,task.revision as number);});
 }
 async function planRecovery(ctx:CallContext,id:string,input:unknown){
  const request=taskRecoveryPlanInput.parse(input);await authorize(ctx,'tasks.read',taskRef(subjectIdOf(ctx),id));const task=await read(db,'tasks',subjectIdOf(ctx),id),scope=task.executionScope as NativeExecutionScope|undefined;
  if(!scope||!task.runId||!task.sessionKey)problem('capability_unavailable','Task has no original native execution to recover',409);
  let native:NativeOrigin;if(request.invocationId){const call=await models.invocations.read(ctx,{invocationId:request.invocationId});native=NativeOriginSchema.parse(call.native);if(call.subjectId!==subjectIdOf(ctx)||call.consumer.kind!=='worker'||call.consumer.id!==id||call.consumer.host!==scope.runtimeId)problem('forbidden','Invocation belongs to a different Task',403);}else{const stored=task.lastNativeInvocation as Json|undefined;if(!stored)problem('capability_unavailable','Select an original saved model invocation for this Task',409);native=NativeOriginSchema.parse(stored.native);}
  if(native.runtimeId!==scope.runtimeId||native.sessionKey!==task.sessionKey||native.runId!==task.runId)problem('forbidden','Recovery does not refer to the original Task run',403);
  return host.withClient(ctx,scope.runtimeId,client=>client.planRecovery({native:{runtimeId:native.runtimeId,sessionKey:native.sessionKey,sessionId:native.sessionId,runId:native.runId,callId:native.callId},expectedScope:scope},ctx.trace.traceparent));
 }
 async function resume(ctx:CallContext,id:string,input:unknown,issuer:CallContext){
  const request=taskRecovery.parse(input),requestDigest=digest(request),sid=subjectIdOf(ctx),operationId=ctx.trace.operationId;
  await authorize(ctx,'tasks.start',taskRef(sid,id));if(issuer.actor.kind!=='subject'||issuer.consumer.kind!=='subject'||issuer.consumer.host!==installationId||issuer.consumer.id!==sid||issuer.subjectId!==sid)problem('forbidden','Task recovery requires the current saved Subject authority',403);
  let task=await read(db,'tasks',sid,id),recovery=task.recovery as Json|undefined;
  if(recovery?.operationId===operationId){if(recovery.requestDigest!==requestDigest)problem('conflict','Task recovery submission has different input',409);if(recovery.submitted)return inspect(ctx,id);}
  else{
   if(task.revision!==request.expectedRevision)problem('conflict','Task changed before recovery',409);if(!task.paused&&!['failed','cancelled','waiting','unknown'].includes(task.status as string))problem('conflict','Task is not awaiting an explicit native recovery',409);
   const expected=await planRecovery(ctx,id,{invocationId:request.invocationId}),previous=task.runtimeAuthority as TaskAuthority|undefined,prior=previous?await authentication.delegations.read(ctx,previous.delegationId):undefined;
   const expiresAt=task.authorityExpiresAt as DelegationScope['expiresAt'];if(!expiresAt||expiresAt.at<=readReal().at)problem('forbidden','Original Task authority lifetime has expired',403);
   task=await db.transaction().execute(async tx=>{
    await tx.selectFrom('tasks').select('id').where('subjectId','=',sid).where('id','=',id).forUpdate().executeTakeFirstOrThrow();const latest=await read(tx,'tasks',sid,id);if(latest.revision!==request.expectedRevision||digest(latest.executionScope)!==digest(expected.executionScope))problem('conflict','Task scope changed before recovery',409);await authorize(ctx,'tasks.start',taskRef(sid,id),tx);
    const {error:previousError,...document}=latest;const prepared=await put(tx,'tasks',sid,{...document,status:'starting',paused:false,authorityOperationId:`task:${id}/recovery:${operationId}`,recovery:{operationId,requestDigest,expected,requestedBy:ctx.actor,requestedAt:readReal(),submitted:false,previousAuthority:previous,previousCognition:latest.cognitionAuthority}},id,latest.revision as number),scope=workerScope(installationId,sid,prepared),grant=await authentication.delegations.create(issuer,{name:`Task ${id} recovery`,principalKind:'worker',scope},tx);
    if(prior&&prior.state!=='revoked')await authentication.delegations.revoke(ctx,prior.id,{expectedRevision:prior.revision},tx);
    return put(tx,'tasks',sid,{...prepared,runtimeAuthority:{delegationId:grant.delegationId,authorityRef:grant.authorityRef,id:scope.consumer.id,consumer:scope.consumer}},id,prepared.revision as number);
   });recovery=task.recovery as Json;
  }
  const authority=task.runtimeAuthority as TaskAuthority,scope=workerScope(installationId,sid,task),worker:CallContext={...issuer,actor:{kind:'worker',id:authority.id,authorityRef:authority.authorityRef},consumer:authority.consumer,purpose:'worker',audience:[]},phase={...issuer,trace:{...issuer.trace,operationId:task.authorityOperationId as string}};
  let remote:RemoteWorkerAuthority|undefined,submitted=false;
  try{
   await authentication.currentAuthority(worker);remote=await cognition.workerBindings?.bind(phase,{taskRef:taskRef(sid,id),scope});
   const previousCognition=(recovery as Json).previousCognition as RemoteWorkerAuthority|undefined;if(previousCognition&&previousCognition.authorityRef!==remote?.authorityRef)await cognition.workerBindings?.revoke(issuer,previousCognition);
   task=await db.transaction().execute(async tx=>{await tx.selectFrom('tasks').select('id').where('subjectId','=',sid).where('id','=',id).forUpdate().executeTakeFirstOrThrow();const latest=await read(tx,'tasks',sid,id);if((latest.recovery as Json)?.operationId!==operationId||!taskIsActive(latest)||digest(latest.runtimeAuthority)!==digest(authority))problem('conflict','Task changed before native recovery admission',409);await authentication.currentAuthority(worker,tx);return put(tx,'tasks',sid,{...latest,...(remote?{cognitionBound:true,cognitionAuthority:remote}:{}),recovery:{...latest.recovery as Json,submitted:true}},id,latest.revision as number);});
   submitted=true;const native=await using(worker,task,client=>client.recover({expected:(task.recovery as Json).expected as Parameters<NativeClient['recover']>[0]['expected']},ctx.trace.traceparent)),expected=(task.recovery as Json).expected as {runId:string;sessionKey:string;sessionId:string};
   if(native.runId!==expected.runId||native.sessionKey!==expected.sessionKey||native.sessionId!==expected.sessionId)problem('conflict','Native recovery returned a different execution identity',409);
   const latest=await read(db,'tasks',sid,id);if(!taskIsActive(latest))await host.withClient(issuer,(task.executionScope as NativeExecutionScope).runtimeId,client=>client.cancel(native));
   return taskView(await put(db,'tasks',sid,{...latest,...native,status:taskIsActive(latest)?'waiting':latest.status,nativeStatus:'accepted',recovery:{...latest.recovery as Json,accepted:true}},id,latest.revision as number));
  }catch(error){
   const cleanup=submitted?[]:await Promise.allSettled([revokeTaskAuthority(authentication,issuer,authority),...(remote&&cognition.workerBindings?[cognition.workerBindings.revoke(issuer,remote)]:[])]);const latest=await read(db,'tasks',sid,id);
   await put(db,'tasks',sid,{...latest,status:taskIsActive(latest)?submitted?'unknown':'failed':latest.status,error:safeProblem(error),...(cleanup.some(result=>result.status==='rejected')?{preparationCleanupPending:true}:{})},id,latest.revision as number);throw error;
  }
 }
 async function readNativeFacts(hostCtx:CallContext,native:NativeOrigin){
  await authorize(hostCtx,'native.record',{product:'hept',installationId,kind:'NativeRuntime',id:native.runtimeId});
  const facts=await host.withClient(hostCtx,native.runtimeId,client=>client.readCall(native,hostCtx.trace.traceparent));if(!facts?.task)problem('not_found','Actual native Task call is not present',404);
  if(facts.task.subjectId!==subjectIdOf(hostCtx))problem('forbidden','Native call belongs to another Subject',403);
  return facts;
 }
 async function workerContext(hostCtx:CallContext,native:NativeOrigin,phase:'prepare'|'dispatch'|'complete'){
  const facts=await readNativeFacts(hostCtx,native),task=await read(db,'tasks',facts.task!.subjectId,facts.task!.taskId),scope=task.executionScope as NativeExecutionScope|undefined,authority=task.runtimeAuthority as TaskAuthority|undefined;
  if(!scope||!authority||scope.runtimeId!==native.runtimeId||scope.sessionKey!==facts.task!.sessionKey)problem('forbidden','Native call is outside the saved Task execution authority',403);
  const ctx:CallContext={...hostCtx,actor:{kind:'worker',id:authority.id,authorityRef:authority.authorityRef},consumer:authority.consumer,purpose:'worker',audience:[],subjectId:facts.task!.subjectId,trace:{...hostCtx.trace,operationId:`native:${native.runtimeId}:${native.callId}`}};
  if(phase!=='complete'){if(!taskIsActive(task))problem('forbidden','Task no longer permits new execution',403);await authentication.currentAuthority(ctx);}
  return {ctx,task,facts};
 }
 async function sessionContext(hostCtx:CallContext,native:Parameters<NativeClient['readSession']>[0],operation='native.record'){
  await authorize(hostCtx,operation,{product:'hept',installationId,kind:'NativeRuntime',id:native.runtimeId});
  const facts=await host.withClient(hostCtx,native.runtimeId,client=>client.readSession(native,hostCtx.trace.traceparent));if(!facts||facts.task.subjectId!==subjectIdOf(hostCtx))problem('forbidden','Native Session has no actual Task scope for this Subject',403);
  const task=await read(db,'tasks',facts.task.subjectId,facts.task.taskId),scope=task.executionScope as NativeExecutionScope|undefined,authority=task.runtimeAuthority as TaskAuthority|undefined;
  if(!scope||!authority||scope.runtimeId!==native.runtimeId||scope.sessionKey!==facts.task.sessionKey||!taskIsActive(task))problem('forbidden','Task no longer permits cognitive work',403);
  const ctx:CallContext={...hostCtx,actor:{kind:'worker',id:authority.id,authorityRef:authority.authorityRef},consumer:authority.consumer,purpose:'worker',audience:[],subjectId:facts.task.subjectId};await authentication.currentAuthority(ctx);return {ctx,task,facts};
 }
 async function halt(ctx:CallContext,id:string,paused:boolean){
  await authorize(ctx,'tasks.cancel',taskRef(subjectIdOf(ctx),id));const old=await read(db,'tasks',subjectIdOf(ctx),id);
  let task=await put(db,'tasks',subjectIdOf(ctx),{...old,status:paused?'waiting':'cancelled',paused,waitingReason:paused?'Paused; explicit native recovery or a new continuation is required':undefined},id,old.revision as number);
  const effects:{kind:string;use:()=>Promise<unknown>}[]=[{kind:'local_authority',use:()=>revokeTaskAuthority(authentication,ctx,task.runtimeAuthority)}];
  if(task.cognitionAuthority&&cognition.workerBindings)effects.push({kind:'cognition_authority',use:()=>cognition.workerBindings!.revoke(ctx,task.cognitionAuthority as unknown as RemoteWorkerAuthority)});
  if(task.runId)effects.push({kind:'native_abort',use:()=>using(ctx,task,client=>client.cancel(nativeRun(task)))});
  const results=await Promise.allSettled(effects.map(effect=>effect.use())),pending=results.flatMap((result,index)=>result.status==='rejected'?[{kind:effects[index]!.kind,problem:safeProblem(result.reason)}]:[]);
  if(pending.length){const latest=await read(db,'tasks',subjectIdOf(ctx),id);task=await put(db,'tasks',subjectIdOf(ctx),{...latest,stopPending:pending},id,latest.revision as number);}return taskView(task);
 }
 const authorizeNativeCall:NonNullable<ModelsOptions['nativeBindings']>['authorizeCall']=async(ctx,input,local)=>{
  const hostContext=local?.hostContext;if(!hostContext)problem('forbidden','Native accounting requires a trusted Host call',403);
  const actual=await workerContext(hostContext,input.native,input.phase),model=actual.task.modelRef as Ref;
  if(digest(actual.ctx.actor)!==digest(ctx.actor)||digest(actual.ctx.consumer)!==digest(ctx.consumer)||ctx.subjectId!==actual.ctx.subjectId||model.id!==input.resource.id||model.revision!==input.resource.revision||invocationIdOf(actual.facts)!==input.invocationId)problem('forbidden','Native accounting identity or model differs from the saved Task',403);
  if(input.phase!=='complete'&&(actual.facts.notDispatched||actual.facts.terminal||!actual.facts.active))problem('forbidden','The original native call no longer permits dispatch',403);
 };
 return {
  authorizeNativeCall,workerContext,sessionContext,registerInvocation,planRecovery,resume,
  async checkNativeAuthority(hostCtx:CallContext,native:Parameters<NativeClient['readSession']>[0],toolName?:string){const {task}=await sessionContext(hostCtx,native,'native.authority.check'),scope=task.executionScope as NativeExecutionScope;if(toolName&&(!(task.allowedTools as string[]).includes(toolName)||!scope.allowedTools.includes(toolName)))problem('forbidden','Tool is outside the current Task scope',403);return {allowed:true as const,taskRef:taskRef(subjectIdOf(hostCtx),task.id as string),...(task.workspaceRef?{workspaceRef:task.workspaceRef as Ref}:{})};},
  async cognitionAuthority(ctx:CallContext):Promise<RemoteWorkerAuthority>{const current=await authentication.currentAuthority(ctx),ref=current.scope?.taskRef;if(!ref||ref.product!=='hept'||ref.installationId!==installationId||ref.subjectId!==subjectIdOf(ctx)||ref.kind!=='task')problem('forbidden','Cognition requires the actual Task Worker authority',403);await authorize(ctx,'tasks.read',ref);const task=await read(db,'tasks',subjectIdOf(ctx),ref.id),binding=task.cognitionAuthority as RemoteWorkerAuthority|undefined;if(!binding)problem('capability_unavailable','Task has no saved Nous Worker authority',503);return binding;},
  async validatePreparation(hostCtx:CallContext,input:NativeInvocationPrepare){const actual=await workerContext(hostCtx,input.native,'prepare');if(input.roleId!=='worker'||input.actualProvider!==actual.facts.prepared.provider||input.actualModelId!==actual.facts.prepared.modelId||input.inputTokensEstimate.value!==actual.facts.prepared.inputTokensEstimate||input.maxOutputTokens!==actual.facts.prepared.outputTokens||digest(input.inputRefs)!==digest(actual.facts.prepared.inputRefs)||invocationIdOf(actual.facts)!==input.invocationId)problem('forbidden','Billing request differs from the actual native prepared call',403);return actual.ctx;},
  async validateCompletion(hostCtx:CallContext,input:NativeInvocationCompletion & {native:NativeOrigin}){const actual=await workerContext(hostCtx,input.native,'complete'),facts=actual.facts;if(invocationIdOf(facts)!==input.invocationId)problem('forbidden','Completion is outside the original native call',403);const status=facts.settlement?.outcome??(facts.terminal?.providerRefused?'not_sent':facts.terminal?['error','aborted'].includes(facts.terminal.stopReason??'')?'unknown':'completed':facts.notDispatched?'not_sent':'unknown');if(input.status!==status)problem('conflict','Completion status differs from the actual native call',409);if(input.outputRef!==undefined&&digest(input.outputRef)!==digest(facts.terminal?.outputRef??null))problem('conflict','Output reference differs from the original native terminal record',409);const usage=facts.terminal?.usage,normalized=usage?{inputTokens:usage.input+usage.cacheRead+usage.cacheWrite,outputTokens:usage.output,cacheReadTokens:usage.cacheRead,cacheWriteTokens:usage.cacheWrite}:undefined;if(digest(input.usage??null)!==digest(normalized??null)||input.providerRequestId!==facts.terminal?.providerRequestId)problem('conflict','Usage differs from the actual native terminal record',409);return actual.ctx;},
  async budgetConstraints(ctx:CallContext){const current=await authentication.currentAuthority(ctx),ref=current.scope?.taskRef;if(!ref)return {constraints:[]};if(ref.product!=='hept'||ref.installationId!==installationId||ref.subjectId!==subjectIdOf(ctx)||ref.kind!=='task')problem('forbidden','Task budget owner is outside this installation',403);const {ownerId,budget}=await readTaskBudget(db,subjectIdOf(ctx),ref.id);return {constraints:[{key:`hept.task:${installationId}:${ownerId}`,budget}]};},
  async create(ctx:CallContext,input:unknown){const request=taskRequest.parse(input),identity=[ctx.consumer,ctx.actor.kind==='human'?ctx.actor.id:null];return idempotent(db,`task:${subjectIdOf(ctx)}:${digest(identity)}:${request.clientSubmissionId}`,request,async tx=>{const id=v7();await authorize(ctx,'tasks.start',taskRef(subjectIdOf(ctx),id),tx);return put(tx,'tasks',subjectIdOf(ctx),{...request,status:'queued',budgetOwnerId:id},id);},subjectIdOf(ctx));},
  async startNative(ctx:CallContext,id:string){await authorize(ctx,'tasks.start',taskRef(subjectIdOf(ctx),id));let task=await read(db,'tasks',subjectIdOf(ctx),id);if(task.runId||['starting','unknown'].includes(task.status as string))return inspect(ctx,id);assertDispatch();const prepared=await prepareAuthority(ctx,id);task=await put(db,'tasks',subjectIdOf(ctx),{...prepared.task,status:'starting'},id,prepared.task.revision as number);let attempted=false;
   try{await authorize(ctx,'tasks.start',taskRef(subjectIdOf(ctx),id));const admission=await read(db,'tasks',subjectIdOf(ctx),id);if(admission.status!=='starting'||admission.paused||digest(admission.runtimeAuthority)!==digest(task.runtimeAuthority))problem('conflict','Task no longer permits native admission',409);assertDispatch();attempted=true;const native=await using<Awaited<ReturnType<import('../platform/execution.js').NativeClient['start']>>>(ctx,task,client=>client.start({taskId:id,subjectId:subjectIdOf(ctx),goal:prepared.request.goal,allowedTools:prepared.request.allowedTools,inputRefs:prepared.request.inputRefs,workspaceRef:prepared.request.workspaceRef,budget:prepared.request.budget,returnTarget:prepared.request.returnTarget,expectedScope:prepared.executionScope,traceparent:ctx.trace.traceparent}));const latest=await read(db,'tasks',subjectIdOf(ctx),id);if(!taskIsActive(latest))await host.withClient(ctx,prepared.executionScope.runtimeId,client=>client.cancel(native));return put(db,'tasks',subjectIdOf(ctx),{...latest,...native,status:taskIsActive(latest)?'waiting':latest.status,nativeStatus:'accepted',...(taskIsActive(latest)?{waitingReason:'Awaiting native run confirmation'}:{})},id,latest.revision as number);}
   catch(error){const latest=await read(db,'tasks',subjectIdOf(ctx),id);if(!attempted)await revokeTaskAuthority(authentication,ctx,latest.runtimeAuthority);return put(db,'tasks',subjectIdOf(ctx),{...latest,status:taskIsActive(latest)?attempted?'unknown':'waiting':latest.status,error:safeProblem(error)},id,latest.revision as number);}
  },
  inspect,
  async result(ctx:CallContext,id:string){await authorize(ctx,'tasks.read',taskRef(subjectIdOf(ctx),id));const task=await read(db,'tasks',subjectIdOf(ctx),id);if(!task.result||!['completed','result_ready'].includes(task.status as string))problem('capability_unavailable','Task result is not ready',409);const visible=taskView(task);if(!visible.result)problem('capability_unavailable','Task result publication is pending',409);return {taskId:id,returnTarget:task.returnTarget,result:visible.result};},
  async transcript(ctx:CallContext,id:string,options?:{cursor?:string;offset?:number}){await authorize(ctx,'tasks.debug',taskRef(subjectIdOf(ctx),id));const task=await read(db,'tasks',subjectIdOf(ctx),id);return using(ctx,task,client=>client.transcript({...nativeRun(task),...options}));},
  async purgeNative(ctx:CallContext){await authorize(ctx,'data.purge');const tasks=(await list(db,'tasks',subjectIdOf(ctx))).filter(t=>t.runId&&t.sessionKey),deleted:string[]=[],pending:string[]=[];for(const task of tasks){try{const result=await using<{deleted:string[];pending:string[]}>(ctx,task,client=>client.purge(nativeRun(task)));deleted.push(...result.deleted);pending.push(...result.pending);}catch(error){pending.push(`native:${task.id}:${safeProblem(error).code}`);}}return {deleted,pending};},
  cancel:(ctx:CallContext,id:string)=>halt(ctx,id,false),
  pause:(ctx:CallContext,id:string)=>halt(ctx,id,true),
  async createContinuation(ctx:CallContext,id:string,input:unknown){const request=taskContinuation.parse(input);await authorize(ctx,'tasks.start',taskRef(subjectIdOf(ctx),id));return idempotent(db,`task-continuation:${subjectIdOf(ctx)}:${id}:${ctx.trace.operationId}`,{taskId:id,...request},async tx=>{await tx.selectFrom('tasks').select('id').where('subjectId','=',subjectIdOf(ctx)).where('id','=',id).forUpdate().executeTakeFirstOrThrow();const task=await read(tx,'tasks',subjectIdOf(ctx),id);if(task.revision!==request.expectedRevision)problem('conflict','Task changed before continuation',409);if(!task.paused&&!['failed','cancelled'].includes(task.status as string))problem('conflict','Cancel or pause the original native task before creating a new run',409);const next=v7();await authorize(ctx,'tasks.start',taskRef(subjectIdOf(ctx),next),tx);const {runtimeAuthority,cognitionAuthority,cognitionBound,executionScope,modelRef,authorityExpiresAt,authorityOperationId,runId,sessionKey,sessionId,result,resultPublication,resultRecordedAt,resultTimeCapture,progress,nativeStatus,waitingReason,stopPending,lastInspectedAt,lastInspectionError,preparationCleanupPending,error,lastContinuationRef,lastNativeInvocation,recovery,...original}=task;const created=await put(tx,'tasks',subjectIdOf(ctx),{...original,...(request.goal?{goal:request.goal}:{}),continuedFrom:id,budgetOwnerId:task.budgetOwnerId??id,paused:false,status:'queued',clientSubmissionId:`continuation:${id}:${ctx.trace.operationId}`},next);await put(tx,'tasks',subjectIdOf(ctx),{...task,lastContinuationRef:taskRef(subjectIdOf(ctx),next)},id,task.revision as number);return created;},subjectIdOf(ctx));},
  async list(ctx:CallContext){await authorize(ctx,'tasks.read');return {items:(await list(db,'tasks',subjectIdOf(ctx))).map(taskView)};},
  async workspaces(ctx:CallContext,input?:Json){const id=v7();await authorize(ctx,input?'workspaces.write':'workspaces.read',input?makeRef(installationId,subjectIdOf(ctx),'workspace',id):undefined);return input?put(db,'workspaces',subjectIdOf(ctx),input,id):{items:await list(db,'workspaces',subjectIdOf(ctx))};},
 };
}
export async function readTaskBudget(db:Kysely<Database>,subjectId:string,id:string){const task=await read(db,'tasks',subjectId,id),ownerId=(task.budgetOwnerId as string|undefined)??id,owner=ownerId===id?task:await read(db,'tasks',subjectId,ownerId);return {ownerId,budget:taskBudget.parse(owner.budget??{})};}
