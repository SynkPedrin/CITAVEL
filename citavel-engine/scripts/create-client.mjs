import {createClient} from '../core/store.mjs';
try{const id=process.argv[2];await createClient(id);console.log('Cliente criado: clients/'+id+'/config/client.json. Preencha brand, domain, market e locations.');}catch(e){console.error(e.message);process.exitCode=1;}
