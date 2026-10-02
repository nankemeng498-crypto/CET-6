// 开发检查：无需安装依赖，运行 node tests.cjs。
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class MemoryDB {
  constructor(){this.stores={words:new Map(),days:new Map(),meta:new Map()};}
  transaction(names){
    const tx={objectStore:name=>({
      getAll:()=>this.result([...this.stores[name].values()]),
      get:key=>this.result(this.stores[name].get(key)),
      put:value=>{const key=value[{words:'word',days:'date',meta:'key'}[name]];this.stores[name].set(key,structuredClone(value));},
      clear:()=>this.stores[name].clear()
    }),abort:()=>{tx.aborted=true;queueMicrotask(()=>tx.onabort?.());}};
    setTimeout(()=>{if(!tx.aborted)tx.oncomplete?.();},0);return tx;
  }
  result(value){const r={result:structuredClone(value)};queueMicrotask(()=>r.onsuccess?.());return r;}
}
let exported;
const context=vm.createContext({console,structuredClone,Blob,TextDecoder,TextEncoder,URL:{createObjectURL:blob=>{exported=blob;return 'blob:test';},revokeObjectURL:()=>{}},setTimeout:(fn,ms)=>{if(ms<1000)return setTimeout(fn,ms);},clearTimeout,MemoryDB,assert,seed:JSON.parse(fs.readFileSync('sample-words.json','utf8')),localStorage:{getItem:()=>null,setItem:()=>{}},document:{querySelector:()=>({}),addEventListener:()=>{},body:{append:()=>{}},createElement:()=>({click:()=>{},remove:()=>{}})},window:{addEventListener:()=>{}},location:{hash:'#study'},confirm:()=>true,getExported:async()=>JSON.parse(await exported.text())});
const source=fs.readFileSync('app.js','utf8').replace(/init\(\)\.catch\([\s\S]*$/,'');
vm.runInContext(source,context);
vm.runInContext(`(async()=>{
  db=new MemoryDB();render=()=>{};notify=()=>{};
  await importWords(seed);assert.equal(words.length,20);
  assert.ok(words.every(w=>w.frequency===null&&w.level===''&&w.source===''));
  settings.dailyNew=2;await start();assert.equal(session.queue.length,2);
  const first=session.queue[0];revealed=true;await answer(0);
  assert.equal(session.queue[session.queue.length-1],first);assert.equal(session.queue.length,2);
  assert.equal(words.find(w=>w.word===first).mastery,0);
  revealed=true;await answer(2);assert.equal(todayRecord().newWords,2);
  revealed=true;await answer(2);assert.equal(session.queue.length,0);
  const learned=words.find(w=>w.word===first);assert.equal(learned.mastery,1);assert.equal(learned.reviewCount,2);assert.equal(todayRecord().completedWords,2);
  assert.ok(Date.parse(learned.nextReview)>Date.now()+20*60*60*1000);
  const before=JSON.stringify(learned);await importWords([{word:first.toUpperCase(),meaning:'不应覆盖',example:'不应覆盖'}]);assert.equal(JSON.stringify(words.find(w=>w.word===first)),before);
  const progressKeys=['mastery','reviewCount','lastReview','nextReview','favorite','createdAt'];
  const progressBefore=JSON.stringify(progressKeys.map(k=>learned[k]));
  await importWords([{word:first.toUpperCase(),meaning:'不应覆盖',frequency:0,level:'CET-6',source:'测试词库'}]);
  let enriched=words.find(w=>w.word===first);assert.equal(enriched.frequency,0);assert.equal(enriched.level,'CET-6');assert.equal(enriched.source,'测试词库');assert.equal(JSON.stringify(progressKeys.map(k=>enriched[k])),progressBefore);
  await importWords([{word:first,meaning:'不应覆盖',frequency:99,level:'CET-4',source:'其他来源'}]);
  enriched=words.find(w=>w.word===first);assert.equal(enriched.frequency,0);assert.equal(enriched.level,'CET-6');assert.equal(enriched.source,'测试词库');assert.equal(JSON.stringify(progressKeys.map(k=>enriched[k])),progressBefore);
  const legacyCsv=parseCSV('word,phonetic,meaning,example,exampleZh\\nlegacy,,旧词库,,');assert.equal(normalizeWord(legacyCsv[0]).frequency,null);
  assert.equal(parseJSON('\\uFEFF[{"word":"bom","meaning":"测试"}]')[0].word,'bom');
  assert.equal(await readFileText({arrayBuffer:async()=>new TextEncoder().encode('中文').buffer}),'中文');await assert.rejects(()=>readFileText({arrayBuffer:async()=>new Uint8Array([255]).buffer}),/UTF-8/);
  for(const invalidCsv of ['word,word,meaning\\na,b,c','word,meaning\\na,b,c','word,meaning\\na,"b"trailing'])assert.throws(()=>parseCSV(invalidCsv));
  assert.equal(validDay('2026-02-30'),false);assert.throws(()=>normalizeDate(123));
  assert.throws(()=>normalizeWord({word:'test',meaning:'测试',source:{name:'无效'}}));
  const pair={example:'First sentence.',exampleZh:''};mergeDictionary(pair,{example:'Other sentence.',exampleZh:'另一句。'});assert.equal(pair.exampleZh,'');mergeDictionary(pair,{example:'First sentence.',exampleZh:'第一句。'});assert.equal(pair.exampleZh,'第一句。');
  const csv=parseCSV('word,phonetic,meaning,example,exampleZh,frequency,level,source\\r\\n"test",,"测试","A, B and ""C"".\\nNext line",例句,12.5,CET-6,"CSV, source"');assert.equal(csv[0].example,'A, B and "C".\\nNext line');
  await importWords(csv);assert.equal(words.length,21);
  const csvWord=words.find(w=>w.word==='test');assert.equal(csvWord.frequency,12.5);assert.equal(csvWord.level,'CET-6');assert.equal(csvWord.source,'CSV, source');
  const overdue={...enriched,nextReview:new Date(Date.now()-1000).toISOString()};await transaction(['words'],tx=>tx.objectStore('words').put(overdue));await reload();assert.equal(plan().reviews[0].word,first);
  settings={dailyNew:50,autoSpeak:false,gestures:true};saveSettings(settings,true);await exportData();const backup=await getExported();assert.equal(backup.words.length,21);assert.equal(backup.records.length,1);assert.equal(backup.format,'cet6-backup');
  await restoreData(backup);assert.equal(settings.dailyNew,50);assert.equal(words.length,21);assert.equal(todayRecord().completedWords,2);
  assert.equal(JSON.stringify(words),JSON.stringify(backup.words));
  const oldBackup=structuredClone(backup);oldBackup.words.forEach(w=>{delete w.frequency;delete w.level;delete w.source;});await restoreData(oldBackup);assert.ok(words.every(w=>w.frequency===null&&w.level===''&&w.source===''));assert.equal(todayRecord().completedWords,2);
  await restoreData(backup);assert.equal(words.find(w=>w.word===first).frequency,0);assert.equal(words.find(w=>w.word==='test').source,'CSV, source');
  const invalid=structuredClone(backup);invalid.words[0].mastery=99;let rejected=false;try{await restoreData(invalid);}catch{rejected=true;}assert.equal(rejected,true);assert.equal(words.length,21);
  session=await request(db.transaction('meta').objectStore('meta').get('session'));assert.equal(session.answered,3);
  await resetProgress();assert.equal(words.length,21);assert.ok(words.every(w=>w.reviewCount===0));assert.equal(records.length,0);
  db=new MemoryDB();await importWords(Array.from({length:12},(_,i)=>({word:'fair'+i,meaning:'队列测试'})));settings.dailyNew=12;await start();for(let i=0;i<36;i++){revealed=true;await answer(0);}assert.equal(todayRecord().completedWords,12,'连续不认识不应困在前几个词');
  const manual={...normalizeWord({word:'manual',meaning:'手动调整'}),mastery:1,nextReview:new Date(Date.now()+86400000).toISOString()};assert.equal(plan([manual],emptyRecord()).fresh.length,0);assert.equal(plan([manual],emptyRecord()).weak.length,0);
  const futureIds=words.slice(0,9).map(w=>w.word);records.push({...emptyRecord(shiftDay(1)),newWords:9,completedWords:9,studySessions:1,completedIds:futureIds,newIds:futureIds});assert.ok(me().includes('<strong>12</strong><span>近 7 天学习</span>'),'本周统计不应包含未来记录');
  console.log('PASS: legacy JSON/CSV, optional metadata, JSON/CSV metadata persistence, zero frequency, duplicate progress preservation, old/new backup round trip, queue, repetition, schedule, daily counts, persistence, reset');
})()`,context).catch(e=>{console.error(e);process.exitCode=1;});
