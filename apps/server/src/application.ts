import { createHept,type Hept } from '@heptalogos/hept';
import {withBootstrapDatabase,type BootstrapView } from '@nous-wave/platform/bootstrap';
import { createBootstrapSecrets } from '@nous-wave/platform/credentials';

/** Keep protected bootstrap bytes inside the actual application use period. */
export async function withHept<T>(view:BootstrapView,use:(app:Hept)=>Promise<T>,mode:'cli'|'service'='cli'):Promise<T>{
 const secrets=createBootstrapSecrets(view.paths.secret);
 return withBootstrapDatabase(view,databaseURL=>
  secrets.withSecret('auth-signing',{purpose:'auth.signing'},async authSecret=>{
   const app=await createHept({bootstrap:view,mode,databaseURL,authSecret});
   try{return await use(app);}finally{await app.close();}
  }));
}
