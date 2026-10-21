import { createBootstrap,prepareDirectories,type BootstrapOptions } from '@nous-wave/platform/bootstrap';
import { createHttp } from './http.js';
import { withHept } from './application.js';

export { withHept } from './application.js';
export async function runHost(options:Omit<BootstrapOptions,'product'> & {onStarted?:(status:unknown)=>void}){
 const view=await createBootstrap({...options,product:'hept'}).inspect();
 await prepareDirectories(view.paths);
 await withHept(view,async app=>{
  const stopped=Promise.withResolvers<void>();
  let stopping:Promise<void>|undefined;
  const stop=(mode:'graceful'|'force'='graceful')=>stopping??=(async()=>{
   await app.host.drain();
   try{await server.close();await app.host.stop(mode);}finally{stopped.resolve();}
  })();
  const server=await createHttp(app,{stop});
  const interrupt=()=>{void stop();};
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{
   await app.host.start();
   await server.listen({host:view.bootstrap.listen.host,port:view.bootstrap.listen.port});
   options.onStarted?.(await app.host.status());
   await stopped.promise;
  }finally{
   process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
   await stop();
  }
 },'service');
}
