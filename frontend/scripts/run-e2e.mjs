import {spawn} from 'node:child_process';

const cwd=new URL('../',import.meta.url);
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{cwd,stdio:'inherit',windowsHide:true});
async function waitForServer(){for(let attempt=0;attempt<90;attempt++){if(server.exitCode!==null)throw new Error('Vite exited before E2E started.');try{const response=await fetch('http://127.0.0.1:5173');if(response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}throw new Error('Timed out waiting for Vite.');}
try{
 await waitForServer();
 const tests=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test'],{cwd,stdio:'inherit',windowsHide:true});
 process.exitCode=await new Promise(resolve=>tests.once('exit',code=>resolve(code??1)));
}finally{
 server.kill();
 await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,3000);});
}
