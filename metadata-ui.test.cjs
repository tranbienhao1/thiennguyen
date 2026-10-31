'use strict';

const assert = require('node:assert/strict');
const metadata = require('./metadata-utils.js');
const {create} = require('./metadata-ui.js');
const callbacks = new Map();
const fakeButtons = [];
const element = id => ({id,dataset:{},value:'',textContent:'',innerHTML:'',children:[],attributes:{},classList:{values:new Set(),add(name){this.values.add(name);},remove(name){this.values.delete(name);},toggle(name,force){const next=force===undefined?!this.values.has(name):force;next?this.values.add(name):this.values.delete(name);return next;},contains(name){return this.values.has(name);}},replaceChildren(){this.children=[];this.innerHTML='';},querySelectorAll(selector){return selector === '[data-result]' ? this.children.filter(child => child.dataset.result !== undefined) : selector === '[data-metadata-follow]' ? fakeButtons : this.children;},addEventListener(type,fn){callbacks.set(`${id}:${type}`,fn);},setAttribute(name,value){this.attributes[name]=value;}});
const elements = new Map();
const getElement = id => { if(!elements.has(id))elements.set(id,element(id)); return elements.get(id); };
const tabs = ['track','album','artist'].map(kind=>{const tab=element(`tab-${kind}`);tab.dataset.metadataKind=kind;return tab;});
global.document = {body:{classList:{add(){},remove(){}}},querySelectorAll(selector){return selector==='[data-metadata-kind]'?tabs:[];},addEventListener(type,fn){callbacks.set(`document:${type}`,fn);}};
const calls=[];
const client={
  async search(kind,track,query){calls.push(['search',kind,track.title,query]);return [{id:'11111111-1111-4111-8111-111111111111',title:'Song',score:100,'artist-credit':[{name:'Artist'}]}];},
  async details(kind){calls.push(['details',kind]);return {id:'11111111-1111-4111-8111-111111111111',title:'Song','artist-credit':[{name:'Artist'}],relations:[],releases:[]};},
  async coverArt(){return null;}, async wikipediaSummary(){return null;}
};
const ui=create({getElement,library:{trackMetadata:track=>track},client});
ui.open({title:'Song',artist:'Artist',album:'Album'});
setImmediate(async()=>{
  assert.ok(calls.some(call=>call[0]==='search'&&call[1]==='track'));
  assert.ok(getElement('metadata-results').innerHTML.includes('Song'));
  assert.equal(getElement('metadata-query').placeholder,'Tìm tên khác hoặc phiên bản...');
  assert.ok(getElement('metadata-results').innerHTML.includes('metadata-result-art'));
  await ui.detail('track',{id:'11111111-1111-4111-8111-111111111111',title:'Song'});
  assert.ok(getElement('metadata-detail').innerHTML.includes('Credits'));
  client.details=async kind=>kind==='album'?{id:'22222222-2222-4222-8222-222222222222',title:'Album',date:'2020','artist-credit':[{name:'Artist'}],media:[{position:1,tracks:[{position:1,title:'Song',length:180000}]}],relations:[]}:{id:'33333333-3333-4333-8333-333333333333',name:'Artist',type:'Person','life-span':{begin:'1990'},relations:[{type:'wikipedia',url:{resource:'https://en.wikipedia.org/wiki/Artist'}}],'release-groups':[]};
  client.coverArt=async()=>({url:'https://coverartarchive.org/front.jpg',thumbnail:'https://coverartarchive.org/front-500.jpg'});
  client.wikipediaSummary=async()=>({extract:'Verified artist biography.',thumbnail:'https://upload.wikimedia.org/artist.jpg',page:'https://en.wikipedia.org/wiki/Artist'});
  await ui.detail('album',{id:'22222222-2222-4222-8222-222222222222',title:'Album'});
  assert.ok(getElement('metadata-detail').innerHTML.includes('Danh sách bài hát'));
  assert.ok(getElement('metadata-detail').innerHTML.includes('coverartarchive.org'));
  assert.ok(getElement('metadata-detail').innerHTML.includes('Song'));
  await ui.detail('artist',{id:'33333333-3333-4333-8333-333333333333',name:'Artist'});
  assert.ok(getElement('metadata-detail').innerHTML.includes('Verified artist biography.'));
  const relatedButton={dataset:{metadataId:'44444444-4444-4444-8444-444444444444',metadataTitle:'Related artist',metadataFollow:'artist'},textContent:'Related artist',addEventListener(type,fn){callbacks.set('related-artist',fn);}};
  fakeButtons[0]=relatedButton;
  client.details=async kind=>({id:'33333333-3333-4333-8333-333333333333',name:'Artist',type:'Person',relations:[]});
  await ui.detail('artist',{id:'33333333-3333-4333-8333-333333333333',name:'Artist'});
  assert.equal(getElement('metadata-back').textContent,'← Kết quả');
  client.details=async kind=>({id:'44444444-4444-4444-8444-444444444444',name:'Related artist',type:'Person',relations:[]});
  callbacks.get('related-artist')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(getElement('metadata-title').textContent,'Related artist');
  assert.equal(getElement('metadata-tabs').classList.contains('hidden'),true,'Cross-linked artist pages hide tabs while preserving navigation context');
  assert.equal(getElement('metadata-back').textContent,'← Quay lại');
  callbacks.get('metadata-back:click')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(getElement('metadata-title').textContent,'Artist','Back should restore the previous artist detail');
  assert.equal(getElement('metadata-tabs').classList.contains('hidden'),false);
  const staleResolve=[];
  client.search=(kind)=>new Promise(resolve=>staleResolve.push({kind,resolve}));
  ui.open({title:'Old'});
  ui.search();
  ui.close();
  const old=staleResolve[0];
  old.resolve([{id:'stale',title:'Must not render'}]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(!getElement('metadata-results').innerHTML.includes('Must not render'),'Closing invalidates pending search rendering');
  delete global.document;
  console.log('Metadata dialog interaction, detail rendering and stale-request tests passed.');
});
