import test from 'node:test';
import assert from 'node:assert/strict';
const modulePath = './watch-picker.mjs';
const state = { preferences: { formats: ['movie','series'], genres: { movie: [18], series: [77] } }, library: [{catalogueId:'tmdb:movie:9',title:'Liked seed',liked:true}], dismissed: ['tmdb:movie:8'] };
const candidate = (id, extra = {}) => ({catalogueId:`tmdb:movie:${id}`, tmdbId:id, format:'movie', title:`Pick ${id}`, genreIds:[18], ...extra});
test('selection ranks positive signals, excludes saved adult dismissed and shown, enforces explicit genre locally', async () => {
 const { selectPickerCandidate } = await import(modulePath);
 const items = [candidate(9),candidate(8),candidate(7,{adult:true}),candidate(1),candidate(2,{relatedTo:['tmdb:movie:9']}),candidate(3,{genreIds:[99]})];
 assert.equal(selectPickerCandidate(items,state,new Set(),{},{},()=>0).catalogueId,'tmdb:movie:2');
 assert.equal(selectPickerCandidate(items,state,new Set(['tmdb:movie:2']),{},{},()=>0).catalogueId,'tmdb:movie:1');
 assert.equal(selectPickerCandidate(items,state,new Set(['tmdb:movie:2','tmdb:movie:1']),{genre:'drama'},{movie:[{id:18,name:'Drama'}]}),null);
 const watched = {...state,library:[{catalogueId:'tmdb:movie:9',title:'Only watched',status:'watched',liked:false}]};
 assert.equal(selectPickerCandidate([candidate(5,{genreIds:[],relatedTo:['tmdb:movie:9']})],watched,new Set(),{},{}).recommendationReason,'Popular picks');
});
test('mount API is exported', async () => { assert.equal(typeof (await import(modulePath)).mountWatchPicker,'function'); });
// Tiny event harness exercises real async controller without external DOM packages.
function harness(loadBatch, fetchImpl = async()=>({ok:true,json:async()=>({movie:[],series:[]})})) {
 class Element extends EventTarget { constructor(){super();this.value='';this.children=[];this.dataset={};this.classList={add(){}};} replaceChildren(...nodes){this.children=nodes;}append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this[key]=value;}focus(){}showModal(){this.open=true;}close(){this.open=false;} }
 const nodes=Object.fromEntries(['result','status','next','retry','format','genre','apply','close','heading'].map(key=>[key,new Element()]));
 const dialog=new Element();dialog.querySelector=selector=>nodes[selector.replace('#watch-picker-','')];const opener=new Element();
 Element.prototype.querySelector=function(selector){return this.children.find(node=>`.${node.className}`===selector)||this.children.map(node=>node.querySelector?.(selector)).find(Boolean);};
 globalThis.document={createElement:()=>new Element()};globalThis.window=new EventTarget();
 return {nodes,dialog,opener,store:{getState:()=>structuredClone(state),subscribe:()=>()=>{}},loadBatch,fetchImpl,random:()=>0};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
