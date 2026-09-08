import {canonicalJSON,sha256hex} from './kappa.mjs';
import fs from 'node:fs';
export function experienceOverview(){return JSON.parse(fs.readFileSync(new URL('./experience-overview.json',import.meta.url),'utf8'));}
export function cityInvitationDraft({summary,action='invitation',target}={}){
 if(!['mark','invitation','offer','request'].includes(action))throw Error('Use mark, invitation, offer or request; agreements and credentials use their own protocols');
 if(typeof summary!=='string'||!summary.trim()||summary.length>500)throw Error('Choose a public summary of 1–500 characters');
 if(/[\u0000-\u001f\u007f]/.test(summary))throw Error('Summary must be a single line');
 if(target!==undefined&&!/^sha256:[a-f0-9]{64}$/.test(target))throw Error('Target must be an existing event commitment');
 const event={kind:'mages.visitor-promise/1',publish:false,action,summary,...(target?{target}:{})};
 return {kind:'agentprivacy.city-invitation-draft/1',eventDraft:event,
  draftDigest:'sha256:'+sha256hex(canonicalJSON(event)),status:'private-draft',sent:false,credentialIssued:false,
  next:['Review the exact summary with the keeper; public Portal records are retained.',
   'Only after publication approval, set publish:true and construct the actual Portal message.',
   'For invitation, offer or request, sign the final canonical Portal message using the existing AgentCard signer.',
   'Submit only through an explicitly authorised transport; this tool does not send.'],
  signing:{fields:['handle','reply_to','text','topic'],canonicalization:'recursively sorted JSON, no whitespace',reply_to:'null when absent',text:'JSON of the final approved event; changing publish changes the signed bytes'},
  limits:'A draft digest is not the Portal actor-bound commitment, a Trust Task result, a MyTerms agreement or admission.'};
}
export function experienceRoute({intent}={}){
 const routes={
  arrive:{url:'https://mages.city/skill.md',tools:['city_invitation_draft'],next:'Prepare a selected public introduction or invitation; publication requires separate approval.'},
  learn:{url:'https://agentprivacy.ai/guide/walk',tools:['guide_search','guide_page','guide_neighbours','key_evolve'],next:'Read sources and append a selected walk. A recorded walk is not proof of comprehension.'},
  carry:{url:'https://soulbis.com/star/',tools:['key_derive','journey_start','journey_inspect','sigil_render'],next:'Inspect and retain original evidence privately; choose appearance at Star.'},
  cast:{url:'https://agentprivacy.ai/',tools:['browser_action_prepare','journey_fold'],next:'Propose a registered spell/sticker action. Fold only the actual original result after host verification; live dispatch is not connected.'},
  collaborate:{url:'https://mages.city/skill.md',tools:['city_invitation_draft','journey_inspect'],next:'Offer a scoped contribution; carry existing MyTerms and VRC evidence privately. Invitation is separate from City access.'}
 };
 if(!Object.hasOwn(routes,intent))throw Error('Choose arrive, learn, carry, cast or collaborate');
 return {kind:'agentprivacy.experience-route/1',intent,...routes[intent],status:'local-routing-guide',liveCapabilitiesVerified:false,transmitsPrivateState:false};
}
