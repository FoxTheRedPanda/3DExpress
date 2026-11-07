const prices = {
  "Flexi Dragon":9,"Mini Dinosaur":7,"Robot Buddy":10,"Space Rocket":8,"Cat Figure":7,
  "Star Decoration":5,"Desk Organizer":12,"Phone Stand":9,"Plant Pot":11,"Wall Hook":6,
  "Dice Set":6,"Game Token Set":8,"Puzzle Cube":10,"Game Spinner":6,"Keychain":4,
  "Mini Trophy":8,"Heart Decoration":5,"Name Plate":10,"Lucky Star":5,
  "Mystery Box $20":20,"Mystery Box $30":30,"Mystery Box $40":40,"Mystery Box $50":50
};
const json = (statusCode, body) => ({ statusCode, headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS"}, body: JSON.stringify(body) });
async function paypalToken(base, client, secret) {
  const auth = Buffer.from(client + ":" + secret).toString("base64");
  const r = await fetch(base + "/v1/oauth2/token", {method:"POST",headers:{Authorization:"Basic "+auth,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error("PayPal authentication failed. Check the Netlify credentials.");
  return d.access_token;
}
const ALLOWED_LICENSES=new Set(["CC0","BY","BY-SA"]);
const FILAMENT_USD_PER_KG=25,ELECTRICITY_USD_PER_KWH=0.15,X2D_AVERAGE_KW=0.15;
async function verifiedHotItem(id){
 const key=process.env.APISH_API_KEY;if(!key)throw new Error("Hot Item checkout is temporarily unavailable.");
 const url=new URL("https://api.api.sh/makerworld/v1/model");url.searchParams.set("id",String(id));
 const r=await fetch(url.toString(),{headers:{"x-api-key":key},signal:AbortSignal.timeout(20000)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error("Could not verify a Hot Item. Refresh the page and try again.");
 const m=d.model||d,license=String(m.license||"").toUpperCase().replace(/^CC-/,"");
 if(!m.id||!ALLOWED_LICENSES.has(license))throw new Error("This model is not approved for commercial physical-print sales.");
 const profiles=Array.isArray(m.print_profiles)?m.print_profiles:[];
 const p=profiles.find(x=>x.printer?.printer_code==="N6"&&Array.isArray(x.filaments)&&x.filaments.length>0&&x.filaments.every(f=>String(f.type||"").toUpperCase().includes("PLA"))&&Number(x.colors||x.filaments.length)===1&&Number(x.weight_grams)>0&&Number(x.print_seconds)>0);
 if(!p)throw new Error("This model no longer has a qualifying X2D single-color PLA profile.");
 const grams=Number(p.weight_grams),seconds=Number(p.print_seconds);
 const filament=grams/1000*FILAMENT_USD_PER_KG,electricity=seconds/3600*X2D_AVERAGE_KW*ELECTRICITY_USD_PER_KWH;
 return {name:String(m.title||"MakerWorld print").slice(0,127),price:Math.ceil((filament+electricity)*1.5),grams,seconds};
}
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200,{ok:true});
  if (event.httpMethod !== "POST") return json(405,{error:"Method not allowed"});
  try {
    const client=process.env.PAYPAL_CLIENT_ID,secret=process.env.PAYPAL_CLIENT_SECRET;
    if(!client||!secret)return json(500,{error:"PayPal credentials are missing from Netlify environment variables."});
    const base=(process.env.PAYPAL_ENV||"sandbox").toLowerCase()==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
    const body=JSON.parse(event.body||"{}");
    if(!Array.isArray(body.cart)||body.cart.length<1||body.cart.length>30)return json(400,{error:"Your cart is empty or invalid."});
    let totalCents=0;const items=[];
    for(const row of body.cart){
      const qty=Number(row.qty);
      if(!Number.isInteger(qty)||qty<1||qty>20)return json(400,{error:"An item quantity is invalid."});
      let name,price;
      if(row.makerworldId!==undefined&&row.makerworldId!==null&&String(row.makerworldId)!==""){
        const verified=await verifiedHotItem(row.makerworldId);name=verified.name;price=verified.price;
      }else{
        name=String(row.name||"");
        if(!Object.prototype.hasOwnProperty.call(prices,name))return json(400,{error:"An item in your cart is invalid. Please refresh and try again."});
        price=prices[name];
      }
      const priceCents=price*100;totalCents+=priceCents*qty;
      items.push({name:name.slice(0,127),quantity:String(qty),unit_amount:{currency_code:"USD",value:(priceCents/100).toFixed(2)},description:String(row.color||"Color selection not supplied").slice(0,127),category:"PHYSICAL_GOODS"});
    }
    if(totalCents<100||totalCents>1000000)return json(400,{error:"Cart total is outside the allowed range."});
    const token=await paypalToken(base,client,secret);
    const order=await fetch(base+"/v2/checkout/orders",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({intent:"CAPTURE",purchase_units:[{custom_id:"3DExpressStore",description:"3D Express 3D prints",amount:{currency_code:"USD",value:(totalCents/100).toFixed(2),breakdown:{item_total:{currency_code:"USD",value:(totalCents/100).toFixed(2)}}},items}]})});
    const data=await order.json();if(!order.ok||!data.id)return json(502,{error:"PayPal could not create the order. Please try again."});
    return json(200,{id:data.id});
  }catch(e){console.error("PayPal create order error:",e);return json(400,{error:e.message||"Unable to start PayPal checkout."});}
};
