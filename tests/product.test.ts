import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {createServer} from 'node:http';
import {deserialize} from 'node:v8';
import { v7 } from 'uuid';
import {createBootstrap} from '@nous-wave/platform/bootstrap';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createHept } from '@heptalogos/hept';
import {managementScope} from '@heptalogos/hept/authorization';
import {parseInstant} from '@nous-wave/platform/time';
import {callContext} from '@heptalogos/hept/runtime';
import {createHttp} from '@heptalogos/server/http';
test('local product: authenticated receive, source identity, complete parts and physical receipt survive reads',{skip:!process.env.HEPT_TEST_DATABASE_URL},async()=>{
 const tempRoot=resolve(process.env.HEPT_TEST_TEMP_ROOT??'../temp/hept-product-test');await mkdir(tempRoot,{recursive:true});const instanceHome=await mkdtemp(join(tempRoot,'instance-'));
 const bootstrap=await createBootstrap({product:'hept',programRoot:process.cwd(),instanceHome}).init();
 const app=await createHept({bootstrap,databaseURL:process.env.HEPT_TEST_DATABASE_URL!,authSecret:randomBytes(48)});
 await app.host.start();
 const server=await createHttp(app);try{
  const user=await app.authentication.bootstrapAdministrator({email:`hept-${v7()}@example.test`,password:randomBytes(24).toString('hex'),name:'Integration administrator'});
  const key=await app.authentication.createManagementKey(user.userId,{name:'Product regression',scope:{...managementScope(bootstrap.bootstrap.installationId),expiresAt:{domainId:'real',at:parseInstant(new Date(Date.now()+3600000).toISOString())}}});
  const headers={authorization:`Bearer ${key.key}`};const identity=await app.authentication.authenticate(new Headers(headers));const actor=identity.actor;
  const forbidden=await server.inject({method:'GET',url:'/v1/subjects'});assert.equal(forbidden.statusCode,403);
  const created=await server.inject({method:'POST',url:'/v1/subjects',headers,payload:{displayName:'产品轨迹',clientSubmissionId:v7()}});assert.equal(created.statusCode,200,created.body);const subject=created.json();const ctx=callContext({...identity,subjectId:subject.id,purpose:'deliberation'});
  const body={clientSubmissionId:v7(),conversationKey:'local:regression',channelAccount:'local',platformMessageId:v7(),authorId:actor.id,parts:[{partId:v7(),kind:'text',text:'原始顺序与作者'}, {partId:v7(),kind:'forward',nodes:[{nodeId:'node-1',authorId:'original-author',parts:[{partId:v7(),kind:'text',text:'转发正文'}]}]}]};
  const received=await server.inject({method:'POST',url:`/v1/subjects/${subject.id}/messages`,headers,payload:body});assert.equal(received.statusCode,200,received.body);const operation=received.json();const message=await DBOS.retrieveWorkflow<any>(operation.operationId).getResult();assert.equal(message.parts[1].nodes[0].authorId,'original-author');
  const duplicate=await app.receive(ctx,body);assert.equal(duplicate.operationId,operation.operationId);
  await assert.rejects(()=>app.receive(ctx,{...body,parts:[{partId:'changed',kind:'text',text:'different original source'}]}),/different input/);
  const conversation=await server.inject({method:'GET',url:`/v1/subjects/${subject.id}/conversations/${message.conversationId}`,headers});assert.equal(conversation.statusCode,200);assert.equal(conversation.json().messages.length,1);
  const expression=await app.communication.createExpression(app.db,ctx,{intent:{conversationId:message.conversationId,audience:['local:regression'],purpose:'test'},parts:[{partId:v7(),kind:'text',text:'本地实际回复'}]});
  const delivery=await app.communication.dispatch(ctx,expression.id);assert.equal(delivery.parts.length,1);assert.equal(delivery.parts[0].status,'accepted');assert.ok(delivery.parts[0].platformMessageId);const actualLocalMessage=await app.communication.readMessage(ctx,delivery.parts[0].platformMessageId as string);assert.equal(actualLocalMessage.platformMessageId,delivery.parts[0].platformMessageId);
  const repeated=await app.communication.dispatch(ctx,expression.id);assert.equal(repeated.parts[0].platformMessageId,delivery.parts[0].platformMessageId);const after=await app.communication.conversation(ctx,message.conversationId);assert.equal(after.messages.length,2);
  const edit={source:{channelAccount:'local',conversationKey:body.conversationKey,platformMessageId:body.platformMessageId},kind:'edit',sourceEventId:v7(),parts:[{partId:v7(),kind:'text',text:'编辑后的正文'}]};const changed=await app.communication.change(ctx,edit) as any;assert.equal(changed.revision,2);assert.equal((await app.communication.readMessage(ctx,message.id,1)).parts instanceof Array,true);assert.equal(((await app.communication.readMessage(ctx,message.id,1)).parts as any[])[0].text,'原始顺序与作者');assert.equal((await app.communication.change(ctx,edit) as any).revision,2);
  const mediaKey=v7(),mediaBytes=Buffer.from('streamed-content');const mediaUpload=()=>server.inject({method:'POST',url:`/v1/subjects/${subject.id}/media`,headers:{...headers,'content-type':'application/octet-stream','x-media-type':'text/plain','x-filename':'fixture.txt','idempotency-key':mediaKey},payload:mediaBytes});const media1=await mediaUpload(),media2=await mediaUpload();assert.equal(media1.statusCode,200,media1.body);assert.equal(media2.statusCode,200,media2.body);assert.equal(media1.json().ref.id,media2.json().ref.id);const preserved=await app.communication.media(ctx,media1.json().ref.id);assert.equal(Buffer.from(preserved.bytes).toString(),'streamed-content');
  const controlToken=randomBytes(24).toString('hex'),control=createServer((request,response)=>{assert.equal(request.headers.authorization,`Bearer ${controlToken}`);response.setHeader('content-type','application/json');response.end(JSON.stringify(request.url==='/v1/accounts'?{accounts:[{adapterId:'astrbot:qq',accountId:'qq:456',subjectId:subject.id,conversations:['group:123']}]}:request.url==='/v1/capabilities'?{physicalReceipts:true}:{range:{complete:false,received:0,reason:'platform_window'}}));});
  await new Promise<void>(resolve=>control.listen(0,'127.0.0.1',resolve));
  try{
   const address=control.address();assert.ok(address&&typeof address==='object');const configuration={host:'astrbot',adapterId:'astrbot:qq',accountId:'qq:456',conversationKeys:['group:123','group:456'],endpoint:`http://127.0.0.1:${address.port}`,network:{profileId:'default',addressScope:'configured_private',allowedPrivateRanges:['127.0.0.0/8']}};
   const channel=await app.communication.configureChannel(ctx,{...configuration,expectedRevision:0}),channelRef={product:'hept' as const,installationId:bootstrap.bootstrap.installationId,subjectId:subject.id,kind:'Channel',id:channel.id};assert.equal((channel.connection as any).state,'configured');
   const credential=await app.secrets.create({...ctx,trace:{...ctx.trace,operationId:'channel-control-secret'}},{purpose:'channel.control',resourceRef:channelRef,allowedConsumers:[ctx.consumer],backend:{kind:'protected_file',material:Buffer.from(controlToken)}});
   const configured=await app.communication.configureChannel(ctx,{...configuration,id:channel.id,expectedRevision:channel.revision,credentialRef:credential.ref}),connected=await app.communication.connectChannel(ctx,channel.id);assert.equal((connected.connection as any).state,'connected');assert.equal(configured.revision,2);
   const grant=await app.authentication.delegations.create(ctx,{name:'Scoped channel ingress',principalKind:'service',scope:{plane:'system',operations:['messages.receive'],subjectIds:[subject.id],consumer:ctx.consumer,purposes:['ingress'],audiences:[subject.id],targets:[{kind:'conversation',adapterId:'astrbot:qq',accountId:'qq:456',conversationId:'group:123',actions:['messages.receive']}],inputRefs:[],expiresAt:{domainId:'real',at:parseInstant(new Date(Date.now()+600000).toISOString())},mayDelegate:false}}),ingress={authorization:`Bearer ${grant.key}`,'x-purpose':'ingress'};
   const incoming={...body,channelAccount:'qq:456',conversationKey:'group:123',authorId:'789',platformMessageId:v7()};
   const accepted=await server.inject({method:'POST',url:`/v1/subjects/${subject.id}/messages`,headers:ingress,payload:incoming});assert.equal(accepted.statusCode,200,accepted.body);assert.equal((await DBOS.retrieveWorkflow<any>(accepted.json().operationId).getResult()).authorId,'789');
   const denied=await server.inject({method:'POST',url:`/v1/subjects/${subject.id}/messages`,headers:ingress,payload:{...incoming,conversationKey:'group:456',platformMessageId:v7()}});assert.equal(denied.statusCode,403);
   const localEdit=await server.inject({method:'POST',url:`/v1/subjects/${subject.id}/message-changes`,headers:ingress,payload:{messageId:message.id,kind:'retract',sourceEventId:v7()}});assert.equal(localEdit.statusCode,403);
   const missingSource=await server.inject({method:'POST',url:`/v1/subjects/${subject.id}/media`,headers:{...ingress,'content-type':'application/octet-stream'},payload:Buffer.from('unscoped')});assert.equal(missingSource.statusCode,403);
   const scopedMedia=await server.inject({method:'POST',url:`/v1/subjects/${subject.id}/media?channelAccount=qq%3A456&conversationKey=group%3A123`,headers:{...ingress,'content-type':'application/octet-stream'},payload:Buffer.from('source-bound media')});assert.equal(scopedMedia.statusCode,200,scopedMedia.body);
   await app.communication.configureChannel(ctx,{...configuration,id:channel.id,expectedRevision:connected.revision,credentialRef:credential.ref,receive:false});
   const disabled=await server.inject({method:'POST',url:`/v1/subjects/${subject.id}/messages`,headers:ingress,payload:{...incoming,platformMessageId:v7()}});assert.equal(disabled.statusCode,403);
  }finally{await new Promise<void>((resolve,reject)=>control.close(error=>error?reject(error):resolve()));}
  const view=await app.agency.explain(ctx,message.conversationId);assert.equal(view.runtime,'stopped');
  let physicalCalls=0;const providerToken=randomBytes(24).toString('hex');
  const provider=createServer(async(request,response)=>{let raw='';for await(const part of request)raw+=part;const input=JSON.parse(raw);assert.equal(request.headers.authorization,`Bearer ${providerToken}`);assert.equal(input.model,'local-language');physicalCalls++;response.setHeader('content-type','application/json');response.end(JSON.stringify({id:`chat-${physicalCalls}`,object:'chat.completion',created:Math.floor(Date.now()/1000),model:'local-language',choices:[{index:0,message:{role:'assistant',content:'正式模型链已回执'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:7,total_tokens:19}}));});
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  try{
   const endpoint=provider.address();assert.ok(endpoint&&typeof endpoint==='object');
   const phase=(name:string)=>({...ctx,trace:{...ctx.trace,operationId:`product:${subject.id}/${name}`}});
   const providerRef={product:'hept' as const,installationId:bootstrap.bootstrap.installationId,kind:'Provider',id:'local-provider'};
   const credential=await app.secrets.create(ctx,{purpose:'model.provider',resourceRef:providerRef,allowedConsumers:[ctx.consumer],backend:{kind:'protected_file',material:Buffer.from(providerToken)}});
   await app.models.providers.create(phase('provider'),{expectedRevision:0,definition:{id:'local-provider',adapter:'openai-compatible',baseURL:`http://127.0.0.1:${endpoint.port}/v1`,credentialRef:credential.ref,networkProfileId:'default',options:{addressScope:'configured_private',allowedPrivateRanges:['127.0.0.0/8']},enabled:true}});
   await app.models.resources.create(phase('resource'),{expectedRevision:0,definition:{managedBy:'sdk',definition:{id:'local-language',label:'实际HTTP语言协议',providerId:'local-provider',modelId:'local-language',kind:'language',enabled:true,capabilities:['text'],contextLimit:4096,outputLimit:1024,providerOptions:{}}}});
   const resource=(await app.models.resources.read(ctx,{id:'local-language'})).ref;
   await app.settings.update(phase('role'),{namespace:'platform.roles',scope:{kind:'installation',installationId:bootstrap.bootstrap.installationId},expectedRevision:0,patch:[{op:'add',path:'/roles',value:{expression:{kind:'language',enabled:true,resources:[resource],selection:'ordered',timeoutMs:5000,prompt:{promptId:'hept.expression',locale:'zh-CN'},inference:{maxOutputTokens:64,providerOptions:{}}}}}]});
   const modelCtx={...ctx,trace:{...ctx.trace,operationId:v7()}},input={roleId:'expression',prompt:'确认已经收到这一条实际HTTP请求。',promptParams:{structured:false},resource,maxOutputTokens:64};
   const started=await app.testModel(modelCtx,input),result=await DBOS.retrieveWorkflow<{text:string}>(started.operationId).getResult();assert.equal(result.text,'正式模型链已回执');assert.equal(physicalCalls,1);
   assert.equal((await app.testModel(modelCtx,input)).operationId,started.operationId);assert.equal(physicalCalls,1);
   const calls=await app.models.invocations.list(ctx,{logicalOperationId:modelCtx.trace.operationId});assert.equal(calls.items.length,1);const call=calls.items[0]!;assert.equal(call.status,'completed');assert.equal(call.actualCost,null);assert.equal(call.usage?.inputTokens,12);assert.ok(call.observed&&call.formed);assert.match(call.formed.point.at,/\.\d{6}Z$/);
   const bundle=await app.data.export(ctx),preview=await app.data.preview(ctx,bundle),artifact=preview.files[`model-artifacts/${call.identity.invocationId}/output`];assert.ok(artifact);const typed=deserialize(Buffer.from(artifact));assert.ok(typed.response.timestamp instanceof Date);
   assert.equal((await app.data.purge(ctx)).status,'removed');await app.data.import(ctx,bundle);assert.equal((await app.identity.read(ctx)).runtime,'paused');assert.equal((await app.models.invocations.read(ctx,{invocationId:call.identity.invocationId})).status,'completed');
   const restored=await app.testModel(modelCtx,input);assert.equal((await DBOS.retrieveWorkflow<{text:string}>(restored.operationId).getResult()).text,'正式模型链已回执');assert.equal(physicalCalls,1);
  }finally{await new Promise<void>((resolve,reject)=>provider.close(error=>error?reject(error):resolve()));}

  const openapi=server.swagger();assert.equal((openapi as any).openapi,'3.0.3');assert.ok((openapi as any).components.schemas.HeptMessagePartInput);
 }finally{await server.close();await app.close();}
});
