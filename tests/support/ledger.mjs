// Tests that boot the whole app use a throwaway spending ledger with roomy
// limits, so they neither share state across runs nor depend on the approved
// production budget. Call before the first import of server/app.js.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

export async function isolatedLedger(t) {
  const directory=await mkdtemp(path.join(tmpdir(),'grandpa-ledger-'));
  t?.after?.(()=>rm(directory,{recursive:true,force:true}));
  Object.assign(process.env,{RITUAL_GOVERNANCE_DIR:directory,RITUAL_BUDGET_POLICY:'off',RITUAL_DAILY_USD:'1000',
    RITUAL_CALLS_PER_MINUTE:'1000',RITUAL_CONCURRENCY:'8'});
  return directory;
}
