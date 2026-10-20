import type { ReceiveMessage,TaskRequest } from '@heptalogos/contracts';
export class HeptClient {
 constructor(readonly options:{baseURL:string;apiKey:string;traceparent?:string}){}
 async request<T=unknown>(method:string,path:string,body?:unknown):Promise<T>{const response=await fetch(`${this.options.baseURL.replace(/\/$/,'')}${path}`,{method,headers:{authorization:`Bearer ${this.options.apiKey}`,...(body?{'content-type':'application/json'}:{}),...(this.options.traceparent?{traceparent:this.options.traceparent}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.detail??result.title),result);return result as T;}
 subjects={create:(input:unknown)=>this.request('POST','/v1/subjects',input),list:()=>this.request('GET','/v1/subjects'),read:(subjectId:string)=>this.request('GET',`/v1/subjects/${subjectId}`),start:(subjectId:string)=>this.request('POST',`/v1/subjects/${subjectId}/runtime/start`,{}),pause:(subjectId:string)=>this.request('POST',`/v1/subjects/${subjectId}/runtime/pause`,{})};
 messages={receive:(subjectId:string,input:ReceiveMessage)=>this.request('POST',`/v1/subjects/${subjectId}/messages`,input)};
 conversations={list:(subjectId:string)=>this.request('GET',`/v1/subjects/${subjectId}/conversations`),read:(subjectId:string,id:string)=>this.request('GET',`/v1/subjects/${subjectId}/conversations/${id}`)};
 tasks={start:(subjectId:string,input:TaskRequest)=>this.request('POST',`/v1/subjects/${subjectId}/tasks`,input),inspect:(subjectId:string,id:string)=>this.request('GET',`/v1/subjects/${subjectId}/tasks/${id}`)};
 async wait(operationId:string,timeoutMs=60000){const until=Date.now()+timeoutMs;while(Date.now()<until){const operation=await this.request<any>('GET',`/v1/operations/${encodeURIComponent(operationId)}`);if(['completed','failed','cancelled'].includes(operation.status))return operation;await new Promise(resolve=>setTimeout(resolve,300));}throw new Error('Operation is still running');}
}

export * as generated from './generated/index.js';
