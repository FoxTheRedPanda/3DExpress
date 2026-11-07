const json=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"public, max-age=0, s-maxage=21600, stale-while-revalidate=86400","Access-Control-Allow-Origin":"*"},body:JSON.stringify(body)});
exports.handler=async()=>{try{
  const key=process.env.APISH_API_KEY;
  if(!key)return json(503,{error:"MakerWorld feed is not configured yet."});
  const url=new URL("https://api.api.sh/makerworld/v1/search");
  url.searchParams.set("category","800");
  url.searchParams.set("sort","downloads");
  url.searchParams.set("created_within_days","7");
  url.searchParams.set("limit","20");
  const r=await fetch(url.toString(),{headers:{"x-api-key":key},signal:AbortSignal.timeout(25000)});
  const data=await r.json();
  if(!r.ok||!Array.isArray(data.models)) {
    console.error("API.SH MakerWorld response:",r.status,data);
    return json(502,{error:"MakerWorld feed request failed."});
  }
  const models=data.models.slice(0,6).map(m=>({
    title:m.title,url:m.url,cover:m.cover,downloads:m.downloads,
    creator:m.creator,created_at:m.created_at
  }));
  return json(200,{models,fetched_at:data.fetched_at||new Date().toISOString(),credits_used:data.credits_used||1});
}catch(e){console.error("MakerWorld hot items error:",e);return json(500,{error:"Unable to load MakerWorld Hot Items."});}};
