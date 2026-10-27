import {createHash,sign,verify} from 'node:crypto';
export const CHECK='REV local review';
export const EVIDENCE_CHECK='REV local attestation';
export const MAX_BYTES=512*1024;
export const canonical=value=>JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
const sha=v=>typeof v==='string' && /^[a-f0-9]{40}$/.test(v);
const text=(v,n)=>typeof v==='string' && v.length>0 && v.length<=n;
const same=(a,b)=>canonical([...a].sort())===canonical([...b].sort());
const fail=reason=>{throw new Error(reason);};
export const schema={type:'object',additionalProperties:false,required:['complete','reviewedPaths','findings','limitations','summary'],properties:{
  complete:{type:'boolean'},reviewedPaths:{type:'array',items:{type:'string'}},
  findings:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,required:['path','line','severity','description'],properties:{path:{type:'string'},line:{type:'integer',minimum:1},severity:{type:'string',enum:['high','medium','low']},description:{type:'string',maxLength:2000}}}},
  limitations:{type:'array',maxItems:20,items:{type:'string',maxLength:1000}},summary:{type:'string',maxLength:2000},
}};
export function validateModelReview(review,files) {
  const paths=files.map(f=>f.path);
  if(!review || typeof review.complete!=='boolean' || !Array.isArray(review.reviewedPaths)
    || !review.reviewedPaths.every(p=>paths.includes(p)) || new Set(review.reviewedPaths).size!==review.reviewedPaths.length
    || !Array.isArray(review.findings) || review.findings.length>20 || !Array.isArray(review.limitations) || review.limitations.length>20
    || !review.limitations.every(s=>text(s,1000)) || !text(review.summary,2000)) fail('invalid-local-review');
  for(const f of review.findings) {
    const source=files.find(s=>s.path===f.path);
    if(!source || !Number.isSafeInteger(f.line) || f.line<1 || f.line>Math.max(source.before.split('\n').length,source.after.split('\n').length)
      || !['high','medium','low'].includes(f.severity) || !text(f.description,2000)) fail('invalid-finding-reference');
  }
  if(review.complete && !same(paths,review.reviewedPaths)) fail('incomplete-review-coverage');
  return review.complete && same(paths,review.reviewedPaths) && !review.findings.length && !review.limitations.length;
}
export function seal(payload,privateKey) {
  const encoded=Buffer.from(canonical(payload));
  if(encoded.length>48000) fail('review-report-too-large');
  return {payload,signature:sign(null,encoded,privateKey).toString('base64')};
}
export function open(envelope,publicKey,expected,now=Date.now()) {
  const p=envelope?.payload;
  if(!p || Buffer.byteLength(canonical(p))>48000 || typeof envelope.signature!=='string'
    || !verify(null,Buffer.from(canonical(p)),publicKey,Buffer.from(envelope.signature,'base64'))) fail('invalid-review-signature');
  if(p.version!==1 || p.engine!=='claude-code' || p.authMethod!=='claude.ai' || !text(p.toolVersion,100)
    || p.repository!==expected.repository || p.prNumber!==expected.prNumber || p.headSha!==expected.headSha || p.baseSha!==expected.baseSha
    || p.requestSha256!==expected.requestSha256 || !sha(p.headSha) || !sha(p.baseSha) || !sha(p.mergeBaseSha) || !/^[a-f0-9]{64}$/.test(p.inputSha256)) fail('stale-or-invalid-review');
  const created=Date.parse(p.completedAt),expires=Date.parse(p.expiresAt);
  if(!Number.isFinite(created)||!Number.isFinite(expires)||created>now+60000||expires<=now||expires-created>24*3600000||expires<=created) fail('expired-or-invalid-review');
  if(!Array.isArray(p.paths)||!same(p.paths,expected.paths)||new Set(p.paths).size!==p.paths.length) fail('incomplete-review-coverage');
  const r=p.review;
  if(!r || typeof r.complete!=='boolean' || !Array.isArray(r.reviewedPaths)||!r.reviewedPaths.every(path=>p.paths.includes(path))||new Set(r.reviewedPaths).size!==r.reviewedPaths.length
    || (r.complete&&!same(r.reviewedPaths,p.paths))
    || !Array.isArray(r.findings)||!Array.isArray(r.limitations)||!text(r.summary,2000)) fail('invalid-review-report');
  if(r.findings.length>20||r.limitations.length>20||!r.limitations.every(s=>text(s,1000))
    ||!r.findings.every(f=>f&&p.paths.includes(f.path)&&Number.isSafeInteger(f.line)&&f.line>0&&['high','medium','low'].includes(f.severity)&&text(f.description,2000)))fail('invalid-review-report');
  return {payload:p,approved:r.complete && r.findings.length===0 && r.limitations.length===0};
}
