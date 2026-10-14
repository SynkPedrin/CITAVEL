import { syncEngineClient } from '../lib/sync';const result=await syncEngineClient(process.argv[2]||'cosentino');console.log(JSON.stringify(result,null,2));
