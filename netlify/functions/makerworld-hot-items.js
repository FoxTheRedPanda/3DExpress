const json=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"public, max-age=0, s-maxage=21600, stale-while-revalidate=86400","Access-Control-Allow-Origin":"*"},body:JSON.stringify(body)});
const FILAMENT_USD_PER_KG=25;
const ELECTRICITY_USD_PER_KWH=0.15;
const X2D_AVERAGE_KW=0.15;
const ALLOWED_LICENSES=new Set(["CC0","BY","BY-SA"]);
const api=async(path,params,key)=>{
 const url=new URL("https://api.api.sh/makerworld/v1/"+path);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 const r=await fetch(url.toString(),{headers:{"x-api-key":key},signal:AbortSignal.timeout(25000)});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error("MakerWorld API request failed ("+r.status+").");
 return data;
};
const getProfile=(model)=>{
 const profiles=Array.isArray(model.print_profiles)?model.print_profiles:[];
 return profiles.find(p=>{
  const printerCode=p.printer?.printer_code;
  const filaments=Array.isArray(p.filaments)?p.filaments:[];
  const grams=Number(p.weight_grams||0);
  const seconds=Number(p.print_seconds||0);
  const pla=filaments.length>0&&filaments.every(f=>String(f.type||"").toUpperCase().includes("PLA"));
  return printerCode==="N6"&&pla&&Number(p.colors||filaments.length)===1&&grams>0&&seconds>0;
 })||null;
};
const licenseAllowed=license=>ALLOWED_LICENSES.has(String(license||"").toUpperCase().replace(/^CC[-_]?/,""));
const priceFor=(grams,seconds)=>{
 const filament=(grams/1000)*FILAMENT_USD_PER_KG;
 const electricity=(seconds/3600)*X2D_AVERAGE_KW*ELECTRICITY_USD_PER_KWH;
 return Math.ceil((filament+electricity)*1.5);
};
const modelDetails=async(id,key)=>{
 const d=await api("model",{id},key);
 const model=d.model||d;
 const profile=getProfile(model);
 if(!model.id||!licenseAllowed(model.license)||!profile)return null;
 return {id:String(model.id),title:model.title,cover:model.cover,downloads:Number(model.downloads||0),creator:model.creator||{},url:model.url,license:model.license,weightGrams:Number(profile.weight_grams),printSeconds:Number(profile.print_seconds),printMinutes:Math.ceil(Number(profile.print_seconds)/60),price:priceFor(Number(profile.weight_grams),Number(profile.print_seconds))};
};
exports.handler=async()=>{try{
 const key=process.env.APISH_API_KEY;
 if(!key)return json(503,{error:"Hot Items feed is not configured."});
 const data=await api("search",{category:"800",sort:"downloads",created_within_days:"7",printer:"N6",color:"single",license:"CC0,BY,BY-SA",limit:"20"},key);
 if(!Array.isArray(data.models))return json(502,{error:"MakerWorld search returned an unexpected response."});
 const eligible=[];
 for(const candidate of data.models){
  if(eligible.length>=8)break;
  const id=candidate.id;
  if(!id)continue;
  try{const item=await modelDetails(id,key);if(item)eligible.push(item);}catch(e){console.warn("Skipping Hot Item detail",id,e.message);}
 }
 return json(200,{models:eligible,fetched_at:data.fetched_at||new Date().toISOString(),pricing:{filamentUsdPerKg:FILAMENT_USD_PER_KG,electricityUsdPerKwh:ELECTRICITY_USD_PER_KWH,x2dAverageKw:X2D_AVERAGE_KW,markup:0.5}});
}catch(e){console.error("MakerWorld Hot Items error:",e);return json(500,{error:"Unable to load Hot Items."});}};
