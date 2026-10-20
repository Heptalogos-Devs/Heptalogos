import { readFile } from 'node:fs/promises';
import { parseTOML } from 'confbox';
import path from 'node:path';
import envPaths from 'env-paths';
import { bootstrapSchema } from '@heptalogos/contracts';
export async function loadBootstrap(file?:string){
 const defaultPath=path.join(envPaths('heptalogos',{suffix:''}).config,'hept.toml');
 let values:Record<string,unknown>={};try{values=parseTOML(await readFile(file??process.env.HEPT_CONFIG??defaultPath,'utf8')) as Record<string,unknown>;}catch(error){if(file||process.env.HEPT_CONFIG)throw error;}
 for(const [env,key]of Object.entries({HEPT_DATABASE_URL:'databaseURL',HEPT_HOST:'host',HEPT_PORT:'port',HEPT_DATA_ROOT:'dataRoot',HEPT_INSTALLATION_ID:'installationId',HEPT_AUTH_SECRET_REF:'authSecretRef',HEPT_CLIENT_CREDENTIAL_REF:'clientCredentialRef'})){if(process.env[env]!==undefined)values[key]=key==='port'?Number(process.env[env]):process.env[env];}
 return bootstrapSchema.parse(values);
}
