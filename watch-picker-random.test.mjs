// All API paths and responses in these tests are explicitly synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as picker from './watch-picker.mjs';
// Prevent appStore's default adapter from even probing real browser storage.
Object.defineProperty(globalThis,'localStorage',{value:undefined,configurable:true});
const { loadCandidateBatch } = await import('./app.mjs');
const state={preferences:{formats:['movie'],genres:{movie:[18],series:[]}},library:[{catalogueId:'tmdb:movie:9',liked:true,title:'Liked'}],dismissed:[]};
const item=(id,extra={})=>({catalogueId:`tmdb:movie:${id}`,tmdbId:id,format:'movie',genreIds:[18],title:`Synthetic ${id}`,...extra});
test('seed sampler draws at most three from all explicit likes, never watched stars or later alone',()=>{
 const library=Array.from({length:6},(_,n)=>item(n,{liked:true})).concat(item(80,{status:'watched'}),item(81,{personalRating:5}),item(82,{status:'plan_to_watch'}),item(83,{liked:1}));
 const first=picker.pickerSeeds({library},()=>0),last=picker.pickerSeeds({library},()=>1);
 assert.equal(first.length,3);assert.equal(new Set(first.map(x=>x.catalogueId)).size,3);
 assert.notDeepEqual(first,last);assert.ok(last.some(x=>x.tmdbId===5));
 assert.ok([...first,...last].every(x=>x.liked===true));
});
test('related pagination is additive, records distinct totals, and leaves For you defaults unchanged',async()=>{
 const paths=[],totals=new Map(),seed=item(9,{liked:true});
 const fetchImpl=async path=>{paths.push(path);return {ok:true,json:async()=>({results:[],totalPages:path.includes('recommendations')?17:24})};};
 await loadCandidateBatch(state.preferences,{page:2,seeds:[seed],totals,fetchImpl});
 assert.equal(paths.length,1);assert.equal(totals.get('movie'),24);
 paths.length=0;
 await loadCandidateBatch(state.preferences,{page:2,seeds:[seed],discoveryPages:new Map(),seedPages:new Map([[seed.catalogueId,12]]),totals,fetchImpl});
 assert.equal(paths.length,1);assert.match(paths[0],/recommendations.*page=12/);assert.equal(totals.get('related:tmdb:movie:9'),17);
 paths.length=0;await loadCandidateBatch(state.preferences,{seeds:[seed],fetchImpl});
 assert.equal(paths.length,2);assert.ok(paths.every(path=>path.endsWith('page=1')));
});
test('ordinary For you totals remain discovery-only when related ranges are larger',async()=>{
 const totals=new Map(),seed=item(9,{liked:true});
 await loadCandidateBatch(state.preferences,{seeds:[seed],totals,fetchImpl:async path=>({ok:true,json:async()=>({results:[],totalPages:path.includes('recommendations')?499:3})})});
 assert.deepEqual([...totals],[['movie',3]],'related-page totals must not inflate homepage pagination');
});
test('lottery is random rather than always ranked index zero; every eligible title is reachable',()=>{
 const items=[item(1,{relatedTo:['tmdb:movie:9']}),item(2),item(3)];
 const seen=new Set(Array.from({length:1000},(_,n)=>picker.selectPickerCandidate(items,state,new Set(),{},{},()=>n/999).catalogueId));
 assert.deepEqual([...seen],items.map(x=>x.catalogueId));
 assert.equal(picker.selectPickerCandidate(items,state,new Set(),{},{},()=>1).catalogueId,'tmdb:movie:3');
 const counts=items.map(x=>Array.from({length:1000},(_,n)=>picker.selectPickerCandidate(items,state,new Set(),{},{},()=>n/1000)).filter(y=>y.catalogueId===x.catalogueId).length);
 assert.ok(counts[0]>counts[1]);
});
