// One TLS policy for both application pools. Never log a connection URL.
export function postgresPoolOptions(connectionString, options={}) {
 const invalid=()=>Object.assign(new Error('Invalid or insecure PostgreSQL TLS configuration.'),{code:'POSTGRES_TLS_CONFIG'});
 if(typeof connectionString!=='string' || Object.hasOwn(options,'ssl'))throw invalid();
 let url;try{url=new URL(connectionString);}catch{throw invalid();}
 if(!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || url.hostname.includes('%'))throw invalid();
 // node-postgres permits a query host to override the authority hostname.
 const effectiveHost=url.searchParams.get('host') || url.hostname;
 const local=['localhost','127.0.0.1','[::1]','::1'].includes(effectiveHost);
 for(const name of ['host','sslmode','ssl','uselibpqcompat','sslrootcert','sslcert','sslkey','sslnegotiation'])if(url.searchParams.getAll(name).length>1)throw invalid();
 const mode=url.searchParams.get('sslmode');
 const ssl=url.searchParams.get('ssl'),compat=url.searchParams.get('uselibpqcompat'),negotiation=url.searchParams.get('sslnegotiation');
 if(url.searchParams.has('sslmode') && !['prefer','require','verify-ca','verify-full','disable'].includes(mode))throw invalid();
 if(url.searchParams.has('ssl') && !['0','1','true','false'].includes(ssl))throw invalid();
 if((compat!==null && !['true','false'].includes(compat)) || (negotiation!==null && !['direct','postgres'].includes(negotiation)))throw invalid();
 const plaintext=mode==='disable' || ['0','false'].includes(ssl);
 if((!local && plaintext) || (mode && mode!=='disable' && ['0','false'].includes(ssl)) ||
  (mode==='disable' && ['1','true'].includes(ssl)) ||
  (plaintext && (negotiation==='direct' || ['sslcert','sslkey','sslrootcert'].some(k=>url.searchParams.has(k)))) || url.searchParams.has('sslca'))throw invalid();
 if(['prefer','require','verify-ca'].includes(mode) || (!local && !mode))url.searchParams.set('sslmode','verify-full');
 // A URL's SSL fields override pg's separate SSL object; never mix policies.
 return {...options,connectionString:url.toString()};
}
