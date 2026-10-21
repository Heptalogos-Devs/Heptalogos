import type {CallContext,Ref} from '@nous-wave/contracts/common';
import type {DelegationScope,Authentication} from '@nous-wave/platform/credentials';
import type {NativeExecutionScope} from '@heptalogos/openclaw/client';
import type {Kysely} from 'kysely';
import type {Database,Json} from '../platform/database.js';
import {digest} from '../platform/runtime.js';
export interface TaskAuthority {delegationId:string;authorityRef:string;id:string;consumer:CallContext['consumer']}
export const workerOperations=['models.invoke','native.connect','cognition.invoke','clock.read','clock.capture','clock.references.read','prompts.snapshot','prompts.render','messages.read','world.read','tasks.read','people.read','workspaces.read'] as const;
const activeStates=new Set(['queued','starting','waiting','running','unknown']);
export function taskIsActive(task:Json){return activeStates.has(task.status as string)&&!task.paused;}
export function workerScope(installationId:string,subjectId:string,task:Json):DelegationScope {
 const execution=task.executionScope as NativeExecutionScope,modelRef=task.modelRef as Ref;
 const inputRefs=(task.inputRefs??[]) as Ref[];
 const ref=(kind:string,id:string):Ref=>({product:'hept',installationId,subjectId,kind,id});
 const sourceOperations:Record<string,string>={message:'messages.read',media:'messages.read',world:'world.read',event:'world.read',activity:'world.read',task:'tasks.read',person:'people.read'};
 return {plane:'subject',operations:[...workerOperations],subjectIds:[subjectId],consumer:{kind:'worker',host:execution.runtimeId,id:task.id as string},purposes:['worker'],audiences:[subjectId],
  targets:[{kind:'object',refs:[modelRef],actions:['models.invoke']},{kind:'object',refs:[{product:'hept',installationId,kind:'NativeRuntime',id:execution.runtimeId}],actions:['native.connect']},{kind:'object',refs:[ref('subject',subjectId)],actions:['cognition.invoke']},{kind:'object',refs:[ref('task',task.id as string)],actions:['tasks.read']},
   ...inputRefs.filter(source=>source.product==='hept'&&source.installationId===installationId&&sourceOperations[source.kind]).map(source=>({kind:'object' as const,refs:[source],actions:[sourceOperations[source.kind]!]})),
   ...(task.workspaceRef?[{kind:'workspace' as const,workspaceRef:task.workspaceRef as Ref,actions:['workspaces.read']}]:[])],
  inputRefs,taskRef:ref('task',task.id as string),nativeBinding:{runtimeId:execution.runtimeId,sessionKey:execution.sessionKey,rootTaskId:task.id as string},expiresAt:task.authorityExpiresAt as DelegationScope['expiresAt'],mayDelegate:false};
}
export function workerIssuancePolicy(db:Kysely<Database>,installationId:string):NonNullable<Parameters<typeof import('@nous-wave/platform/credentials').createAuthentication>[0]['issuancePolicy']>{
 return async({issuer,requested,requestedPrincipalKind},client)=>{
  const taskRef=requested.taskRef;
  if(issuer.actor.kind!=='subject'||issuer.consumer.kind!=='subject'||issuer.consumer.host!==installationId||requestedPrincipalKind!=='worker'||!taskRef||taskRef.product!=='hept'||taskRef.installationId!==installationId||taskRef.kind!=='task'||taskRef.selector||taskRef.revision!==undefined||taskRef.subjectId!==issuer.consumer.id)return false;
  const store:Kysely<Database>=client??db;const row=await store.selectFrom('tasks').select(['id','document','subjectId']).where('id','=',taskRef.id).where('subjectId','=',issuer.consumer.id).executeTakeFirst();
  if(!row||!taskIsActive(row.document)||!row.document.executionScope||!row.document.modelRef||!row.document.authorityExpiresAt)return false;
  const execution=row.document.executionScope as NativeExecutionScope;
  if(digest([...new Set(row.document.allowedTools as string[]??[])].sort())!==digest(execution.allowedTools)||digest(row.document.workspaceRef??null)!==digest(execution.workspaceRef??null))return false;
  return digest(requested)===digest(workerScope(installationId,row.subjectId,{...row.document,id:row.id}));
 };
}
export async function revokeTaskAuthority(auth:Authentication,ctx:CallContext,value:unknown){
 if(!value)return;const authority=value as TaskAuthority;
 const prior=await auth.delegations.read(ctx,authority.delegationId);
 if(prior.state!=='revoked')await auth.delegations.revoke(ctx,authority.delegationId,{expectedRevision:prior.revision});
}
