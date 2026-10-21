import {subjectIdOf,problem,digest} from './runtime.js';
import {Configuration,IdentityApi,DelegationsApi,MaterialsApi,SourcesApi,ContextsApi,EncountersApi,GrowthApi,contextHeaders,problemMiddleware} from '@nous-wave/client';
import {sameRef,type CallContext,type Consumer} from '@nous-wave/contracts/common';
import {AuthenticatedIdentitySchema,DelegationScopeSchema,type AuthenticatedIdentity,type ServiceDelegation,type DelegationScope} from '@nous-wave/contracts/credentials';
import {ContextPrepareSchema,ContextViewSchema,type ContextView} from '@nous-wave/contracts/cognition';
import {BlobResultSchema,MaterialCaptureSchema,MaterialViewSchema,EncounterAcceptSchema,type MaterialView} from '@nous-wave/contracts/materials';
import type {SecretRegistry} from '@nous-wave/platform/credentials';
import type {Network} from '@nous-wave/platform/network';
import type {ProductSettings} from './settings.js';
import type {CognitionConnection,RemoteWorkerAuthority} from './models.js';
const workerOperations=['subjects.read','settings.read','materials.capture','materials.publish','materials.read','knowledge.read','contexts.prepare','contexts.read','encounters.accept','encounters.read','clock.references.read'];
export function cognitionConnection(config:ProductSettings,secrets:SecretRegistry,network:Network,installationId:string,workerAuthority:(ctx:CallContext)=>Promise<RemoteWorkerAuthority>):CognitionConnection {
 const options=(ctx:CallContext)=>({submissionId:ctx.trace.operationId,traceparent:ctx.trace.traceparent,purpose:ctx.purpose,audience:ctx.audience});
 const sameConsumer=(left:Consumer,right:Consumer)=>digest(left)===digest(right);
 async function withClient<C,T>(Api:new(configuration:Configuration)=>C,ctx:CallContext,use:(client:C,identity:AuthenticatedIdentity,baseURL:string)=>Promise<T>,mode:'subject'|'workerHost'|'actual'='actual'):Promise<T>{
  const sid=subjectIdOf(ctx),settings=await config.cognition(sid);if(!settings.nous)problem('capability_unavailable','Nous cognition connection is not configured',503);
  const connection=settings.nous,isWorker=mode==='actual'&&ctx.consumer.kind==='worker',host=mode==='workerHost'||isWorker;
  const credential=host?connection.workerHost:connection.subject;if(!credential)problem('capability_unavailable','This Subject has no configured Nous Worker Host authority',503);
  if(host&&(credential.consumer.kind!=='worker'||credential.consumer.host!==installationId||credential.consumer.id!==sid))problem('forbidden','Nous Worker Host credential is not bound to this Hept installation and Subject',403);
  if(!host&&(credential.consumer.kind!=='subject'||credential.consumer.id!==sid))problem('forbidden','Nous Subject credential belongs to a different Consumer',403);
  const endpoint=new URL(connection.baseURL),resourceRef={product:'hept' as const,installationId,subjectId:sid,kind:'subject',id:sid};
  return network.withClient(ctx,{resource:{resourceRef,operation:'cognition.invoke',allowedOrigins:[endpoint.origin],allowedPathPrefixes:[`${endpoint.pathname.replace(/\/$/,'')}/v1/subjects/${sid}`,`${endpoint.pathname.replace(/\/$/,'')}/v1/identity`,`${endpoint.pathname.replace(/\/$/,'')}/v1/delegations/`],methods:['POST','GET'],credentialOrigins:[endpoint.origin],...connection.network}},transport=>secrets.withSecret(ctx,{ref:credential.credentialRef,purpose:'cognition.connection',resourceRef},async bytes=>{
   const baseURL=connection.baseURL.replace(/\/$/,''),authorization=`Bearer ${new TextDecoder().decode(bytes)}`;const configurationFor=(delegationAuthority?:string)=>new Configuration({basePath:baseURL,headers:{authorization,...contextHeaders({...options(ctx),delegationAuthority})},fetchApi:transport.fetch,middleware:[problemMiddleware]});const parent=configurationFor(),identity=AuthenticatedIdentitySchema.parse(await new IdentityApi(parent).identityRead());
   if(!sameConsumer(identity.consumer,credential.consumer))problem('forbidden','Nous credential does not authenticate as its configured Consumer',403);
   if(!isWorker)return use(new Api(parent),identity,baseURL);
   const binding=await workerAuthority(ctx);
   if(binding.baseURL!==baseURL||binding.parentAuthorityRef!==identity.actor.authorityRef||!sameConsumer(binding.consumer,ctx.consumer))problem('forbidden','Task Nous authority is not issued by the current configured Worker Host',403);
   const configuration=configurationFor(binding.authorityRef),selected=AuthenticatedIdentitySchema.parse(await new IdentityApi(configuration).identityRead());
   if(selected.actor.authorityRef!==binding.authorityRef||!sameConsumer(selected.consumer,ctx.consumer))problem('forbidden','Nous did not select this Task Worker authority',403);
   return use(new Api(configuration),selected,baseURL);
  }));
 }
 return {
  available:async ctx=>Boolean((await config.cognition(subjectIdOf(ctx))).nous),
  workerBindings:{
   async bind(ctx,input){const connection=(await config.cognition(subjectIdOf(ctx))).nous;if(!connection)return undefined;if(!connection.workerHost)problem('capability_unavailable','A Nous-bound Task requires its own Worker Host credential',503);
    const hostCtx={...ctx,purpose:'worker',audience:[subjectIdOf(ctx)],trace:{...ctx.trace,operationId:`${ctx.trace.operationId}/cognition-binding`}};
    return withClient(DelegationsApi,hostCtx,async(client,identity,baseURL)=>{
     if(identity.actor.kind!=='service'||!identity.actor.authorityRef.startsWith('delegation:'))problem('forbidden','Nous Worker Host must be a registered service delegation',403);
     const parent=await client.delegationsRead({id:identity.actor.authorityRef.slice(11)}) as ServiceDelegation;
     if(!parent.scope.mayDelegate||workerOperations.some(operation=>!parent.scope.operations.includes(operation)))problem('forbidden','Nous Worker Host lacks the explicit cognitive delegation upper bound',403);
     let expiresAt=input.scope.expiresAt;if(!expiresAt)problem('invalid_input','Task Worker authority must have a real expiry');if(parent.scope.expiresAt&&parent.scope.expiresAt.at<expiresAt.at)expiresAt=parent.scope.expiresAt;
     const scope:DelegationScope={plane:'subject',operations:[...workerOperations],subjectIds:[subjectIdOf(ctx)],consumer:input.scope.consumer,purposes:['worker'],audiences:[subjectIdOf(ctx)],targets:[],inputRefs:input.scope.inputRefs,taskRef:input.taskRef,nativeBinding:input.scope.nativeBinding,expiresAt,mayDelegate:false};
     const child=await client.delegationsCreateChild({delegationChildCreateBodyInput:{name:`Hept Task ${input.taskRef.id}`,scope,principalKind:'worker'}});DelegationScopeSchema.parse(child.scope);
     if(!sameConsumer(child.scope.consumer,input.scope.consumer)||digest(child.scope.taskRef)!==digest(input.taskRef))problem('forbidden','Nous returned a different Task Worker binding',403);
     return {delegationId:child.delegationId,authorityRef:child.authorityRef,revision:child.revision,consumer:child.scope.consumer,parentAuthorityRef:identity.actor.authorityRef,baseURL};
    },'workerHost');
   },
   async revoke(ctx,binding){const hostCtx={...ctx,purpose:'worker',audience:[subjectIdOf(ctx)]};await withClient(DelegationsApi,hostCtx,async(client,identity,baseURL)=>{if(baseURL!==binding.baseURL||identity.actor.authorityRef!==binding.parentAuthorityRef)problem('forbidden','Task authority belongs to a different Nous Worker Host',403);const child=await client.delegationsRead({id:binding.delegationId}) as ServiceDelegation;if(child.state!=='revoked')await client.delegationsRevoke({id:binding.delegationId,secretsRevokeRequest:{expectedRevision:child.revision}});},'workerHost');},
  },
  validateSources:(ctx,refs)=>withClient(SourcesApi,ctx,async client=>{await client.sourcesResolve({subjectId:subjectIdOf(ctx),sourcesResolveBodyInput:{refs:[...refs]}});}),
  prepare:(ctx,input)=>withClient(ContextsApi,ctx,(client,identity)=>client.contextsPrepare({subjectId:subjectIdOf(ctx),contextPrepareInput:ContextPrepareSchema.parse({...input,consumer:identity.consumer})}).then(value=>ContextViewSchema.parse(value))),
  readContextView:(ctx,ref)=>withClient(ContextsApi,ctx,async client=>{if(ref.product!=='nous'||ref.subjectId!==subjectIdOf(ctx)||ref.kind!=='ContextView'||ref.selector)problem('invalid_input','Expected the saved Nous context view for this Subject');const view=ContextViewSchema.parse(await client.contextsReadView({subjectId:subjectIdOf(ctx),id:ref.id}));if(view.ref.installationId!==ref.installationId||view.ref.id!==ref.id||ref.revision!==undefined&&view.ref.revision!==ref.revision)problem('conflict','Saved context view identity differs from its original authority',409);return view;}),
  capture:(ctx,input)=>withClient(MaterialsApi,ctx,client=>client.materialsCapture({subjectId:subjectIdOf(ctx),materialCaptureInput:MaterialCaptureSchema.parse(input)}).then(value=>MaterialViewSchema.parse(value))),
  publish:(ctx,ref)=>withClient(MaterialsApi,ctx,async client=>{if(ref.product!=='nous'||ref.kind!=='Material'||ref.subjectId!==subjectIdOf(ctx)||ref.revision===undefined||!ref.selector)problem('invalid_input','Task publication requires an original selected Nous Material region');const view=MaterialViewSchema.parse(await client.materialsPublish({subjectId:subjectIdOf(ctx),materialPublishInput:{ref}}));if(view.scope.kind!=='subject'||view.scope.id!==subjectIdOf(ctx)||!view.source.inputs.some(source=>sameRef(source,ref)))problem('conflict','Publication does not preserve the selected Task output source',409);return view;}),
  read:(ctx,ref)=>withClient(MaterialsApi,ctx,async client=>{if(ref.product!=='nous'||ref.kind!=='Material'||ref.subjectId!==subjectIdOf(ctx)||ref.revision===undefined)problem('invalid_input','Expected a fixed Nous Material reference');const view=MaterialViewSchema.parse(await client.materialsRead({subjectId:subjectIdOf(ctx),id:ref.id,revision:ref.revision,selector:ref.selector}));if(!sameRef(view.ref,ref))problem('conflict','Material read differs from the saved publication reference',409);return view;}),
  uploadBlob:(ctx,bytes,mediaType)=>withClient(MaterialsApi,ctx,client=>client.materialsUploadBlob({subjectId:subjectIdOf(ctx),body:bytes instanceof Uint8Array?new Blob([Uint8Array.from(bytes)],{type:mediaType}):bytes},async({init})=>{const headers=new Headers(init.headers);headers.set('x-content-media-type',mediaType);return {...init,headers,...(bytes instanceof ReadableStream?{duplex:'half' as const}:{})};}).then(value=>BlobResultSchema.parse(value))),
  accept:(ctx,input)=>withClient(EncountersApi,ctx,(client,identity)=>client.encountersAccept({subjectId:subjectIdOf(ctx),encounterAcceptInput:EncounterAcceptSchema.parse({...input as object,consumer:identity.consumer})})),
  growth:(ctx,input)=>withClient(GrowthApi,ctx,client=>client.growthRun({subjectId:subjectIdOf(ctx),growthRunRequest:input})),
 };
}
