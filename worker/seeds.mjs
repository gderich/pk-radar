export const PK_SEED_NAMES=[
"Elmuerte","Royal Creeds","Villas Creeds","Lord Lusius","Guedes Proxy","Jean Pusheen","King of Tretas",
"Rocha Vimprorush","Arcon Dusing","Malokeirah","Ninfaj","Madara Gestao Inteligente","Repair Softboots",
"Paldoni Karke","Viciousback","Ro Od Formidavel","Awesome Ideals","Salbaria Syfaladrel","Pak Explicit",
"Umobuga Feiditau","Xxoxii","Caneva Is Back","Blaze Lostshell","Levity Naverande","No Pelu","Adwino Rhys",
"Lkbomb","Tehde Leteo","Harumasz","Tiger Shadow","Prensado Xuxuzao","Xxoxi","Muita Agua Xixica",
"Brazillian Jiu Jitsu","Tomasuakuu","Lina Semneura","Valheu","Oisoueudenovo","Atiradora de Dardos",
"Rhashid","Lebesquedoh"
];
export const PK_SEED_SET=new Set(PK_SEED_NAMES.map(x=>x.toLowerCase()));
export function discoveryDepth(tags=[]){if(tags.includes("PK_SEED"))return 0;for(const t of tags){const m=String(t).match(/^DISCOVERY_DEPTH:(\d+)$/);if(m)return Number(m[1])}return null}
export function discoveryRule(depth,score,matches){return depth!==null&&score>=95&&matches>=10}
