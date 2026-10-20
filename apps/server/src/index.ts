import { createHept } from '@heptalogos/hept';
import { loadBootstrap } from '../../../packages/hept/src/platform/bootstrap.js';
import { createHttp } from './http.js';
const bootstrap=await loadBootstrap();
const app=await createHept({bootstrap});const http=await createHttp(app);
await http.listen({host:bootstrap.host,port:bootstrap.port});
await app.reconcileChannels();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await http.close();await app.close();process.exit(0);});