test('controller learns source totals and samples unseen discovery and related pages beyond page one',async()=>{
 const {mountWatchPicker}=await import(modulePath);const calls=[];
 const h=harness(async(_,o)=>{calls.push(o);o.totals.set('movie',23);o.totals.set('series',11);o.totals.set('related:tmdb:movie:9',17);return {candidates:[],errors:[],hasMore:true};});
 h.random=()=>1;const picker=mountWatchPicker(h);
 try{picker.open();await settle();assert.equal(calls.length,5);assert.equal(calls[1].discoveryPages.get('movie'),23);assert.equal(calls[1].seedPages.get('tmdb:movie:9'),17);for(const key of ['movie','series']){const pages=calls.map(o=>o.discoveryPages.get(key));assert.equal(new Set(pages).size,5);assert.ok(pages.every(p=>p>=1&&p<=(key==='movie'?23:11)));}}finally{picker.destroy();delete globalThis.document;delete globalThis.window;}
});
test('opening bootstraps actual API ranges then samples beyond page one even when page one has candidates',async()=>{
 Object.defineProperty(globalThis,'localStorage',{value:undefined,configurable:true});
 const {loadCandidateBatch}=await import('./app.mjs');const {mountWatchPicker}=await import(modulePath);const paths=[];
 const h=harness(loadCandidateBatch,async path=>{paths.push(path);return {ok:true,json:async()=>path==='/api/genres'?{movie:[],series:[]}:{results:[candidate(1)],totalPages:path.includes('recommendations')?17:23}};});
 h.random=()=>1;const picker=mountWatchPicker(h);
 try{picker.open();await settle();assert.ok(paths.some(path=>path.includes('discover')&&path.endsWith('page=23')));assert.ok(paths.some(path=>path.includes('recommendations')&&path.endsWith('page=17')));assert.equal(new Set(paths).size,paths.length);}finally{picker.destroy();delete globalThis.document;delete globalThis.window;}
});
test('page-one discovery calibration does not become the pick when a fresh random page is available',async()=>{
 const {mountWatchPicker}=await import(modulePath);let count=0;
 const h=harness(async(_,o)=>{count++;o.totals.set('movie',2);o.totals.set('series',1);o.totals.set('related:tmdb:movie:9',1);return {candidates:[candidate(count)],errors:[],hasMore:count===1};});
 const picker=mountWatchPicker(h);
 try {picker.open();await settle();assert.equal(count,2);assert.equal(h.nodes.result.children[0].dataset.catalogueId,'tmdb:movie:2','discover calibration is not recycled as the first random pick');}
 finally {picker.destroy();delete globalThis.document;delete globalThis.window;}
});
test('each refill searches at most five real pages and session stops at page 500',async()=>{
 const {mountWatchPicker}=await import(modulePath);const pages=[];const h=harness(async(_,o)=>{pages.push(o.page);for(const key of ['movie','series','related:tmdb:movie:9'])o.totals.set(key,500);return {candidates:[],errors:[],hasMore:true};});h.random=()=>1;const picker=mountWatchPicker(h);
 try {picker.open();await settle();assert.deepEqual(pages,[1,500,499,498,497]);for(let n=0;n<110;n++){const before=pages.length;h.nodes.next.dispatchEvent(new Event('click'));await settle();assert.ok(pages.length-before<=5);}assert.equal(pages.length,500);assert.equal(new Set(pages).size,500);assert.ok(pages.every(page=>page>=1&&page<=500));assert.equal(h.nodes.next.disabled,true);} finally {picker.destroy();delete globalThis.document;delete globalThis.window;}
});
test('partial failures never invent page totals for sources whose first request failed',async()=>{
 const {mountWatchPicker}=await import(modulePath);const calls=[];
 const h=harness(async(_,o)=>{calls.push(o);o.totals.set('movie',23);return {candidates:[candidate(9)],errors:calls.length===1?[Error('Synthetic missing series/related ranges')]:[],hasMore:true};});h.random=()=>1;
 const picker=mountWatchPicker(h);
 try{picker.open();await settle();assert.equal(calls.length,5);assert.equal(calls[1].discoveryPages.get('movie'),23);assert.equal(calls[1].discoveryPages.has('series'),false,'unknown source range needs Retry, not guessed pages');assert.equal(calls[1].seedPages.size,0);assert.equal(h.nodes.retry.hidden,false);}
 finally{picker.destroy();delete globalThis.document;delete globalThis.window;}
});
test('close and filter change invalidate late batches',async()=>{
 const {mountWatchPicker}=await import(modulePath);let finish;const h=harness(()=>new Promise(r=>{finish=r;}));const picker=mountWatchPicker(h);
 try{picker.open();await settle();h.nodes.format.dispatchEvent(new Event('change'));finish({candidates:[],errors:[],hasMore:false});await settle();assert.match(h.nodes.status.textContent,/Apply filters/);picker.close();assert.equal(h.dialog.open,false);}finally{picker.destroy();delete globalThis.document;delete globalThis.window;}
});
test('Retry really reloads failed genre metadata after empty catalogue',async()=>{
 const {mountWatchPicker}=await import(modulePath);let count=0;const h=harness(async()=>({candidates:[],errors:[],hasMore:false}),async()=>{count++;throw Error('Synthetic metadata failure');});const picker=mountWatchPicker(h);
 try{picker.open();await settle();assert.equal(count,1);h.nodes.retry.dispatchEvent(new Event('click'));await settle();assert.equal(count,2);}finally{picker.destroy();delete globalThis.document;delete globalThis.window;}
});
test('an unresolved partial failure survives later successful empty pages and Retry revisits it', async () => {
 const {mountWatchPicker}=await import(modulePath);
 const calls=[];let failing=true;
 const h=harness(async(_,o)=>{
  calls.push(o.page);
  o.totals.set('movie',2);o.totals.set('series',2);o.totals.set('related:tmdb:movie:9',2);
  return o.page===1 ? {candidates:[candidate(9)],errors:failing?[Error('Synthetic partial source failure')]:[],hasMore:true} : {candidates:[],errors:[],hasMore:false};
 });
 const picker=mountWatchPicker(h);
 try {
  picker.open();await settle();
  assert.deepEqual(calls,[1,2]);
  assert.equal(h.nodes.retry.hidden,false,'a later success must not hide unresolved source failure');
  assert.match(h.nodes.status.textContent,/sources failed/);
  assert.equal(h.nodes.next.disabled,true);
  failing=false;h.nodes.retry.dispatchEvent(new Event('click'));await settle();
  assert.deepEqual(calls,[1,2,1],'Retry must revisit the failure without repeating successful pages');
  assert.equal(h.nodes.retry.hidden,true,'successful retry resolves the warning');
 } finally {picker.destroy();delete globalThis.document;delete globalThis.window;}
});

test('repeated failed Retry stays attached to its original batch and later success clears it',async()=>{
 const {mountWatchPicker}=await import(modulePath);let attempt=0;const calls=[];
 const h=harness(async(_,o)=>{calls.push(o.page);for(const key of ['movie','series','related:tmdb:movie:9'])o.totals.set(key,2);if(o.page===1&&++attempt===2)throw Error('Synthetic repeated failure');return {candidates:[candidate(9)],errors:o.page===1&&attempt===1?[Error('Synthetic partial failure')]:[],hasMore:true};});const picker=mountWatchPicker(h);
 try{picker.open();await settle();h.nodes.retry.dispatchEvent(new Event('click'));await settle();h.nodes.retry.dispatchEvent(new Event('click'));await settle();assert.deepEqual(calls,[1,2,1,1]);assert.equal(h.nodes.retry.hidden,true);}finally{picker.destroy();delete globalThis.document;delete globalThis.window;}
});
test('optional genre maps names to each real namespace without changing saved preferences', async () => {
  const { pickerPreferences } = await import(modulePath);
  const saved = { region: 'NG', formats: ['movie'], genres: { movie: [18], series: [] } };
  const before = structuredClone(saved);
  const lists = { movie: [{ id: 18, name: 'Drama' }], series: [{ id: 77, name: ' drama ' }] };
  assert.deepEqual(pickerPreferences(saved, { format: 'series', genre: 'drama' }, lists), { region: 'NG', formats: ['series'], genres: { movie: [], series: [77] } });
  assert.deepEqual(saved, before);
  assert.deepEqual(pickerPreferences(saved, {}, lists), saved);
});
