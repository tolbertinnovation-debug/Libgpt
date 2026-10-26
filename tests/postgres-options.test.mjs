import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import fs from 'node:fs';
import {parse} from 'pg-connection-string';
import {postgresPoolOptions} from '../server/postgres-options.js';
const base='postgres://fake:fake@db.example.invalid/synthetic';
for(const mode of ['prefer','require','verify-ca','verify-full'])test(`TLS ${mode} becomes explicit verified TLS without dropping URL parameters`,()=>{
 const result=postgresPoolOptions(base+`?sslmode=${mode}&application_name=grandpa&channel_binding=require`,{max:3});
 const url=new URL(result.connectionString);assert.equal(url.searchParams.get('sslmode'),'verify-full');assert.equal(url.searchParams.get('channel_binding'),'require');assert.equal(url.searchParams.get('application_name'),'grandpa');assert.equal(result.max,3);
 const config=parse(result.connectionString);assert.notEqual(config.ssl.rejectUnauthorized,false);assert.equal(config.ssl.checkServerIdentity,undefined);
});
test('remote URLs without an SSL mode require verified TLS; explicit local plaintext stays local',()=>{
 assert.equal(new URL(postgresPoolOptions(base).connectionString).searchParams.get('sslmode'),'verify-full');
 for(const host of ['localhost','127.0.0.1','[::1]'])assert.equal(new URL(postgresPoolOptions(`postgres://fake:fake@${host}/test?sslmode=disable`).connectionString).searchParams.get('sslmode'),'disable');
});
for(const query of ['sslmode=disable','sslmode=no-verify','ssl=false','ssl=0','sslmode=require&sslmode=disable','sslmode=unknown','sslmode=require&sslmode=require','sslrootcert=a&sslrootcert=b'])test(`unsafe or ambiguous TLS is rejected: ${query}`,()=>assert.throws(()=>postgresPoolOptions(base+'?'+query),{code:'POSTGRES_TLS_CONFIG'}));
test('libpq compatibility cannot silently weaken aliases and separate TLS objects are rejected',()=>{
 const config=parse(postgresPoolOptions(base+'?sslmode=require&uselibpqcompat=true').connectionString);assert.notEqual(config.ssl.rejectUnauthorized,false);assert.equal(config.ssl.checkServerIdentity,undefined);
 assert.throws(()=>postgresPoolOptions(base,{ssl:{rejectUnauthorized:false}}),{code:'POSTGRES_TLS_CONFIG'});
});
test('query hostname overrides cannot disguise remote plaintext as localhost',()=>{
 assert.throws(()=>postgresPoolOptions('postgres://fake:fake@localhost/test?host=remote.example.invalid&sslmode=disable'),{code:'POSTGRES_TLS_CONFIG'});
 const parsed=parse(postgresPoolOptions('postgres://fake:fake@localhost/test?host=remote.example.invalid').connectionString);
 assert.equal(parsed.host,'remote.example.invalid');assert.notEqual(parsed.ssl.rejectUnauthorized,false);
});
test('CA and channel binding parameters survive normalization without reading a CA file',()=>{
 const url=new URL(postgresPoolOptions(base+'?sslmode=require&sslrootcert=%2Fsynthetic%2Fca.pem&channel_binding=require').connectionString);
 assert.equal(url.searchParams.get('sslrootcert'),'/synthetic/ca.pem');assert.equal(url.searchParams.get('channel_binding'),'require');
});
test('hostname mismatches remain rejected and invalid URL errors omit credentials',()=>{
 assert.ok(tls.checkServerIdentity('db.example.invalid',{subjectaltname:'DNS:other.example.invalid'}));
 assert.throws(()=>postgresPoolOptions('postgres://private-secret@%bad'),error=>!error.message.includes('private-secret'));
});
test('both production pools use the shared helper without overriding its result',()=>{
 for(const name of ['governance-postgres','build-jobs'])assert.match(fs.readFileSync(new URL(`../server/${name}.js`,import.meta.url),'utf8'),/new pg\.Pool\(postgresPoolOptions\(connectionString,/);
});
test('normalization eliminates the warning offline without muting process warnings',async()=>{
 const {spawnSync}=await import('node:child_process');
 const script=`import {parse} from 'pg-connection-string';import {postgresPoolOptions} from './server/postgres-options.js';parse(postgresPoolOptions('${base}?sslmode=require').connectionString);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0);assert.equal(result.stderr,'');
});
