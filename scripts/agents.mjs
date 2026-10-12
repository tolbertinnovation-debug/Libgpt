import {createAgentGovernance} from '../server/agent-governance.js';
const governance=createAgentGovernance({directory:process.env.RITUAL_GOVERNANCE_DIR,serverless:Boolean(process.env.VERCEL)});
const action=process.argv[2];
try {
  if(!['pause','resume','status','audit','limits'].includes(action))throw Error('Usage: npm run agents -- pause|resume|status|audit|limits [JSON]');
  const result=action==='limits'?await governance.configure({limits:JSON.parse(process.argv[3] || '{}'),actor:'operator-cli'}):action==='pause'||action==='resume'?await governance[action]({actor:'operator-cli'}):await governance[action]();
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
