// One TLS policy for both application pools. Never log a connection URL.
export function postgresPoolOptions(connectionString, options={}) {
 if(connectionString===undefined)return {...options,connectionString};
 const invalid=()=>Object.assign(new Error('Invalid or insecure PostgreSQL TLS configuration.'),{code:'POSTGRES_TLS_CONFIG'});
 let url;try{url=new URL(connectionString);}catch{throw invalid();}
 if(!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || url.hostname.includes('%'))throw invalid();
 // node-postgres permits a query host to override the authority hostname.
 const effectiveHost=url.searchParams.get('host') || url.hostname;
 const local=['localhost','127.0.0.1','[::1]','::1'].includes(effectiveHost);
 for(const name of ['host','sslmode','ssl','uselibpqcompat','sslrootcert','sslcert','sslkey'])if(url.searchParams.getAll(name).length>1)throw invalid();
 const mode=url.searchParams.get('sslmode');
 if(mode && !['prefer','require','verify-ca','verify-full','disable','no-verify'].includes(mode))throw invalid();
 if(!local && (['disable','no-verify'].includes(mode) || ['0','false'].includes(url.searchParams.get('ssl'))))throw invalid();
 if(['prefer','require','verify-ca'].includes(mode) || (!local && !mode))url.searchParams.set('sslmode','verify-full');
 // A URL's SSL fields override pg's separate SSL object; never mix policies.
 if(Object.hasOwn(options,'ssl'))throw invalid();
 return {...options,connectionString:url.toString()};
}
