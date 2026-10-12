import 'dotenv/config';
import {createRedisGovernanceStorage} from '../server/governance-redis.js';
import {createAgentGovernance} from '../server/agent-governance.js';
const storage=createRedisGovernanceStorage({url:process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,namespace:process.env.RITUAL_GOVERNANCE_NAMESPACE || `ritual:libgpt:${process.env.VERCEL_ENV || 'production'}:v1`});
const governance=createAgentGovernance({storage,directory:process.env.RITUAL_GOVERNANCE_DIR,serverless:Boolean(process.env.VERCEL)});
const action=process.argv[2];
try {
  if(!['pause','resume','status','audit','limits'].includes(action))throw Error('Usage: npm run agents -- pause|resume|status|audit|limits [JSON]');
  const result=action==='limits'?await governance.configure({limits:JSON.parse(process.argv[3] || '{}'),actor:'operator-cli'}):action==='pause'||action==='resume'?await governance[action]({actor:'operator-cli'}):action==='audit'?await governance.audit({limit:Number(process.argv[3]||100),before:Number(process.argv[4]||0)}):await governance[action]();
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
