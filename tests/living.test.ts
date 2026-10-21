import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrateLife,channelCompatibility } from '../packages/hept/src/world/rules.js';
import { rankOpportunities } from '../packages/hept/src/agency/attention.js';
test('realized life updates energy by duration, with independent channel compatibility',()=>{for(const [kind,hours,energy,fatigue]of [['sleep',2,1,0],['study',2,.68,.34],['exercise',3,.5,.44]]as const){const actual=integrateLife({energy:.8,fatigue:.2},kind,hours);assert.ok(Math.abs(actual.energy-energy)<1e-8);assert.ok(Math.abs(actual.fatigue-fatigue)<1e-8);}assert.equal(channelCompatibility({mobility:'focused'},{hearing:'light'}),true);assert.equal(channelCompatibility({reasoning:'focused'},{reasoning:'focused'}),false);});
test('attention window is bounded and waiting alone cannot outrank a direct mention',()=>{const candidates=Array.from({length:20},(_,i)=>({id:String(i),notice:{mentioned:i===19},waiting:i===0?10000:0}));const ranked=rankOpportunities(candidates);assert.equal(ranked.length,8);assert.equal(ranked[0].id,'19');});
