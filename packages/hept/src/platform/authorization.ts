import type {Kysely} from 'kysely';
import type {Database} from './database.js';
import {workerIssuancePolicy} from '../work/authority.js';
import {channelIngressScope} from '../communication/channels.js';
import {digest} from './runtime.js';
import {readReal,addMicros} from '@nous-wave/platform/time';
import type { OperationPolicy } from '@nous-wave/platform/credentials';
/** Exact operation catalog consumed by current domain owners. */
export const managementOperations=[
 'activities.read','activities.write','agency.react','agency.read','channels.read','channels.write','commitments.read','commitments.write','costs.read',
 'data.manage','data.export','data.fork','data.import','data.purge','installation.manage','messages.read','messages.receive','messages.send',
 'models.invoke','models.test','models.read','models.manage','models.invocations.read','models.reconcile','providers.read','providers.manage','roles.read','operations.control','operations.debug','operations.read','people.read','people.write','policy.read','policy.write',
 'pursuits.read','pursuits.write','settings.read','sources.readPolicies','subjects.bind','subjects.control','subjects.create','subjects.read',
 'tasks.cancel','tasks.debug','tasks.read','tasks.start','workspaces.read','workspaces.write','world.act','world.observe','world.read','world.write',
 'delegations.create','delegations.read','delegations.update','delegations.revoke','host.status','host.drain','host.stop','openapi.read',
 'settings.describe','settings.update','settings.reset','settings.history','settings.restore','settings.applied','settings.export','settings.import','settings.deleteScopes','secrets.manage','native.connect','native.record','native.authority.check','network.read','network.probe','cognition.invoke','channels.use','time.domains.create','time.domains.read','clock.configure','clock.pause','clock.resume','clock.advance','clock.inspect','clock.history','clock.read','clock.capture','clock.references.read','time.bindings.update','prompts.describe','prompts.list','prompts.read','prompts.save','prompts.activate','prompts.reset','prompts.preview','prompts.snapshot','prompts.render','prompts.history','prompts.export','prompts.watch'] as const;
export const subjectOperations=[
 'activities.read','activities.write','agency.react','agency.read','commitments.read','commitments.write','messages.read','messages.send','models.invoke',
 'people.read','pursuits.read','pursuits.write','subjects.read','tasks.cancel','tasks.read','tasks.start','world.act','world.observe','world.read',
 'delegations.create','delegations.read','delegations.revoke','native.connect','workspaces.read','cognition.invoke','channels.use','clock.read','clock.capture','clock.references.read','prompts.snapshot','prompts.render'] as const;
const required=new Set(['models.invoke','messages.send','tasks.start','workspaces.write','channels.use','cognition.invoke','native.connect','native.record','native.authority.check']);
export function operationPolicy(operation:string):OperationPolicy|undefined{
 if(!(managementOperations as readonly string[]).includes(operation))return undefined;
 return {allowedPlanes:(subjectOperations as readonly string[]).includes(operation)?['system','subject']:['system'],targetRequired:required.has(operation)};
}
/** Default local management key; issuance is limited to an authenticated user. */
export function managementScope(installationId:string):import('@nous-wave/platform/credentials').DelegationScope{return {
 plane:'system',operations:[...managementOperations],subjectIds:[],consumer:{kind:'maintenance',host:'hept',id:installationId},
 purposes:['*'],audiences:['*'],targets:[],inputRefs:[],expiresAt:{domainId:'real',at:addMicros(readReal().at,86_400_000_000n)},mayDelegate:true,
};}

/** Current product resources define cross-consumer delegation; Work owns Task bounds. */
export function issuancePolicy(db:Kysely<Database>,installationId:string):ReturnType<typeof workerIssuancePolicy>{
 const worker=workerIssuancePolicy(db,installationId);
 return async(input,client)=>{const {issuer,requested,requestedPrincipalKind}=input;
  if(issuer.consumer.kind==='maintenance'&&issuer.consumer.host==='hept'&&issuer.consumer.id===installationId){
   if(requestedPrincipalKind==='subject')return requested.plane==='subject'&&requested.consumer.kind==='subject'&&requested.consumer.host===installationId&&requested.subjectIds.length===1&&requested.consumer.id===requested.subjectIds[0]&&requested.mayDelegate&&requested.operations.every(op=>(subjectOperations as readonly string[]).includes(op));
   if(requestedPrincipalKind==='service'&&digest(requested.consumer)===digest(issuer.consumer)&&await channelIngressScope(client??db,requested))return true;
   const hostOperations=['native.record','native.connect','native.authority.check','models.invocations.read'];
   return requestedPrincipalKind==='service'&&requested.plane==='system'&&digest(requested.consumer)===digest(issuer.consumer)&&requested.subjectIds.length===1&&Boolean(requested.expiresAt)&&!requested.mayDelegate&&requested.inputRefs.length===0&&!requested.taskRef&&!requested.nativeBinding&&requested.purposes.length===1&&requested.purposes[0]==='worker'&&requested.operations.every(operation=>hostOperations.includes(operation))&&requested.targets.length>0&&requested.targets.every(target=>target.kind==='object'&&target.actions.every(operation=>hostOperations.includes(operation)&&operation!=='models.invocations.read')&&target.refs.every(ref=>ref.product==='hept'&&ref.installationId===installationId&&ref.kind==='NativeRuntime'&&!ref.subjectId&&!ref.revision&&!ref.selector));
  }
  return worker(input,client);
 };
}
