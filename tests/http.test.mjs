import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('production HTTP server serves assets and protects dashboard writes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cloudpulse-http-'));
 writeFileSync(join(dir,'index.html'),'<!doctype html><title>CloudPulse</title><div id="root"></div>');
 writeFileSync(join(dir,'asset.css'),'body { color: white; }');
 const password='verification-password-123456789';
 const child=spawn(process.execPath,['aws/server.mjs'],{env:{...process.env,PORT:'0',NODE_ENV:'production',DASHBOARD_TOKEN:password,STORAGE:'sqlite',SQLITE_PATH:join(dir,'state.db'),PUBLIC_DIR:dir,CHECK_INTERVAL_SECONDS:'0'},stdio:['ignore','pipe','pipe']});
 try {
  const port=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Server startup timed out')),8000);child.once('exit',c=>{clearTimeout(timer);reject(new Error(`Server exited ${c}`))});child.stdout.on('data',b=>{output+=b.toString();if(output.includes('\n')){clearTimeout(timer);resolve(JSON.parse(output.split('\n')[0]).port)}});});
  const base=`http://127.0.0.1:${port}`,auth={Authorization:'Basic '+Buffer.from('ganesh:'+password).toString('base64')};
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/')).status,401);
  assert.equal((await fetch(base+'/api/dashboard')).status,401);
  const index=await fetch(base+'/',{headers:auth});assert.equal(index.status,200);assert.ok((await index.text()).includes('<title>CloudPulse</title>'));
  const asset=await fetch(base+'/asset.css',{headers:auth});assert.equal(asset.status,200);assert.ok(asset.headers.get('content-type').includes('text/css'));
  const data=await fetch(base+'/api/dashboard',{headers:auth});assert.equal(data.status,200);assert.equal((await data.json()).services.length,4);
  const checks=await fetch(base+'/api/checks',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:'{}'});assert.equal(checks.status,200);assert.equal((await checks.json()).checks.length,4);
  const cross=await fetch(base+'/api/checks',{method:'POST',headers:{...auth,'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'});assert.equal(cross.status,403);
 } finally {const exited=once(child,'exit');child.kill('SIGTERM');await exited;rmSync(dir,{recursive:true,force:true});}
});
