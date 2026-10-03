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
export const MANUAL_IDENTITY_SETS=[["Rhashid","Muita Agua Xixica","Brazillian Jiu Jitsu"],["Malokeirah","Ninfaj"]];
export function discoveryDepth(tags:string[]|null|undefined){if(tags?.includes("PK_SEED"))return 0;for(const t of tags??[]){const m=t.match(/^DISCOVERY_DEPTH:(\d+)$/);if(m)return Number(m[1])}return null}
export const STALKER_HINT_MIN_MATCHES=10;
export const STALKER_DISCOVERY_MIN_MATCHES=30;
export const STALKER_GROUP_MIN_MATCHES=50;
export function stalkerSpanDays(first:string|null|undefined,last:string|null|undefined){
  if(!first||!last)return 0;
  const a=new Date(first+"T00:00:00Z").getTime(),b=new Date(last+"T00:00:00Z").getTime();
  return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,Math.round((b-a)/86400000)):0;
}
export function stalkerEvidence(matches:number,first?:string|null,last?:string|null){
  const m=Math.max(0,Number(matches||0)),span=stalkerSpanDays(first,last);
  const autoGroup=m>=100||(m>=STALKER_GROUP_MIN_MATCHES&&span>=7);
  const autoDiscover=m>=80||(m>=STALKER_DISCOVERY_MIN_MATCHES&&span>=7);
  const level=autoGroup?(m>=100?"MUITO FORTE":"FORTE"):autoDiscover?"MODERADA":m>=STALKER_HINT_MIN_MATCHES?"FRACA":"INSUFICIENTE";
  const tone=autoGroup?"good":autoDiscover?"warn":"neutral";
  const rank=autoGroup?4:autoDiscover?3:m>=STALKER_HINT_MIN_MATCHES?2:1;
  const internalStrength=autoGroup?(m>=100?95:85):autoDiscover?60:m>=STALKER_HINT_MIN_MATCHES?30:10;
  return {matches:m,spanDays:span,autoGroup,autoDiscover,level,tone,rank,internalStrength};
}
export function discoveryRule(depth:number|null,_legacyScore:number,matches:number,first?:string|null,last?:string|null){
  if(depth===null)return false;
  const e=stalkerEvidence(matches,first,last);
  if(depth===0)return e.autoDiscover;
  return matches>=100||(matches>=50&&e.spanDays>=14);
}
