import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {createServer} from 'node:net';

const cwd=new URL('../',import.meta.url);
const require=createRequire(import.meta.url);
const probe=createServer();
const port=await new Promise((resolve,reject)=>probe.listen(0,'127.0.0.1',()=>{const address=probe.address();probe.close(()=>resolve(address.port));}).once('error',reject));
const baseURL=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[join(dirname(require.resolve('vite/package.json')),'bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd,stdio:'inherit',windowsHide:true});
async function waitForServer(){for(let attempt=0;attempt<90;attempt++){if(server.exitCode!==null)throw new Error('Vite exited before E2E started.');try{const response=await fetch(baseURL);if(response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}throw new Error('Timed out waiting for Vite.');}
try{
 await waitForServer();
 const tests=spawn(process.execPath,[join(dirname(require.resolve('@playwright/test/package.json')),'cli.js'),'test'],{cwd,stdio:'inherit',windowsHide:true,env:{...process.env,E2E_BASE_URL:baseURL}});
 process.exitCode=await new Promise(resolve=>tests.once('exit',code=>resolve(code??1)));
}finally{
 server.kill();
 await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,3000);});
}
