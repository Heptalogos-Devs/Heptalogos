export const energyRates={sleep:[.10,-.12],rest:[.04,-.05],study:[-.06,.07],exercise:[-.10,.08],social:[-.03,.02],travel:[-.04,.03],other:[0,0]} as const;
export function integrateLife(state:{energy:number;fatigue:number},kind:keyof typeof energyRates,hours:number){const rate=energyRates[kind];return {energy:Math.max(0,Math.min(1,state.energy+rate[0]*hours)),fatigue:Math.max(0,Math.min(1,state.fatigue+rate[1]*hours))};}
export function channelCompatibility(a:Record<string,string>,b:Record<string,string>){return Object.keys(a).every(key=>!(a[key]==='focused'&&b[key]==='focused'));}
