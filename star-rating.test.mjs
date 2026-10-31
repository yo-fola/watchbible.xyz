import test from 'node:test';
import assert from 'node:assert/strict';
import * as cards from './film-card.mjs';
class Element extends EventTarget {
  constructor(tag) { super(); this.tagName=tag; this.children=[];this.dataset={};this.attributes={}; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key,value) { this.attributes[key]=String(value); }
}
const doc={createElement:tag=>new Element(tag)};
const all=(node,tag)=>[...(node.tagName===tag?[node]:[]),...node.children.flatMap(child=>all(child,tag))];
test('five-star controls expose distinct native radio groups and no inferred initial score',()=>{
  assert.equal(typeof cards.createStarRating,'function');
  const a=cards.createStarRating({document:doc}),b=cards.createStarRating({document:doc});
  const radios=all(a.element,'input');
  assert.equal(radios.length,5);assert.ok(radios.every(r=>r.type==='radio'&&!r.checked));
  assert.equal(new Set(radios.map(r=>r.name)).size,1);
  assert.notEqual(radios[0].name,all(b.element,'input')[0].name);
  assert.match(all(a.element,'output')[0].textContent,/Not rated/);
});
test('rating, clearing, rollback and disabled states keep explicit action semantics',()=>{
  assert.equal(typeof cards.createStarRating,'function');
  const calls=[];let accept=true;
  const widget=cards.createStarRating({document:doc,onChange:value=>{calls.push(value);return accept;}});
  const radios=all(widget.element,'input'),clear=all(widget.element,'button')[0];
  radios[3].dispatchEvent(new Event('change'));assert.deepEqual(calls,[4]);assert.equal(radios[3].checked,true);
  assert.match(all(widget.element,'output')[0].textContent,/4.*5/);
  accept=false;radios[1].dispatchEvent(new Event('change'));assert.equal(radios[3].checked,true);assert.equal(radios[1].checked,false);
  accept=true;clear.dispatchEvent(new Event('click'));assert.equal(calls.at(-1),null);assert.ok(radios.every(r=>!r.checked));
  widget.update({value:5,disabled:true});radios[0].dispatchEvent(new Event('change'));assert.equal(calls.at(-1),null);assert.ok(radios.every(r=>r.disabled));
  widget.update({value:3.75,disabled:false});assert.match(all(widget.element,'output')[0].textContent,/3\.75/);
});
