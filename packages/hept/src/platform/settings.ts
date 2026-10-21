import {createSettings,type SettingsModule,type ConfigScope,type FieldMetadata,type SettingsDatabase} from '@nous-wave/platform/settings';
import {cognitionSettings,executionSettings,attentionSettings,communicationSettings,worldSettings,type CognitionSettings,type ExecutionSettings,type AttentionSettings,type CommunicationSettings,type WorldSettings} from '@heptalogos/contracts';
import type {Kysely} from '@nous-wave/platform/storage';
import type {Database} from './database.js';
import type {Authorization} from './runtime.js';
import {problem} from './runtime.js';
const all:ConfigScope['kind'][]=['installation','subject','role'],subject:ConfigScope['kind'][]=['installation','subject'];
const field=(id:string,scopes:ConfigScope['kind'][],consumers:string[],restriction?:FieldMetadata['restriction']):FieldMetadata=>({labelKey:`hept.${id}.label`,descriptionKey:`hept.${id}.description`,scopes,consumerIds:consumers,visibility:'standard',effect:'next_call',...(restriction?{restriction}:{})});
export const productSettingsModules:SettingsModule[]=[
 {id:'hept.cognition',definitionRevision:'1',owner:'hept.cognition',schema:cognitionSettings,defaults:{},fields:{'/nous':field('cognition.nous',subject,['cognition'])}},
 {id:'hept.execution',definitionRevision:'1',owner:'hept.work',schema:executionSettings,defaults:{runtimes:{}},fields:{'/runtimes':field('execution.runtimes',['installation'],['execution'])}},
 {id:'hept.attention',definitionRevision:'1',owner:'hept.agency',schema:attentionSettings,defaults:{aggregationMs:1500,freeMinutes:60,dailyAutonomousCalls:12},fields:Object.fromEntries(['aggregationMs','freeMinutes','dailyAutonomousCalls'].map(key=>[`/${key}`,field(`attention.${key}`,subject,['agency','receive'])]))},
 {id:'hept.communication',definitionRevision:'1',owner:'hept.communication',schema:communicationSettings,defaults:{behavior:{receive:true,participate:true,proactive:false,allowedConversations:['*']},media:{maxBytes:52428800,dailyBytes:1073741824}},fields:{'/behavior':field('communication.behavior',subject,['agency','receive','communication']),'/media/maxBytes':field('communication.maxBytes',subject,['communication'],'upper_bound'),'/media/dailyBytes':field('communication.dailyBytes',subject,['communication'],'upper_bound')}},
 {id:'hept.world',definitionRevision:'1',owner:'hept.world',schema:worldSettings,defaults:{timezone:'Asia/Tokyo'},fields:{'/timezone':field('world.timezone',subject,['world'])}},
];
export function createProductSettings(db:Kysely<Database>,installationId:string,authorize:Authorization,processBootId:string,extraModules:SettingsModule[]=[]){
 const settings=createSettings({db:db as unknown as Kysely<SettingsDatabase>,installationId,modules:[...productSettingsModules,...extraModules],authorize:async(ctx,request,client)=>{
  if(request.scope.kind==='installation'){if(request.scope.installationId!==installationId)problem('forbidden','Settings belong to a different installation',403);}
  else if(ctx.subjectId!==request.scope.subjectId)problem('forbidden','Settings require this subject context',403);
  await authorize(ctx,`settings.${request.action}`,undefined,client as Kysely<Database>|undefined);
  if(request.namespace==='hept.cognition'&&['update','restore','import','reset'].includes(request.action)&&(!request.paths||request.paths.some(path=>path===''||path==='/nous'||path.startsWith('/nous/'))))await authorize(ctx,'installation.manage',undefined,client as Kysely<Database>|undefined);
 }});
 const registered=new Map<string,{reads:{namespace:string;scope:ConfigScope}[];consumer:ReturnType<typeof settings.registerConsumers>}>();
 const scope=(subjectId?:string,role?:string):ConfigScope=>!subjectId?{kind:'installation',installationId}:role?{kind:'role',subjectId,roleId:role}:{kind:'subject',subjectId};
 async function consume(consumerId:string,reads:{namespace:string;scope:ConfigScope}[]){const key=JSON.stringify([consumerId,reads]);let current=registered.get(key);if(!current){current={reads,consumer:settings.registerConsumers({processBootId,consumerId,reads})};registered.set(key,current);}const snapshots=await current.consumer.snapshot();current.consumer.reportApplied(snapshots);return snapshots;}
 return {settings,
  async cognition(subjectId:string){return (await consume('cognition',[{namespace:'hept.cognition',scope:scope(subjectId)}]))[0].values as CognitionSettings;},
  async execution(){return (await consume('execution',[{namespace:'hept.execution',scope:scope()}]))[0].values as ExecutionSettings;},
  async communication(subjectId:string){return (await consume('communication',[{namespace:'hept.communication',scope:scope(subjectId)}]))[0].values as CommunicationSettings;},
  async agency(subjectId:string,consumerId:'agency'|'receive'='agency'){const [communication,attention]=await consume(consumerId,[{namespace:'hept.communication',scope:scope(subjectId)},{namespace:'hept.attention',scope:scope(subjectId)}]);return {communication:communication.values as CommunicationSettings,attention:attention.values as AttentionSettings};},
  async world(subjectId:string){return (await consume('world',[{namespace:'hept.world',scope:scope(subjectId)}]))[0].values as WorldSettings;},
  closeSubject(subjectId:string){for(const [key,value]of registered)if(value.reads.some(read=>read.scope.kind!=='installation'&&read.scope.subjectId===subjectId)){value.consumer.close();registered.delete(key);}},
  close(){for(const value of registered.values())value.consumer.close();registered.clear();},
 };
}
export type ProductSettings=ReturnType<typeof createProductSettings>;
