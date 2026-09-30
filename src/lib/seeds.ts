export const PK_SEED_NAMES=[
"Elmuerte","Royal Creeds","Villas Creeds","Lord Lusius","Guedes Proxy","Jean Pusheen","King of Tretas",
"Rocha Vimprorush","Arcon Dusing","Malokeirah","Ninfaj","Madara Gestao Inteligente","Repair Softboots",
"Paldoni Karke","Viciousback","Ro Od Formidavel","Awesome Ideals","Salbaria Syfaladrel","Pak Explicit",
"Umobuga Feiditau","Xxoxii","Caneva Is Back","Blaze Lostshell","Levity Naverande","No Pelu","Adwino Rhys",
"Lkbomb","Tehde Leteo","Harumasz","Tiger Shadow","Prensado Xuxuzao","Xxoxi","Muita Agua Xixica",
"Brazillian Jiu Jitsu","Tomasuakuu","Lina Semneura","Valheu","Oisoueudenovo","Atiradora de Dardos",
"Rhashid","Lebesquedoh"
] as const;
export const PK_SEED_SET=new Set(PK_SEED_NAMES.map(x=>x.toLowerCase()));
export function discoveryDepth(tags:string[]|null|undefined){if(tags?.includes("PK_SEED"))return 0;for(const t of tags??[]){const m=t.match(/^DISCOVERY_DEPTH:(\d+)$/);if(m)return Number(m[1])}return null}
export function discoveryRule(depth:number|null,score:number,matches:number,spanDays:number){if(depth===null)return false;if(depth===0)return score>=95&&matches>=80&&spanDays>=30;if(depth===1)return score>=98&&matches>=120&&spanDays>=60;if(depth===2)return score>=99&&matches>=160&&spanDays>=90;return false}
