// No automatic retries: COMMIT acknowledgement can be lost after durable writes.
export async function postgresTransaction(pool,action,{lock='3s',statement='10s',commitOnError=()=>false}={}){
 let client,began=false,committing=false,finished=false,destroy=false;
 try{
  client=await pool.connect();await client.query('BEGIN');began=true;
  // These values are host-owned constants, never request input.
  if(!/^\d+s$/.test(lock) || !/^\d+s$/.test(statement))throw new TypeError('Invalid transaction timeout.');
  await client.query(`SET LOCAL lock_timeout = '${lock}'`);
  await client.query(`SET LOCAL statement_timeout = '${statement}'`);
  await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
  let result;
  try{result=await action(client);}catch(error){
   if(commitOnError(error)){committing=true;await client.query('COMMIT');committing=false;finished=true;}
   throw error;
  }
  committing=true;await client.query('COMMIT');committing=false;finished=true;return result;
 }catch(error){
  destroy=committing || !began;
  if(client && !finished)try{await client.query('ROLLBACK');}catch{destroy=true;}
  throw error;
 }finally{client?.release(destroy);}
}
