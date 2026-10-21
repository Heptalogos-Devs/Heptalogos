import {subjectIdOf} from '../platform/runtime.js';
import {SignJWT,jwtVerify} from 'jose';
import type {CallContext,Policy} from '@nous-wave/contracts/common';
import type {MessagePart} from '@heptalogos/contracts';
import {problem} from '../platform/runtime.js';
export function partsMedia(parts:MessagePart[]):Extract<MessagePart,{materialRef?:unknown}>[]{return parts.flatMap(part=>part.kind==='forward'?part.nodes.flatMap(node=>partsMedia(node.parts)):'materialRef'in part?[part]:[]);}
export function permits(policy:Policy,ctx:CallContext){return policy.readers.some(r=>r==='*'||r===subjectIdOf(ctx)||r===ctx.actor.id)&&policy.purposes.some(p=>p==='*'||p===ctx.purpose)&&ctx.audience.every(a=>policy.audiences.includes('*')||policy.audiences.includes(a));}
export function mediaTickets(installationId:string,withSecret:<T>(use:(secret:Uint8Array)=>Promise<T>)=>Promise<T>){return {
 async issue(input:{subjectId:string;mediaId:string;expressionId:string;audience:string;operator:boolean;policyRevision:number}){return withSecret(secret=>new SignJWT(input).setProtectedHeader({alg:'HS256'}).setIssuer(installationId).setAudience('hept-media-delivery').setIssuedAt().setExpirationTime('2m').sign(secret));},
 async verify(ticket:string,subjectId:string,mediaId:string){try{const {payload}=await withSecret(secret=>jwtVerify(ticket,secret,{issuer:installationId,audience:'hept-media-delivery',algorithms:['HS256']}));if(payload.subjectId!==subjectId||payload.mediaId!==mediaId)problem('forbidden','Media ticket scope differs',403);return payload as unknown as {subjectId:string;mediaId:string;expressionId:string;audience:string;operator:boolean;policyRevision:number};}catch{problem('forbidden','Invalid or expired media ticket',403);}}
 };}
