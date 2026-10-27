import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import fs from 'node:fs';
import {parse} from 'pg-connection-string';
import pg from 'pg';
import {X509Certificate} from 'node:crypto';
import {fileURLToPath} from 'node:url';
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
for(const query of ['ssl=no-verify','sslmode=verify-full&ssl=no-verify','sslmode=','ssl=','ssl=unknown','uselibpqcompat=unknown','sslnegotiation=direct&sslnegotiation=postgres','sslnegotiation=unknown','sslca=ignored.pem'])test(`conflicting or unsupported TLS setting fails closed: ${query}`,()=>assert.throws(()=>postgresPoolOptions(base+'?'+query),{code:'POSTGRES_TLS_CONFIG'}));
test('local fixtures cannot mix plaintext with certificate requirements or direct TLS negotiation',()=>{
 for(const query of ['sslmode=disable&sslrootcert=ca.pem','sslmode=require&ssl=false','sslmode=disable&ssl=true','sslmode=disable&sslnegotiation=direct'])assert.throws(()=>postgresPoolOptions('postgres://fake:fake@localhost/test?'+query),{code:'POSTGRES_TLS_CONFIG'});
 assert.throws(()=>postgresPoolOptions(undefined,{ssl:{rejectUnauthorized:false}}),{code:'POSTGRES_TLS_CONFIG'});
 assert.throws(()=>postgresPoolOptions(undefined),{code:'POSTGRES_TLS_CONFIG'});
});
test('custom CA is loaded into both pool option profiles without disabling hostname or chain checks',()=>{
 const path=fileURLToPath(new URL('./fixtures/postgres-test-ca.pem',import.meta.url)),pem=fs.readFileSync(path,'utf8');
 const cert=new X509Certificate(pem);assert.equal(tls.checkServerIdentity('db.example.invalid',cert.toLegacyObject()),undefined);
 assert.ok(tls.checkServerIdentity('other.example.invalid',cert.toLegacyObject()));
 for(const max of [3,4])for(const compat of ['true','false']){
  const url=new URL(base);url.searchParams.set('sslmode','require');url.searchParams.set('sslrootcert',path);url.searchParams.set('uselibpqcompat',compat);
  const client=new pg.Client(postgresPoolOptions(url.toString(),{max})),ssl=client.connectionParameters.ssl;
  assert.equal(ssl.ca,pem);assert.notEqual(ssl.rejectUnauthorized,false);assert.equal(ssl.checkServerIdentity,undefined);assert.equal(client.connectionParameters.host,'db.example.invalid');
  assert.doesNotThrow(()=>tls.createSecureContext({ca:ssl.ca}));
 }
});
