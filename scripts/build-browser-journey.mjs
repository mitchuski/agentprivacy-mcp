import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(process.env.AGENTPRIVACY_SUITE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) + path.sep;
let src=fs.readFileSync(root+'agentprivacy-mcp/lib/journey.mjs','utf8').split('/** The City\'s intake view.')[0];
src=src.replace(/^import .*;\r?\n/gm,'');
const names=['digest','packetProof','checkPacket','checkKey','checkTask','createBundle','validateBundle','foldJourney','kappaOf','merkleRoot','stamp'];
for(const name of names) src=src.replace(new RegExp('\\b'+name+'\\(', 'g'),'await '+name+'(');
src=src.replace(/function await /g,'async function ');
src=src.replace('const digest = value =>','const digest = async value =>').replace('sha256hex(canonicalJSON(value))','await sha256hex(canonicalJSON(value))');
src=src.replace('bundle.packets.map(p => await checkPacket(p, bundle.key))','await Promise.all(bundle.packets.map(p => checkPacket(p, bundle.key)))');
src=src.replace('bundle.taskDocuments.map(checkTask)','await Promise.all(bundle.taskDocuments.map(checkTask))');
const helpers=`// Generated from agentprivacy-mcp/lib/journey.mjs by scripts/build-browser-journey.mjs.
// Do not edit: shared wire rules, WebCrypto transport, no credential verification.
export function canonicalJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canonicalJSON(v[k])).join(',') + '}';
}
async function sha256hex(s) {
  const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
}
export async function kappaOf(obj) { const c={...obj}; delete c.kappa; return 'sha256:'+await sha256hex(canonicalJSON(c)); }
export async function stamp(obj) { return {...obj,kappa:await kappaOf(obj)}; }
async function merkleRoot(leaves) {
  let level=[...leaves].sort(); if(!level.length) return null;
  while(level.length>1) { const next=[]; for(let i=0;i<level.length;i+=2) next.push(i+1<level.length?'sha256:'+await sha256hex(level[i]+'|'+level[i+1]):level[i]); level=next; }
  return level[0];
}
function didKey(pub) {
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n=BigInt('0xed01'+pub), out='';
  while(n) { out=alphabet[Number(n%58n)]+out; n/=58n; }
  return 'did:key:z'+out;
}
`;
const declaration=`export type JourneyKey = Record<string, any>;
export interface JourneyBundle { kind: 'agentprivacy.journey-bundle/1'; key: JourneyKey; packets: any[]; taskDocuments: any[]; }
export const BUNDLE_KIND: JourneyBundle['kind'];
export function canonicalJSON(value: unknown): string;
export function kappaOf(key: JourneyKey): Promise<string>;
export function stamp(key: JourneyKey): Promise<JourneyKey>;
export function packetProof(packet: any): Promise<string>;
export function checkPacket(packet: any,key: JourneyKey): Promise<unknown>;
export function createBundle(key: JourneyKey,packets?: any[],taskDocuments?: any[]): Promise<JourneyBundle>;
export function validateBundle(bundle: unknown): Promise<unknown>;
export function foldJourney(bundle: JourneyBundle,evidence: {packet?: any; taskDocument?: any}): Promise<{bundle:JourneyBundle;changed:boolean}>;
`;
for(const repo of ['spellweb','agentprivacy_master']) {
 fs.writeFileSync(root+repo+'/src/lib/journey-core.js',helpers+src);
 fs.writeFileSync(root+repo+'/src/lib/journey-core.d.ts',declaration);
}
