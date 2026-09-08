import {canonicalJSON,sha256hex} from './kappa.mjs';
const hash=value=>'sha256:'+sha256hex(canonicalJSON(value));
const requireThat=(ok,message)=>{if(!ok)throw Error(message);};
/** A proposal for extension review, never an authorization or executable script. */
export function prepareBrowserAction(input,{now=Date.now()}={}){
 const {operationId,subject,audience,page,action,target,contentDigest,expiresAt}=input??{};
 requireThat(typeof operationId==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(operationId),'Stable operationId required (16–100 letters/digits/_/-)');
 requireThat(typeof subject==='string'&&subject.startsWith('did:')&&subject.length<=512&&!/\s/.test(subject),'Subject DID reference required; ownership is not inferred');
 let origin,url;try{origin=new URL(audience);url=new URL(page);}catch{throw Error('Audience and page URLs required');}
 requireThat(origin.protocol==='https:'&&audience===origin.origin,'Audience must be an exact HTTPS origin');
 requireThat(url.origin===origin.origin&&!url.username&&!url.password&&!url.search&&!url.hash,'Page must be on the audience origin with no credentials, query or fragment');
 requireThat(['spell.cast','sticker.place'].includes(action),'Unsupported browser action');
 requireThat(typeof target==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(target),'Registered game target ID required; scripts and selectors are not accepted');
 requireThat(typeof contentDigest==='string'&&/^sha256:[a-f0-9]{64}$/.test(contentDigest),'Content commitment required');
 const end=Date.parse(expiresAt);
 requireThat(Number.isFinite(end)&&end>now&&end<=now+5*60*1000,'Expiry must be in the next five minutes');
 const intent={kind:'agentprivacy.browser-action/1',operationId,subject,audience,page:url.href,action,target,contentDigest,expiresAt:new Date(end).toISOString()};
 return {intent,intentDigest:hash(intent),status:'proposed',authorized:false,dispatched:false,
  requirements:['extension-observed-origin-and-page','fresh-holder-delegation-and-consent','registered-game-action','durable-operation-idempotency','verified-result-receipt']};
}

/** Host integration seam. Verification functions are host-owned, never supplied by MCP arguments. */
export async function verifyBrowserResult({proposal,receipt,packet,verifyReceipt,now=Date.now()}){
 const current=prepareBrowserAction(proposal?.intent,{now});
 requireThat(current.intentDigest===proposal?.intentDigest,'Proposal content changed');
 requireThat(receipt?.intentDigest===current.intentDigest&&receipt?.operationId===current.intent.operationId&&receipt?.status==='applied','Receipt does not bind the applied operation');
 requireThat(typeof receipt.id==='string'&&receipt.id.length>0,'Receipt ID required');
 requireThat(typeof receipt.packetProof==='string'&&receipt.packetProof===packet?.proof,'Receipt does not bind the original artefact');
 requireThat(typeof verifyReceipt==='function','Trusted receipt verifier is not connected');
 // The verifier must authenticate the service, signature, current status and exact intent.
 const verified=await verifyReceipt(structuredClone(receipt),structuredClone(current.intent));
 requireThat(verified?.valid===true,'Receipt verification failed');
 return {receiptId:receipt.id,packet:structuredClone(packet)};
}
