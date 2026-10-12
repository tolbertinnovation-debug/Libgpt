// Official standard text rates verified 2026-10-12, with a 25% safety margin.
// Reservations use input UTF-8 bytes as a token upper bound and full output budget.
// Operators must review rates when provider prices or approved models change.
export const DEFAULT_AGENT_PRICES=Object.freeze({
 'gpt-4.1':{input:2.5,output:10},'gpt-4.1-mini':{input:0.5,output:2},
 'gpt-4o':{input:3.125,output:12.5},'gpt-4o-mini':{input:0.1875,output:0.75}
});
export function agentModelPolicy(env=process.env){
 const prices={...DEFAULT_AGENT_PRICES};
 if(env.RITUAL_MODEL_COSTS_JSON){const extra=JSON.parse(env.RITUAL_MODEL_COSTS_JSON);if(!extra||Array.isArray(extra)||typeof extra!=='object')throw Error('Invalid agent model price policy.');for(const [model,p]of Object.entries(extra)){if(!/^[a-zA-Z0-9_.:-]{1,100}$/.test(model)||!p||!Number.isFinite(p.input)||!Number.isFinite(p.output)||p.input<=0||p.output<=0||p.input>100||p.output>100)throw Error('Invalid agent model price policy.');prices[model]={input:p.input,output:p.output};}}
 const allowedModels=(env.RITUAL_AGENT_MODELS||Object.keys(DEFAULT_AGENT_PRICES).join(',')).split(',').map(x=>x.trim()).filter(Boolean);
 return {allowedModels,modelPrices:prices};
}
