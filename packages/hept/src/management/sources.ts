import {ProblemError} from '@nous-wave/contracts/common';
import type {Kysely} from 'kysely';
import type {CallContext,Ref,Policy} from '@nous-wave/contracts/common';
import type {Database,Table,Json} from '../platform/database.js';
import {type Authorization,read,problem} from '../platform/runtime.js';
const owned:Record<string,Table>={message:'messages',media:'media',task:'tasks',expression:'expressions',delivery:'deliveryParts',event:'realizedEvents',world:'worlds',person:'people'};
export function sourcePolicies(db:Kysely<Database>,installationId:string,authorize:Authorization){return async(ctx:CallContext,refs:Ref[])=>{
 if(refs.length>200)problem('invalid_input','A policy read accepts at most 200 references');const items=[];
 for(const ref of refs){const sid=ref.subjectId;if(ref.product!=='hept'||ref.installationId!==installationId||!sid||!owned[ref.kind]){items.push({ref,available:false,reason:'unknown_source'});continue;}await authorize({...ctx,subjectId:sid},'sources.readPolicies',ref);try{const row=await read(db,owned[ref.kind],sid,ref.id);if((ref.kind==='media'&&row.status!=='available')||(ref.kind==='message'&&row.status==='retracted')){items.push({ref,available:false,reason:'source_unavailable'});continue;}let policy=row.policy as Policy|undefined;if(!policy){const intent=row.intent as Json|undefined;const returnTarget=row.returnTarget as Json|undefined;let audiences=(intent?.audience as string[]|undefined)??['*'];if(returnTarget?.conversationId){const conversation=await read(db,'conversations',sid,returnTarget.conversationId as string);audiences=[String(conversation.key)];}policy={readers:[sid],purposes:['*'],audiences};}items.push({ref,available:true,policy,currentRevision:row.revision});}catch(error){if(!(error instanceof ProblemError)||error.problem.category!=='not_found')throw error;items.push({ref,available:false,reason:'source_unavailable'});}}
 return {items};
 };}
