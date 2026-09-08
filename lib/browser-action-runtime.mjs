import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareBrowserAction,verifyBrowserResult} from './browser-action.mjs';
import {validateBundle,foldJourney} from './journey.mjs';

/** Private, host-owned directory. Cooperating processes use the same directory.
 * Retained crash locks require operator inspection; never auto-break a lock.
 * Not encrypted storage or a network service. The directory must already exist.
 */
export function createBrowserActionRuntime({directory,adapter,verifyReceipt,now=()=>Date.now()}){
 if(!path.isAbsolute(directory)||!fs.statSync(directory).isDirectory())throw Error('Existing absolute private ledger directory required');
 return async function run({proposal,bundle,context}){
  const checked=prepareBrowserAction(proposal?.intent,{now:now()});
  if(checked.intentDigest!==proposal?.intentDigest)throw Error('Proposal content changed');
  const intent=checked.intent;
  if(context?.subject!==intent.subject||context?.origin!==intent.audience||context?.page!==intent.page)throw Error('Host-observed context differs from proposal');
  validateBundle(bundle);
  if(!adapter||typeof adapter.authorize!=='function'||typeof verifyReceipt!=='function')return {status:'needs-adapter',dispatched:false};
  // Each operation is globally bound in this host ledger, not per-subject aliases.
  const file=path.join(directory,crypto.createHash('sha256').update(intent.operationId).digest('hex')+'.json');
  const lock=file+'.lock';let fd;
  try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')return {status:'unconfirmed',reason:'Operation locked; reconcile after the writer has stopped',dispatched:false};throw e;}
  function save(record,initial=false){
   const temporary=file+'.'+crypto.randomUUID()+'.tmp';
   let handle;
   try{
    handle=fs.openSync(initial?file:temporary,'wx',0o600);fs.writeFileSync(handle,JSON.stringify(record)+'\n');fs.fsyncSync(handle);fs.closeSync(handle);handle=undefined;
    if(!initial)fs.renameSync(temporary,file);
   }finally{if(handle!==undefined)fs.closeSync(handle);if(!initial&&fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  try{
   let saved=null;
   try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(saved&&(saved.kind!=='agentprivacy.browser-operation/1'||saved.intentDigest!==checked.intentDigest||!['pending','complete'].includes(saved.status)))throw Error('Operation ID conflict or invalid ledger record');
   // Approval is host-owned and checked even for reading a previously retained result.
   if((await adapter.authorize(structuredClone(intent),structuredClone(context)))!==true)return {status:'denied',dispatched:false};
   prepareBrowserAction(intent,{now:now()}); // Consent latency cannot extend the deadline.
   const replay=saved?.status==='complete';let result=saved?.result;
   if(!replay){
    const method=saved?'reconcile':'execute';
    if(typeof adapter[method]!=='function')return {status:saved?'unconfirmed':'needs-adapter',dispatched:false};
    if(!saved){saved={kind:'agentprivacy.browser-operation/1',intentDigest:checked.intentDigest,status:'pending'};save(saved,true);}
    try{result=await adapter[method](structuredClone(intent));}catch{return {status:'unconfirmed',reason:'Retain operation and reconcile; do not repeat the effect'};}
   }
   let folded;
   try{
    const verified=await verifyBrowserResult({proposal:checked,receipt:result?.receipt,packet:result?.packet,verifyReceipt,now:now()});
    folded=foldJourney(bundle,{packet:verified.packet});
   }catch{return {status:'unconfirmed',reason:'Receipt or original artefact did not verify; retain operation for reconciliation'};}
   if(!replay)save({...saved,status:'complete',result});
   return {status:'recorded',replayed:replay,changed:folded.changed,bundle:folded.bundle,receipt:result.receipt,credentialIssued:false};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 };
}
