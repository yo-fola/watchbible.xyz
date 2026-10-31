// Synthetic, isolated fixtures only. No app import or user storage.
import { mountWatchPicker } from './watch-picker.mjs';
const wait = async predicate => { for(let n=0;n<150;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Picker UI timeout'); };
export async function checkWatchPicker() {
 const checks=[];const check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
 const host=document.createElement('div');host.innerHTML=`<button id="fixture-open">Choose</button><dialog id="watch-picker" aria-labelledby="watch-picker-heading"><h2 id="watch-picker-heading" tabindex="-1">What to watch</h2><select id="watch-picker-format"><option value="">Your preferences</option><option value="movie">Movie</option><option value="series">Series</option></select><select id="watch-picker-genre"><option value="">Your genres</option></select><button id="watch-picker-apply">Apply filters</button><div id="watch-picker-result"></div><p id="watch-picker-status" role="status"></p><button id="watch-picker-next">Pick another</button><button id="watch-picker-retry" hidden>Retry</button><button id="watch-picker-close">Close</button></dialog>`;document.body.append(host);
 const $=selector=>host.querySelector(selector), opener=$('#fixture-open'),dialog=$('dialog');
 const state={preferences:{region:'NG',formats:['movie','series'],genres:{movie:[18],series:[77]}},library:[{catalogueId:'tmdb:movie:99',title:'Fixture liked',liked:true}],dismissed:['tmdb:movie:98']};
 const before=JSON.stringify(state);let writes=0,subscriber,mode='normal',calls=[],pending;
 const item=(id,extra={})=>({catalogueId:`tmdb:movie:${id}`,tmdbId:id,title:`Synthetic ${id}`,format:'movie',year:'2001',overview:'Synthetic overview',posterUrl:null,genreIds:[18],...extra});
 const store={getState:()=>structuredClone(state),subscribe:fn=>{subscriber=fn;return()=>{};},transact:()=>writes++};
 const loadBatch=async(p,options)=>{calls.push({p,options});if(mode==='late')return new Promise(r=>{pending=r;});if(mode==='error')throw Error('Synthetic source unavailable');if(mode==='empty')return {candidates:[],errors:[],hasMore:false};return {candidates:[item(99),item(98),item(97,{adult:true}),item(1,{relatedTo:['tmdb:movie:99']}),item(2),item(3,{format:'series',catalogueId:'tmdb:series:3',genreIds:[77]})],errors:mode==='partial'?[Error('Partial')]:[],hasMore:false};};
 const picker=mountWatchPicker({dialog,opener,store,loadBatch,random:()=>0,fetchImpl:async()=>({ok:true,json:async()=>({movie:[{id:18,name:'Drama'}],series:[{id:77,name:'Drama'}]})})});
 const ready=()=>wait(()=>!$('#watch-picker-result').getAttribute('aria-busy')||$('#watch-picker-result').getAttribute('aria-busy')==='false');
 try {
  opener.click();await wait(()=>$('.library-card'));check(document.activeElement===$('#watch-picker-heading'),'open focuses heading');check($('.library-card').dataset.catalogueId==='tmdb:movie:1','default likes personalize and exclusions apply');check($$('.library-card').length===1,'one pick');
  check($('.card-open').getAttribute('href')===$('#watch-picker-result a[data-picker-details]').getAttribute('href'),'cover and details identity');
  check(Boolean($('.card-body .watch-picker-overview')),'summary stays beside the cover in the single-title card');
  $('#watch-picker-next').focus();$('#watch-picker-next').click();await ready();check($('.library-card').dataset.catalogueId!=='tmdb:movie:1','next does not repeat');
  check($('#watch-picker-status').textContent.includes($('.library-card h3').textContent)&&document.activeElement===$('#watch-picker-next'),'new cached pick is announced without taking button focus');
  $('#watch-picker-format').value='series';$('#watch-picker-format').dispatchEvent(new Event('change'));$('#watch-picker-genre').value='drama';$('#watch-picker-apply').click();await wait(()=>$('.library-card')?.dataset.catalogueId==='tmdb:series:3');check(calls.at(-1).options.page===1,'filter starts new source session');
  $('#watch-picker-next').click();await ready();check(!$('.library-card')&&/exhaust|No (more|eligible)/i.test($('#watch-picker-status').textContent),'honest exhaustion');
  picker.close();check(document.activeElement===opener,'close returns focus');check(writes===0&&JSON.stringify(state)===before,'browsing never writes preferences history or dislikes');
  mode='error';picker.open();await wait(()=>!$('#watch-picker-retry').hidden);check(/unavailable|failed|Could not/i.test($('#watch-picker-status').textContent),'API error visible');mode='partial';$('#watch-picker-retry').click();await wait(()=>$('.library-card'));check(/some|partial|source/i.test($('#watch-picker-status').textContent),'partial failure keeps pick and warning');picker.close();
  mode='empty';picker.open();await wait(()=>/No eligible|empty|No picks/i.test($('#watch-picker-status').textContent));check(!$('.library-card'),'valid empty not fabricated');picker.close();
  mode='late';picker.open();await wait(()=>pending);picker.close();pending({candidates:[item(66)],errors:[],hasMore:false});await new Promise(r=>setTimeout(r,30));check(!$('.library-card'),'late completion after close ignored');
  store.loadError=Error('Synthetic corrupt state');const count=calls.length;picker.open();await new Promise(r=>setTimeout(r,20));check(calls.length===count&&Boolean($('#watch-picker-result a[href="setup.html"]')),'corrupt store blocks recommendation with the real Settings recovery route');picker.close();
  check(writes===0,'all paths remain read only');return {passed:checks.length,checks};
 }finally{picker.destroy();host.remove();}
 function $$(selector){return [...host.querySelectorAll(selector)];}
}
