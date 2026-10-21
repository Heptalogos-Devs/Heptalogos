import {serialize,deserialize} from 'node:v8';
import * as cacache from 'cacache';
import type {CallContext,Ref,Policy} from '@nous-wave/contracts/common';
import type {ModelInvocationIdentity,InvocationSnapshot} from '@nous-wave/contracts/models';
import type {ModelData} from '@nous-wave/platform/models';
import type {Kysely} from '@nous-wave/platform/storage';
import {canonicalize} from 'json-canonicalize';
import type {Database,Json} from './database.js';
import {read,put,problem,subjectIdOf,type Authorization} from './runtime.js';
import {permits} from '../communication/media.js';
import type {CognitionConnection} from './models.js';
/** Product-owned actual model artifacts; typed Provider bytes stay in the existing content store. */
export function modelData(db:Kysely<Database>,blobRoot:string,installationId:string,authorize:Authorization,cognition:CognitionConnection):ModelData & {outputSources(ctx:CallContext,logicalOperationId:string):Promise<Ref[]>}{
 const scopeId=(ctx:CallContext)=>ctx.subjectId??'installation';
 const ref=(ctx:CallContext,id:string,direction:'input'|'output'):Ref=>({product:'hept',installationId,...(ctx.subjectId?{subjectId:ctx.subjectId}:{}),kind:'ModelArtifact',id,selector:{kind:'node',pointer:`/${direction}`}});
 async function artifact(ctx:CallContext,reference:Ref){
  if(reference.product!=='hept'||reference.installationId!==installationId||reference.subjectId!==ctx.subjectId||reference.kind!=='ModelArtifact')problem('forbidden','Model artifact reference belongs to a different owner',403);
  const record=await read(db,'modelArtifacts',scopeId(ctx),reference.id);
  const direction=reference.selector?.kind==='node'&&['/input','/output'].includes(reference.selector.pointer)?reference.selector.pointer.slice(1):undefined;if(!direction)problem('invalid_input','Model artifact requires the actual input or output selector');
  const row=record[direction] as Json|undefined;if(!row)problem('not_found','Model artifact portion is unavailable',404);
  if(canonicalize(row.scope)!==canonicalize(ctx.consumer))await authorize(ctx,'data.manage',reference);
  return row;
 }
 async function validateSources(ctx:CallContext,refs:readonly Ref[]){
  for(const reference of refs){
   if(reference.product==='nous'){if(!cognition.validateSources)problem('dependency_unavailable','Nous source authority is unavailable',503);await cognition.validateSources(ctx,[reference]);continue;}
   if(reference.product!=='hept'||reference.installationId!==installationId||reference.subjectId!==ctx.subjectId)problem('forbidden','Model source belongs to a different authority',403);
   if(reference.kind==='ModelArtifact'){const row=await artifact(ctx,reference);await validateSources(ctx,row.inputRefs as Ref[]);continue;}
   const table={message:'messages',media:'media',world:'worlds',event:'realizedEvents',task:'tasks',person:'people'}[reference.kind] as 'messages'|'media'|'worlds'|'realizedEvents'|'tasks'|'people'|undefined;
   if(!table)problem('forbidden','Model source has no readable product owner',403);
   await authorize(ctx,table==='messages'||table==='media'?'messages.read':table==='worlds'||table==='realizedEvents'?'world.read':table==='tasks'?'tasks.read':'people.read',reference);const row=await read(db,table,subjectIdOf(ctx),reference.id);
   if(row.status==='retracted'||row.status==='missing'||row.policy&&!permits(row.policy as Policy,ctx))problem('forbidden','Model source is unavailable for this purpose or audience',403);
  }
 }
 async function save(ctx:CallContext,direction:'input'|'output',input:{identity:ModelInvocationIdentity;snapshot:InvocationSnapshot;value:unknown;inputRefs:readonly Ref[];observed?:unknown;realAt?:string}){
  const sid=scopeId(ctx),id=input.identity.invocationId,key=`model:${direction}:${id}`;
  const bytes=serialize(input.value),integrity=String(await cacache.put(blobRoot,key,bytes));
  return db.transaction().execute(async tx=>{
   if(ctx.subjectId)await tx.selectFrom('subjects').select('id').where('id','=',sid).forUpdate().executeTakeFirstOrThrow();
   const old=await tx.selectFrom('modelArtifacts').selectAll().where('id','=',id).where('subjectId','=',sid).executeTakeFirst();
   const prior=old?.document[direction] as Json|undefined;if(prior){if(prior.integrity!==integrity)problem('conflict','Saved model artifact contains different actual bytes',409);return ref(ctx,id,direction);}
   await put(tx,'modelArtifacts',sid,{...old?.document,identity:input.identity,modelRef:{product:'hept',installationId,kind:'ModelResource',id:input.snapshot.actualResource.id,revision:input.snapshot.actualResource.revision},[direction]:{direction,integrity,bytes:bytes.length,inputRefs:[...input.inputRefs],scope:ctx.consumer,policy:{readers:[ctx.subjectId??ctx.actor.id],purposes:['*'],audiences:[...ctx.audience]},observed:input.observed,realAt:input.realAt,preparation:'preparation'in input?input.preparation:undefined}},id,old?.revision);
   return ref(ctx,id,direction);
  });
 }
 return {validateSources,
  async outputSources(ctx,logicalOperationId){const rows=await db.selectFrom('modelArtifacts').selectAll().where('subjectId','=',subjectIdOf(ctx)).where('document','@>',{identity:{logicalOperationId}}).execute();const refs:Ref[]=[];for(const row of rows){const output=row.document.output as Json|undefined;if(!output)continue;if(canonicalize(output.scope)!==canonicalize(ctx.consumer))await authorize(ctx,'data.manage',ref(ctx,row.id,'output'));if(output.cognitionOutputRef)refs.push(output.cognitionOutputRef as Ref);}return refs;},
  async saveInput(ctx,input){return [await save(ctx,'input',input)];},
  async saveOutput(ctx,input){return [await save(ctx,'output',input)];},
  async loadOutput(ctx,input){const output=input.outputRefs.find(item=>item.kind==='ModelArtifact');if(!output)problem('not_found','Saved model output is unavailable',404);const row=await artifact(ctx,output);if(row.direction!=='output')problem('invalid_input','Reference is not an actual model output');return deserialize(Buffer.from(await cacache.get.byDigest(blobRoot,row.integrity as string)));},
  async adopt(ctx,input){
   const call=input.call;if(call.snapshot.definition.managedBy==='native')return;
   if(canonicalize(call.consumer)!==canonicalize(ctx.consumer))problem('forbidden','The actual model Consumer must resume adoption of its saved result',403);
   if(!ctx.subjectId||cognition.available&&!await cognition.available(ctx))return;
   if(!call.observed||!call.formed)problem('invalid_input','Model adoption requires actual observed and formed receipts');
   const portions:Ref[]=[];
   for(const reference of input.inputRefs){if(reference.product==='nous'){portions.push(reference);continue;}const row=await artifact(ctx,reference),raw=deserialize(Buffer.from(await cacache.get.byDigest(blobRoot,row.integrity as string)));const captured=await cognition.capture({...ctx,trace:{...ctx.trace,operationId:`${call.identity.invocationId}/actual-input`}},{kind:'model_input',mediaType:'application/json',text:JSON.stringify(raw),source:{inputs:row.inputRefs,roots:[]},policy:row.policy,occurred:{start:call.observed.point}});portions.push(captured.ref);}
   for(const reference of input.outputRefs){const row=await artifact(ctx,reference),raw=deserialize(Buffer.from(await cacache.get.byDigest(blobRoot,row.integrity as string)));const captured=await cognition.capture({...ctx,trace:{...ctx.trace,operationId:`${call.identity.invocationId}/actual-output`}},{kind:'model_output',mediaType:'application/json',text:JSON.stringify(raw),source:{inputs:portions},policy:row.policy,occurred:{start:call.formed.point}});await db.transaction().execute(async tx=>{const saved=await read(tx,'modelArtifacts',subjectIdOf(ctx),reference.id);await put(tx,'modelArtifacts',subjectIdOf(ctx),{...saved,output:{...saved.output as Json,cognitionOutputRef:captured.ref}},reference.id,saved.revision as number);});await cognition.accept({...ctx,trace:{...ctx.trace,operationId:`${call.identity.invocationId}/actual-consumption`}},{consumer:ctx.consumer,invocationId:call.identity.invocationId,step:call.identity.stepNo??call.identity.physicalOrdinal,portions:portions.map(ref=>({ref})),resultRef:captured.ref,contextViewRef:call.preparation?.contextRef,observed:call.observed.point,purpose:ctx.purpose,completion:'complete'});}
  },
 };
}
