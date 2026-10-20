import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { v7 } from 'uuid';
import { createHept } from '../packages/hept/src/index.js';
import { callContext } from '../packages/hept/src/platform/runtime.js';
process.env.HEPT_TEST_AUTH_SECRET=randomBytes(32).toString('hex');
const installationId=`hept-first-chain`,dataRoot=path.resolve('data');await mkdir(dataRoot,{recursive:true});
const app=await createHept({bootstrap:{databaseURL:process.env.HEPT_TEST_DATABASE_URL??'postgresql://rebuild@127.0.0.1:55432/hept',installationId,dataRoot,host:'127.0.0.1',port:8788,authSecretRef:'env:HEPT_TEST_AUTH_SECRET'}});
const admin={kind:'human' as const,id:'construction-test-administrator',grants:['*']};
try{
 const root=callContext('installation',admin);const subject=await app.identity.create(root,{displayName:'本地纵切面主体',roleMaterial:'你叫小波，正在和 Arsvine 交谈。你愿意阅读他的消息并自然回应，回答通常简短。',clientSubmissionId:v7()});const ctx=callContext(subject.id as string,admin);
 await app.management.registerModel(root,{id:'first-chain-mini',provider:'openai-compatible',baseURL:'http://127.0.0.1:3000/v1',modelId:'doubao-seed-2.0-mini',credentialRef:'file:model-gateway',contextLimit:32000,outputLimit:1024,capabilities:['text','structured']});
 await app.management.update(root,{scope:'installation',values:{budget:{dailyCalls:20}}});
 await app.management.update(ctx,{scope:'subject',values:{deliberationModel:'first-chain-mini',expressionModel:'first-chain-mini',budget:{dailyCalls:10}}});
 await app.identity.runtime(ctx,'start');
 const operation=await app.receive(ctx,{clientSubmissionId:v7(),conversationKey:'local:construction-test',channelAccount:'local',platformMessageId:v7(),authorId:'Arsvine',authorName:'Arsvine',parts:[{partId:v7(),kind:'text',text:'你好，我是 Arsvine。我今天在重建我们的两个产品，先来认识一下。'}]});
 const message=await DBOS.retrieveWorkflow<any>(operation.operationId).getResult();const reacted=await DBOS.retrieveWorkflow<any>(`react:${message.id}`).getResult();
 if(reacted.expressionId)await DBOS.retrieveWorkflow(`send:${reacted.expressionId}`).getResult();
 const conversation=await app.communication.conversation(ctx,message.conversationId);const costs=await app.management.costs(ctx);
 console.log(JSON.stringify({subjectId:subject.id,receiveOperationId:operation.operationId,decisionId:reacted.decisionId,expressionId:reacted.expressionId,messages:conversation.messages.map(m=>({id:m.id,direction:m.direction,parts:m.parts})),modelCalls:costs.items.map(i=>({id:i.id,role:i.role,status:i.status,usage:i.usage,costUsd:i.costUsd})),totalUsd:costs.totalUsd,unknownCosts:costs.unknown},null,2));
}finally{await app.close();}
