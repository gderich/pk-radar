// Same-origin proxy for Tibia Stalker public character profiles.
// Browser-to-Stalker requests can fail with an opaque "Failed to fetch"
// when the upstream server does not allow this site's origin.
const BASE="https://api.tibiastalker.pl/api/tibia-stalker/v1/characters/";
const VALID_NAME=/^[\p{L}\p{M}0-9 '-]{2,48}$/u;

export default async function handler(req,res){
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"Método não permitido."});
  }
  const name=typeof req.query.name==="string"?req.query.name.trim():"";
  if(!VALID_NAME.test(name))return res.status(400).json({error:"Nome de personagem inválido."});
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(BASE+encodeURIComponent(name),{
      headers:{accept:"application/json"},
      signal:controller.signal
    });
    if(!response.ok){
      if(response.status===429){
        res.setHeader("Cache-Control","no-store");
        const retryAfter=response.headers.get("retry-after");
        if(retryAfter)res.setHeader("Retry-After",retryAfter);
        return res.status(429).json({error:"Tibia Stalker limitou temporariamente as consultas. Tente novamente mais tarde."});
      }
      res.setHeader("Cache-Control","no-store");
      return res.status(response.status===404?404:502).json({
        error:response.status===404?"Personagem não encontrado no Tibia Stalker.":"Tibia Stalker indisponível no momento (HTTP "+response.status+")."
      });
    }
    const data=await response.json();
    // One-minute CDN caching avoids duplicate lookups and upstream rate limits across tabs.
    res.setHeader("Cache-Control","public, s-maxage=60, stale-while-revalidate=60");
    return res.status(200).json(data);
  }catch(error){
    res.setHeader("Cache-Control","no-store");
    const timedOut=controller.signal.aborted;
    console.warn("stalker-character",name,timedOut?"timeout":String(error));
    return res.status(503).json({error:timedOut?"Tibia Stalker demorou para responder. Tente novamente.":"Não foi possível consultar o Tibia Stalker pelo servidor. Tente novamente mais tarde."});
  }finally{
    clearTimeout(timeout);
  }
}
