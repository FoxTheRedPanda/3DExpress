const json = (statusCode, body) => ({ statusCode, headers: {"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS"}, body: JSON.stringify(body) });
async function token(base, client, secret) {
  const auth=Buffer.from(client+":"+secret).toString("base64");
  const r=await fetch(base+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+auth,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  const d=await r.json(); if(!r.ok||!d.access_token) throw new Error("PayPal authentication failed. Check the Netlify payment credentials."); return d.access_token;
}
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function sendReceipt({apiKey,from,to,subject,html}) {
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({from,to,subject,html})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.message||"Email provider rejected the receipt.");
  return data.id;
}
exports.handler=async(event)=>{
  if(event.httpMethod==="OPTIONS") return json(200,{ok:true});
  if(event.httpMethod!=="POST") return json(405,{error:"Method not allowed"});
  try {
    const client=process.env.PAYPAL_CLIENT_ID, secret=process.env.PAYPAL_CLIENT_SECRET;
    if(!client||!secret) return json(500,{error:"PayPal credentials are missing from Netlify environment variables."});
    const live=(process.env.PAYPAL_ENV||"sandbox").toLowerCase()==="live";
    const base=live?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
    const body=JSON.parse(event.body||"{}"), orderID=String(body.orderID||"");
    if(!/^[A-Z0-9-]{8,64}$/i.test(orderID)) return json(400,{error:"Invalid PayPal order ID."});
    const access=await token(base,client,secret);
    const detailsResponse=await fetch(base+"/v2/checkout/orders/"+encodeURIComponent(orderID),{headers:{Authorization:"Bearer "+access}});
    const details=await detailsResponse.json();
    if(!detailsResponse.ok||!details.purchase_units||details.purchase_units[0]?.custom_id!=="3DExpressStore") return json(400,{error:"This order could not be verified."});
    let result=details;
    if(details.status!=="COMPLETED") {
      if(details.status!=="APPROVED") return json(400,{error:"PayPal has not approved this order."});
      const response=await fetch(base+"/v2/checkout/orders/"+encodeURIComponent(orderID)+"/capture",{method:"POST",headers:{Authorization:"Bearer "+access,"Content-Type":"application/json"}});
      result=await response.json();
      if(!response.ok||result.status!=="COMPLETED") return json(502,{error:"PayPal could not complete the payment."});
    }
    const unit=(result.purchase_units||details.purchase_units||[])[0]||{};
    const payer=result.payer||details.payer||{};
    const payerEmail=String(payer.email_address||"");
    const payerName=[payer.name?.given_name,payer.name?.surname].filter(Boolean).join(" ")||"3D Express customer";
    const amount=unit.payments?.captures?.[0]?.amount?.value||unit.amount?.value||"";
    const currency=unit.payments?.captures?.[0]?.amount?.currency_code||unit.amount?.currency_code||"USD";
    const items=unit.items||details.purchase_units?.[0]?.items||[];
    const rows=items.map(x=>'<tr><td style="padding:8px;border-bottom:1px solid #ddd">'+esc(x.name)+'</td><td style="padding:8px;border-bottom:1px solid #ddd">'+esc(x.quantity)+'</td><td style="padding:8px;border-bottom:1px solid #ddd">'+esc(x.description||"")+'</td><td style="padding:8px;border-bottom:1px solid #ddd">'+esc(x.unit_amount?.value||"")+' '+esc(x.unit_amount?.currency_code||currency)+'</td></tr>').join("");
    const html='<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#222"><h1>Thank you for your 3D Express order!</h1><p>Hi '+esc(payerName)+', your payment was completed successfully.</p><p><b>Order:</b> '+esc(orderID)+'<br><b>Total:</b> '+esc(amount)+' '+esc(currency)+'<br><b>Payment status:</b> COMPLETED</p><h2>Order details</h2><table style="border-collapse:collapse;width:100%;text-align:left"><thead><tr><th style="padding:8px">Item</th><th style="padding:8px">Qty</th><th style="padding:8px">Color</th><th style="padding:8px">Unit price</th></tr></thead><tbody>'+rows+'</tbody></table><p>We have received your order. 3D Express will follow up about fulfillment.</p><p>Thank you,<br>3D Express</p></div>';
    let emailSent=false, emailWarning="";
    const apiKey=process.env.RESEND_API_KEY, from=process.env.ORDER_FROM_EMAIL;
    if(apiKey&&from) {
      const recipients=["fleetlentz@outlook.com"];
      if(payerEmail) recipients.push(payerEmail);
      try { await sendReceipt({apiKey,from,to:recipients,subject:"3D Express order received — "+orderID,html}); emailSent=true; }
      catch(e) { console.error("Order receipt email failed:",e); emailWarning="Payment completed, but the receipt email could not be sent."; }
    } else {
      emailWarning="Payment completed. Email notifications are not configured yet.";
    }
    return json(200,{id:orderID,status:"COMPLETED",payerEmail,amount,currency,emailSent,emailWarning});
  } catch(e) {
    console.error("PayPal capture error:",e);
    return json(500,{error:e.message||"Unable to complete PayPal payment."});
  }
};