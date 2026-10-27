import test from 'node:test';
import assert from 'node:assert/strict';
import {postgresTransaction} from '../server/postgres-transaction.js';
function fixture(fault=()=>false){const sql=[],release=[];return {sql,release,pool:{async connect(){return {async query(q){sql.push(q);if(fault(q))throw Error('private database URL');return {};},release:x=>release.push(x)};}}};}
test('transaction commits once, bounds idle state, and performs no automatic retry',async()=>{
 const f=fixture();assert.equal(await postgresTransaction(f.pool,async c=>{await c.query('UPDATE fixture');return 7;}),7);
 assert.equal(f.sql.filter(x=>x==='COMMIT').length,1);assert.ok(f.sql.some(x=>x.includes('idle_in_transaction_session_timeout')));assert.deepEqual(f.release,[false]);
});
test('lost COMMIT acknowledgement destroys a client even when ROLLBACK responds successfully',async()=>{
 const f=fixture(q=>q==='COMMIT');await assert.rejects(postgresTransaction(f.pool,async()=>7));assert.equal(f.sql.filter(x=>x==='COMMIT').length,1);assert.deepEqual(f.release,[true]);
});
test('failed rollback destroys the client; ordinary business denial rolls back cleanly',async()=>{
 for(const broken of [false,true]){const f=fixture(q=>broken && q==='ROLLBACK');await assert.rejects(postgresTransaction(f.pool,async()=>{throw Error('business denial');}));assert.deepEqual(f.release,[broken]);}
});
test('audited denial commits exactly once and is still returned as a denial',async()=>{
 const f=fixture(),error=Object.assign(Error('denied'),{persistAudit:true});
 await assert.rejects(postgresTransaction(f.pool,async()=>{throw error;},{commitOnError:e=>e.persistAudit}),e=>e===error);
 assert.equal(f.sql.filter(x=>x==='COMMIT').length,1);assert.equal(f.sql.includes('ROLLBACK'),false);assert.deepEqual(f.release,[false]);
});
test('initial connection and BEGIN failures cannot return a dirty reusable client',async()=>{
 await assert.rejects(postgresTransaction({connect:async()=>{throw Error('offline');}},()=>assert.fail()));
 const f=fixture(q=>q==='BEGIN');await assert.rejects(postgresTransaction(f.pool,()=>assert.fail()));assert.deepEqual(f.release,[true]);
});
test('transaction setup failure rolls back without executing the mutation',async()=>{
 const f=fixture(q=>q.includes('statement_timeout'));let actions=0;
 await assert.rejects(postgresTransaction(f.pool,async()=>{actions++;}));
 assert.equal(actions,0);assert.equal(f.sql.includes('COMMIT'),false);assert.equal(f.sql.filter(q=>q==='ROLLBACK').length,1);assert.deepEqual(f.release,[false]);
});
test('uncertain COMMIT during audited denial destroys the client and is never retried',async()=>{
 const f=fixture(q=>q==='COMMIT');let actions=0;
 await assert.rejects(postgresTransaction(f.pool,async()=>{actions++;throw Object.assign(Error('Denied'),{persistAudit:true});},{commitOnError:e=>e.persistAudit}));
 assert.equal(actions,1);assert.equal(f.sql.filter(q=>q==='COMMIT').length,1);assert.deepEqual(f.release,[true]);
});
