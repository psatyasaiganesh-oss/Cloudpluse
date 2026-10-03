import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleApi, validateTarget } from '../core/api.ts';
import { sqliteStore } from '../aws/sqlite-store.mjs';
const request=(path,body,method='POST',extra={})=>new Request(`https://cloudpulse.test/api/${path}`,body===undefined?{headers:extra}:{method,headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
const invoke=async(store,path,body,method='POST',extra={})=>{const response=await handleApi(request(path,body,method,extra),store);return {status:response.status,data:await response.json()};};

test('seed is persistent and idempotent; health readiness is measured',async()=>{
 const s=sqliteStore(':memory:');try{
  const a=await invoke(s,'dashboard');assert.equal(a.status,200);assert.equal(a.data.services.length,4);assert.equal(a.data.stats.checks,108);
  await invoke(s,'checks',{});const b=await invoke(s,'dashboard');assert.equal(b.data.services.length,4);assert.equal(b.data.stats.checks,112);
  const health=b.data.services.find(x=>x.id==='svc-health');assert.equal(health.status,'healthy');assert.equal(health.checks[0].simulated,false);
  assert.equal((await invoke(s,'health')).data.database,'ready');
 }finally{s.close()}
});
test('outage opens one incident; acknowledgement and recovery preserve timeline',async()=>{
 const s=sqliteStore(':memory:');try{
  await invoke(s,'dashboard');assert.equal((await invoke(s,'services/svc-api',{demoState:'down'},'PATCH')).status,200);
  await invoke(s,'checks',{});await invoke(s,'checks',{});let d=(await invoke(s,'dashboard')).data;
  const open=d.incidents.filter(i=>i.serviceId==='svc-api'&&i.status!=='resolved');assert.equal(open.length,1);assert.equal(open[0].severity,'critical');
  assert.equal((await invoke(s,`incidents/${open[0].id}`,{status:'acknowledged',note:'Investigating timeout'},'PATCH')).status,200);
  await invoke(s,'services/svc-api',{demoState:'healthy'},'PATCH');await invoke(s,'checks',{});
  d=(await invoke(s,'dashboard')).data;const resolved=d.incidents.find(i=>i.id===open[0].id);assert.equal(resolved.status,'resolved');assert.ok(resolved.notes.some(n=>n.text.includes('Investigating timeout')));assert.ok(resolved.resolvedAt);
  assert.equal((await invoke(s,`incidents/${open[0].id}`,{status:'acknowledged'},'PATCH')).status,409);
 }finally{s.close()}
});
test('manual reporting, acknowledgement, resolution, and monitor pause work',async()=>{
 const s=sqliteStore(':memory:');try{
  await invoke(s,'dashboard');const created=await invoke(s,'services',{name:'Billing worker',mode:'demo',region:'ap-south-1',group:'Worker'});assert.equal(created.status,201);const id=created.data.service.id;
  await invoke(s,`services/${id}`,{paused:true},'PATCH');const checks=await invoke(s,'checks',{});assert.ok(checks.data.checks.every(c=>c.serviceId!==id));
  await invoke(s,`services/${id}`,{paused:false},'PATCH');assert.ok((await invoke(s,'checks',{})).data.checks.some(c=>c.serviceId===id));
  const incident=await invoke(s,'incidents',{title:'Billing queue delayed',description:'Queue age exceeded threshold.',serviceId:id,severity:'warning'});assert.equal(incident.status,201);
  const iid=incident.data.incident.id;await invoke(s,`incidents/${iid}`,{status:'acknowledged'},'PATCH');await invoke(s,`incidents/${iid}`,{status:'resolved',note:'Retry succeeded'},'PATCH');
  assert.equal((await invoke(s,'dashboard')).data.incidents.find(i=>i.id===iid).status,'resolved');
 }finally{s.close()}
});
test('invalid writes, cross-origin writes, and untrusted targets are rejected',async()=>{
 const s=sqliteStore(':memory:');try{
  assert.equal((await invoke(s,'services',{name:'x',mode:'http',target:'http://169.254.169.254/'})).status,400);
  assert.equal((await invoke(s,'services/svc-api',{demoState:'invalid'},'PATCH')).status,400);
  assert.equal((await invoke(s,'checks',{},'POST',{origin:'https://evil.test'})).status,403);
  assert.equal((await invoke(s,'incidents',{title:'x',description:'x',serviceId:'missing',severity:'warning'})).status,404);
  for(const target of ['https://127.0.0.1/','http://example.com/','https://example.com:8080/','https://user:pass@example.com/','https://unapproved.test/'])assert.throws(()=>validateTarget(target,['example.com']));
  assert.equal(validateTarget('https://example.com/health',['example.com']),'https://example.com/health');
 }finally{s.close()}
});
test('file-backed state survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cloudpulse-test-')),file=join(dir,'state.db');let s=sqliteStore(file);
 try{await invoke(s,'dashboard');await invoke(s,'services/svc-web',{paused:true},'PATCH');s.close();s=sqliteStore(file);const d=(await invoke(s,'dashboard')).data;assert.equal(d.services.find(x=>x.id==='svc-web').paused,true);assert.equal(d.services.length,4);}finally{s.close();rmSync(dir,{recursive:true,force:true})}
});
test('persistent leases stop overlapping probe batches and protect owner release',async()=>{
 const s=sqliteStore(':memory:');try{
  await invoke(s,'dashboard');assert.equal(await s.acquireLease('probe-batch','first',60),true);assert.equal(await s.acquireLease('probe-batch','second',60),false);
  assert.equal((await invoke(s,'checks',{})).status,409);await s.releaseLease('probe-batch','second');assert.equal((await invoke(s,'checks',{})).status,409);
  await s.releaseLease('probe-batch','first');assert.equal((await invoke(s,'checks',{})).status,200);
 }finally{s.close()}
});
