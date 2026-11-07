const json = (statusCode, body) => ({ statusCode, headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS"}, body: JSON.stringify(body) });
async function token(base, client, secret) {
  const auth=Buffer.from(client+":"+secret).toString("base64");
  const r=await fetch(base+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+auth,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  const d=await r.json(); if(!r.ok||!d.access_token) throw new Error("PayPal authentication failed. Check the Netlify Sandbox credentials."); return d.access_token;
}
exports.handler=async(event)=>{
  if(event.httpMethod==="OPTIONS") return json(200,{ok:true});
  if(event.httpMethod!=="POST") return json(405,{error:"Method not allowed"});
  try {
    const client=process.env.PAYPAL_CLIENT_ID, secret=process.env.PAYPAL_CLIENT_SECRET;
    if(!client||!secret) return json(500,{error:"PayPal credentials are missing from Netlify environment variables."});
    const base=(process.env.PAYPAL_ENV||"sandbox").toLowerCase()==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
    const body=JSON.parse(event.body||"{}"), orderID=String(body.orderID||"");
    if(!/^[A-Z0-9-]{8,64}$/i.test(orderID)) return json(400,{error:"Invalid PayPal order ID."});
    const access=await token(base,client,secret);
    const detailsResponse=await fetch(base+"/v2/checkout/orders/"+encodeURIComponent(orderID),{headers:{Authorization:"Bearer "+access}});
    const details=await detailsResponse.json();
    if(!detailsResponse.ok||!details.purchase_units||details.purchase_units[0]?.custom_id!=="3DExpressStore") return json(400,{error:"This order could not be verified."});
    if(details.status==="COMPLETED") return json(200,{id:orderID,status:"COMPLETED"});
    if(details.status!=="APPROVED") return json(400,{error:"PayPal has not approved this order."});
    const response=await fetch(base+"/v2/checkout/orders/"+encodeURIComponent(orderID)+"/capture",{method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json"}});
    const result=await response.json();
    if(!response.ok||result.status!=="COMPLETED") return json(502,{error:"PayPal could not complete the payment."});
    return json(200,{id:result.id,status:result.status});
  } catch(e) {
    console.error("PayPal capture error:",e);
    return json(500,{error:e.message||"Unable to complete PayPal payment."});
  }
};