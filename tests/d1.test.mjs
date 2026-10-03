import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Store } from '../db/store.ts';
import { handleApi } from '../core/api.ts';

test('D1 adapter executes its migration and production prepared statements',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync('drizzle/0000_strong_stepford_cuckoos.sql','utf8'));
 const binding={
  prepare(sql){
   let args=[];
   return {
    bind(...a){args=a;return this;},
    async first(){return db.prepare(sql).get(...args)??null;},
    async all(){return {results:db.prepare(sql).all(...args)};},
    async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};},
   };
  },
 };
 try{
  const store=d1Store(binding);
  const get=await handleApi(new Request('https://cloudpulse.test/api/dashboard'),store);
  assert.equal(get.status,200);assert.equal((await get.json()).services.length,4);
  const post=await handleApi(new Request('https://cloudpulse.test/api/checks',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),store);
  assert.equal(post.status,200);assert.equal((await post.json()).checks.length,4);
  assert.equal(await store.acquireLease('verify','first',60),true);assert.equal(await store.acquireLease('verify','second',60),false);
  await store.releaseLease('verify','first');assert.equal(await store.acquireLease('verify','second',60),true);
 }finally{db.close();}
});
