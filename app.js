'use strict';
const $ = s => document.querySelector(s);
const LABELS = ['陌生', '初识', '模糊', '熟悉', '已掌握'];
const BOOKS = {cet4:'CET-4 四级核心词汇',cet6:'CET-6 六级词汇'};
let activeBook='cet6', activeBookExplicit=false;
const DEFAULTS = {dailyNew:40, autoSpeak:false, gestures:false};
let settings = {...DEFAULTS}, db, words = [], records = [], session = null, revealed = false, busy = false, listLimit = 80;
let savedSettings, visibleDay = day(), refreshPending = false, clockTimer, utterance = null, appReady = false;
try { settings = validateSettings(JSON.parse(localStorage.getItem('cet6-settings') || '{}')); } catch (_) {}
savedSettings = {...settings};
loadBookChoice();
function loadBookChoice() {
  try {const saved=localStorage.getItem('activeBook');activeBookExplicit=Object.hasOwn(BOOKS,saved);if(activeBookExplicit)activeBook=saved;} catch (_) {}
}
function bookLevel(w) { const level=String(w.level||'').toLowerCase().replace(/[\s_-]/g,'');return level==='cet4'?'cet4':'cet6'; }
function bookWords(list=words,book=activeBook) { return list.filter(w=>bookLevel(w)===book); }
function resolveActiveBook() {
  if(activeBookExplicit)return;
  const cet6=words.some(w=>bookLevel(w)==='cet6'&&(String(w.level||'').toLowerCase().replace(/[\s_-]/g,'')==='cet6'||!isNew(w)));
  activeBook=!cet6&&words.some(w=>bookLevel(w)==='cet4')?'cet4':'cet6';
}
function inferSessionBook(saved,list=words) {
  if(Object.hasOwn(BOOKS,saved?.book))return saved.book;
  const first=list.find(w=>w.word===saved?.queue?.[0]);return first?bookLevel(first):'cet6';
}
function sessionForBook(saved,list=words,book=activeBook) {
  if(!saved)return null;
  const rootBook=inferSessionBook(saved,list), item=rootBook===book?saved:saved.otherSessions?.[book];
  // 兼容旧版混合队列：仅显示属于当前书的项；实际作答时再保存分开的队列。
  const legacyMixed=!saved.book&&saved.queue.some(id=>list.some(w=>w.word===id&&bookLevel(w)!==rootBook));
  const candidate=item||legacyMixed&&saved;
  if(!candidate)return null;
  const ids=new Set(bookWords(list,book).map(w=>w.word));
  const result={...candidate,queue:candidate.queue.filter(id=>ids.has(id))};
  delete result.otherSessions;
  if(legacyMixed&&rootBook!==book){result.answered=0;result.total=result.queue.length;}
  return result;
}
function saveBookSession(saved,next,book,list) {
  if(!saved)return {...next,key:'session',book};
  const rootBook=inferSessionBook(saved,list);
  let root={...saved,book:rootBook};
  if(!saved.book){
    root={...root,...sessionForBook(saved,list,rootBook),book:rootBook};
    const other=rootBook==='cet6'?'cet4':'cet6',oldOther=sessionForBook(saved,list,other);
    if(oldOther)root.otherSessions={...saved.otherSessions,[other]:oldOther};
  }
  return book===rootBook?{...root,...next,key:'session',book}:{...root,otherSessions:{...root.otherSessions,[book]:{...next,book}}};
}
function recordForBook(rec,list=words,book=activeBook) {
  if(!Array.isArray(rec.completedIds))return book==='cet6'?{...rec}:emptyRecord(rec.date);
  const ids=new Set(bookWords(list,book).map(w=>w.word)), filter=key=>(rec[key]||[]).filter(id=>ids.has(id));
  const completedIds=filter('completedIds'),newIds=filter('newIds'),reviewIds=filter('reviewIds');
  const oldBook=rec.completedIds.length?bookLevel(list.find(w=>w.word===rec.completedIds[0])||{}):list.some(w=>bookLevel(w)==='cet4')&&!list.some(w=>bookLevel(w)==='cet6')?'cet4':'cet6';
  return {...rec,completedIds,newIds,reviewIds,completedWords:completedIds.length,newWords:newIds.length,reviewWords:reviewIds.length,studySessions:rec.bookSessions?.[book]??(book===oldBook?rec.studySessions:0)};
}
function recordBookSession(rec,list,book) {
  if(!rec.bookSessions)rec.bookSessions={cet4:recordForBook(rec,list,'cet4').studySessions,cet6:recordForBook(rec,list,'cet6').studySessions};
  rec.bookSessions[book]=(rec.bookSessions[book]||0)+1;rec.studySessions++;
}
async function switchBook(book) {
  if(!Object.hasOwn(BOOKS,book))throw new Error('词书无效');
  if(busy){notify('正在保存，请稍后切换');return false;}
  try {localStorage.setItem('activeBook',book);} catch (_) {notify('词书选择未能保存，请检查浏览器存储权限');render();return false;}
  stopSpeaking();activeBook=book;activeBookExplicit=true;revealed=false;listLimit=80;
  await reload();if(location.hash.startsWith('#word/'))location.hash='library';render();return true;
}
function validateSettings(s, strict=false) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) { if(strict) throw new Error('备份设置格式无效'); s={}; }
  if(strict && (s.dailyNew!==undefined && (!Number.isInteger(s.dailyNew)||s.dailyNew<1||s.dailyNew>1000) || ['autoSpeak','gestures'].some(k=>s[k]!==undefined&&typeof s[k]!=='boolean'))) throw new Error('备份设置格式无效');
  return {dailyNew:Number.isInteger(s.dailyNew) && s.dailyNew > 0 && s.dailyNew <= 1000 ? s.dailyNew : 40, autoSpeak:s.autoSpeak === true, gestures:s.gestures === true};
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function day(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function shiftDay(n) { const d = new Date(); d.setDate(d.getDate()+n); return day(d); }
function notify(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(notify.timer); notify.timer = setTimeout(() => $('#toast').style.display = 'none', 3500); }
function request(r) { return new Promise((resolve,reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function transaction(stores, fn) {
  const tx = db.transaction(stores, 'readwrite');
  let failure;
  const done = new Promise((resolve,reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(failure || tx.error || new Error('保存已取消')); });
  // 在请求回调里读最新值后写入，避免 Safari 事务提前关闭及旧页面覆盖新进度。
  const read = (requests, callback) => {
    const values = []; let left = requests.length;
    requests.forEach((r,i) => { r.onsuccess = () => { values[i]=r.result; if(--left===0) { try { callback(...values); } catch(e) { failure=e; tx.abort(); } } }; });
  };
  try { fn(tx, read); } catch (e) { failure=e; tx.abort(); }
  await done;
}
async function all(store) { return request(db.transaction(store).objectStore(store).getAll()); }
async function snapshot() {
  if(!db)db=await openDatabase();
  const tx=db.transaction(['words','days','meta']);
  const [wordList,dayList,meta]=await Promise.all(['words','days','meta'].map(s=>request(tx.objectStore(s).getAll())));
  return {words:wordList,records:dayList,meta};
}
async function reload() {
  const data=await snapshot(), next=data.meta.find(m=>m.key==='session');
  words=data.words;records=data.records;resolveActiveBook();
  const scoped=sessionForBook(next,words);
  if(session?.date!==scoped?.date||session?.answered!==scoped?.answered||session?.queue[0]!==scoped?.queue[0])revealed=false;
  session=scoped?.date===day()?scoped:null;visibleDay=day();if(appReady)scheduleClock();
}
function emptyRecord(date=day()) { return {date,newWords:0,reviewWords:0,completedWords:0,studySessions:0,completedIds:[],newIds:[],reviewIds:[]}; }
function todayRecord() { return recordForBook(records.find(r => r.date === day()) || emptyRecord()); }
function isNew(w) { return w.reviewCount===0 && w.mastery===0 && !w.nextReview; }
function due(w, now=Date.now()) { return !isNew(w) && w.nextReview && Date.parse(w.nextReview)<=now; }
function plan(wordList=words, rec=todayRecord(), now=new Date()) {
  rec=recordForBook(rec,wordList);wordList=bookWords(wordList);
  const completed = new Set(rec.completedIds), time=now.getTime();
  const reviews = wordList.filter(w => due(w,time)).sort((a,b)=>Date.parse(a.nextReview)-Date.parse(b.nextReview));
  const weak = wordList.filter(w => !isNew(w) && w.mastery <= 1 && !due(w,time) && !completed.has(w.word) && w.lastReview && day(new Date(w.lastReview)) < day(now)).sort((a,b)=>a.mastery-b.mastery);
  const fresh = wordList.filter(isNew).slice(0, Math.max(0, settings.dailyNew-rec.newWords));
  return {reviews,weak,fresh};
}
function streak(dayList=records) {
  const active = new Set(dayList.filter(r=>recordForBook(r).completedWords > 0).map(r=>r.date));
  const d = new Date(); if (!active.has(day(d))) d.setDate(d.getDate()-1);
  let n = 0; while(active.has(day(d))) { n++; d.setDate(d.getDate()-1); } return n;
}
function dateText(s) { return s ? new Date(s).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '尚未学习'; }
let speechRequest = 0, speechVoiceWait = null, speechUnsupportedNotified = false;
function clearSpeechVoiceWait() {
  if (!speechVoiceWait) return;
  const wait = speechVoiceWait; speechVoiceWait = null;
  clearTimeout(wait.timer);
  try { wait.synth.removeEventListener('voiceschanged', wait.listener); } catch (_) {}
}
function englishSpeechVoice(synth) {
  let voices = [];
  try { voices = Array.from(synth.getVoices?.() || []); } catch (_) {}
  const lang = v => String(v.lang || '').replace(/_/g, '-').toLowerCase();
  return {voices, voice:voices.find(v=>lang(v)==='en-us') || voices.find(v=>lang(v)==='en-gb') || voices.find(v=>/^en(?:-|$)/.test(lang(v)))};
}
function speak(word) {
  const synth = window.speechSynthesis, Utterance = window.SpeechSynthesisUtterance;
  if (!synth || typeof synth.speak !== 'function' || typeof Utterance !== 'function') {
    if (!speechUnsupportedNotified) {
      speechUnsupportedNotified = true;
      notify('当前浏览器不支持网页发音，建议使用 Microsoft Edge 或 Chrome 打开 WORDS。');
    }
    return;
  }
  stopSpeaking();
  if (document.hidden || !String(word || '').trim()) return;
  const requestId = speechRequest;
  const fail = () => notify('语音暂不可用，请点击发音按钮重试');
  try {
    const choice = englishSpeechVoice(synth);
    let started = false;
    const play = voice => {
      const u = new Utterance(String(word)); utterance = u;
      u.lang = voice?.lang || 'en-US'; u.rate = .85;
      if (voice) u.voice = voice;
      u.onstart = () => { if (utterance===u) { started=true; clearSpeechVoiceWait(); } };
      u.onend = () => { if (utterance===u) { utterance=null; clearSpeechVoiceWait(); } };
      u.onerror = e => {
        if (utterance!==u) return;
        utterance=null; clearSpeechVoiceWait();
        if (!['canceled','interrupted'].includes(e.error)) fail();
      };
      // 保持点击调用栈内的默认尝试；不把异步空 voice 列表视为不支持。
      synth.speak(u);
    };
    if (!choice.voices.length && typeof synth.addEventListener==='function') {
      const listener = () => {
        if (speechVoiceWait?.listener!==listener || requestId!==speechRequest || !utterance || document.hidden || started) return;
        const next = englishSpeechVoice(synth);
        if (!next.voice) return;
        clearSpeechVoiceWait();
        // 不改变已提交 utterance；只替换尚未开始的同一次请求。
        utterance=null;
        try { synth.cancel(); play(next.voice); } catch (_) { utterance=null; fail(); }
      };
      speechVoiceWait={synth,listener,timer:setTimeout(clearSpeechVoiceWait,2000)};
      synth.addEventListener('voiceschanged',listener);
    }
    play(choice.voice);
  } catch (_) { utterance=null; clearSpeechVoiceWait(); fail(); }
}
function stopSpeaking() {
  speechRequest++; clearSpeechVoiceWait(); utterance=null;
  try { window.speechSynthesis?.cancel(); } catch (_) {}
}

async function withWrite(fn) {
  if(busy){notify('正在保存，请稍后重试');return;}
  busy=true;
  try { if(!db)db=await openDatabase();return await fn(); } finally { busy=false;if(refreshPending){refreshPending=false;safe(refreshState);} }
}
function home() {
  const p = plan(), r = todayRecord(), pending=new Map([...p.reviews,...p.weak,...p.fresh].map(w=>[w.word,w]));
  if(session?.date===day())for(const id of session.queue){const w=bookWords().find(w=>w.word===id);if(w)pending.set(id,w);}
  p.fresh=[...pending.values()].filter(isNew);p.reviews=[...pending.values()].filter(w=>!isNew(w));p.weak=[];
  const remaining=pending.size;
  const percent = r.completedWords + remaining ? Math.round(r.completedWords/(r.completedWords+remaining)*100) : 0;
  return `<div class="eyebrow">YOUR DAILY PRACTICE</div><h1>WORDS</h1><p class="muted">每天一点，慢慢记住。</p><p class="caption">当前词书：${esc(BOOKS[activeBook])}</p><section class="panel"><div class="row"><h2>今日任务</h2><span class="caption">${new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric'})}</span></div><div class="metrics"><div class="metric"><strong>${p.reviews.length+p.weak.length}</strong><span>今日待复习</span></div><div class="metric"><strong>${p.fresh.length}</strong><span>今日新词</span></div><div class="metric"><strong>${r.completedWords}</strong><span>今日已完成</span></div></div><div class="row caption"><span>今日进度</span><span>${percent}%</span></div><progress value="${percent}" max="100"></progress><button class="primary wide" data-action="start">${session?.queue.length ? '继续今日学习' : '开始今日学习'} <span aria-hidden="true">→</span></button></section><div class="overview"><div class="stat"><span>连续学习</span><strong>${streak()} 天</strong></div><div class="stat"><span>当前总词数</span><strong>${bookWords().length}</strong></div><div class="stat"><span>已学习词</span><strong>${bookWords().filter(w=>!isNew(w)).length}</strong></div>${[0,2,3,4].map(n=>`<div class="stat"><span>${LABELS[n]}词</span><strong>${bookWords().filter(w=>w.mastery===n).length}</strong></div>`).join('')}</div><p class="tip">先回忆，再看答案。记不住的词，今天还会再见。<br>内置 20 个示例词，可在「我的」导入自己的词库。</p>`;
}
async function start() {
  return withWrite(async()=>{
    const startDay=day(),book=activeBook;
    await transaction(['words','meta','days'],(tx,read)=>read([tx.objectStore('words').getAll(),tx.objectStore('meta').get('session'),tx.objectStore('days').get(startDay)],(wordList,current,rec)=>{
      if(day()!==startDay)return;
      const scoped=sessionForBook(current,wordList,book);
      if(scoped?.date===day()&&scoped.queue.length)return;
      const r=rec||emptyRecord(),p=plan(wordList,r),queue=[...p.reviews,...p.weak,...p.fresh].map(w=>w.word);
      if(!queue.length)return;
      tx.objectStore('meta').put(saveBookSession(current,{key:'session',date:day(),queue,total:queue.length,answered:0},book,wordList));recordBookSession(r,wordList,book);tx.objectStore('days').put(r);
    }));
    await reload();revealed=false;visibleDay=day();
    if(location.hash!=='#study')location.hash='study';else{render();autoSpeak();}
  });
}
function autoSpeak() { if (settings.autoSpeak && session?.date===day() && session.queue.length && location.hash==='#study') speak(session.queue[0]); }
function importanceHTML(w) {
  const level=w.level?.toLowerCase(),hasPriority=level==='cet4'&&Number.isInteger(w.studyPriority)&&w.studyPriority>=1&&w.studyPriority<=5;
  const stars=hasPriority?w.studyPriority:w.importance,label=hasPriority?'四级学习优先级':level==='cet4'?'四级重要度':level==='cet6'?'六级重要度':'';
  return label&&Number.isInteger(stars)&&stars>=1&&stars<=5 ? `<div class="importance" aria-label="${label} ${stars} 星"><span aria-hidden="true">${'★'.repeat(stars)}${'☆'.repeat(5-stars)}</span><small>${label}</small></div>` : '';
}
function wordMetadata(w,full=false) {
  // 核心词性随答案一起呈现，避免展示全量词典词性或重复占据屏幕。
  const pos=full?w.pos:w.coreMeaning?.trim()?'':w.corePos||w.pos;
  return `${w.phonetic?.trim()?`<div class="phonetic">${esc(w.phonetic)}</div>`:''}${pos?.trim()?`<div class="word-pos">${esc(pos)}</div>`:''}${importanceHTML(w)}`;
}
function meaningHTML(w,full=false) {
  // 仅按来源已有的换行排版；不将未标注的中文意思猜配给某个词性。
  const meaning=!full&&w.coreMeaning?.trim()?`${w.corePos?.trim()?w.corePos+' ':''}${w.coreMeaning}`:w.meaning;
  return meaning.split(/\r?\n/).filter(line=>line.trim()).map(line=>`<div class="meaning-line">${esc(line)}</div>`).join('');
}
function answerHTML(w,full=false) {
  return `<div class="answer"><div class="meaning">${meaningHTML(w,full)}</div>${w.example?.trim()?`<p class="example" lang="en">${esc(w.example)}</p>`:''}${w.exampleZh?.trim()?`<p class="muted example-zh">${esc(w.exampleZh)}</p>`:''}${full&&w.definition?.trim()?`<div class="dictionary-definition"><span class="caption">英文释义 · 完整词典义项</span><p class="example" lang="en">${esc(w.definition)}</p></div>`:''}<span class="badge">当前状态 · ${LABELS[w.mastery]}</span></div>`;
}
function study() {
  const waiting=bookWords().some(w=>w.nextReview&&Date.parse(w.nextReview)>Date.now()&&Date.parse(w.nextReview)<=Date.now()+10*60000);
  if (!session || session.date !== day() || !session.queue.length) return `<div class="eyebrow">ONE WORD AT A TIME</div><h1>留一点时间，给记忆。</h1><section class="panel empty"><p>${session?.answered ? waiting?'本轮暂告一段落，稍后可再练未记住的词。':'本轮学习完成，做得不错。' : '准备好开始今天的学习了吗？'}</p><button class="primary wide" data-action="start">开始今日学习</button></section><p class="tip">到期复习优先，其次是容易遗忘的词，最后是新词。</p>`;
  const w = bookWords().find(w=>w.word===session.queue[0]); if (!w) return '<p>词库记录缺失，请重新开始学习。</p>';
  return `<div class="study-head row"><span class="caption">今日学习</span><strong>${session.answered+1} / ${session.answered+session.queue.length}</strong></div><progress value="${session.answered}" max="${session.answered+session.queue.length}"></progress><section id="word-card" class="panel word-card ${revealed?'revealed':''}"><div id="gesture-zone" class="${settings.gestures&&revealed?'gesture-surface':''}"><span class="badge">${w.reviewCount?'复习单词':'新单词'}</span><h1 class="word">${esc(w.word)}</h1>${wordMetadata(w)}<div class="word-tools"><button class="icon" data-action="speak" data-word="${esc(w.word)}" aria-label="朗读单词">♪</button><button class="icon" data-action="favorite" data-word="${esc(w.word)}" aria-label="${w.favorite?'取消收藏':'收藏单词'}" aria-pressed="${w.favorite}">${w.favorite?'★':'☆'}</button></div></div>${revealed?answerHTML(w):'<p class="tip">想一想，它是什么意思？</p>'}</section><p class="caption" style="text-align:center">${settings.gestures?'答案显示后：左滑不认识 · 上滑模糊 · 右滑认识':'按自己的记忆情况选择，不用急。'}</p><div class="actions"><div class="actions-inner">${revealed?'<button class="unknown" data-answer="0">不认识</button><button class="fuzzy" data-answer="1">模糊</button><button class="primary" data-answer="2">认识</button>':'<button class="primary" data-action="reveal">显示答案</button>'}</div></div>`;
}
async function answer(value) {
  if (busy || !revealed || !session?.queue.length || ![0,1,2].includes(value)) return;
  if(session.date!==day()){await refreshState();return;}
  const expected={date:session.date,answered:session.answered,word:session.queue[0],book:activeBook};
  return withWrite(async()=>{
    let changed=false;
    await transaction(['words','days','meta'],(tx,read)=>read([tx.objectStore('words').get(expected.word),tx.objectStore('days').get(expected.date),tx.objectStore('meta').get('session'),tx.objectStore('words').getAll()],(w,rec,saved,wordList)=>{
    const next=sessionForBook(saved,wordList,expected.book);
    if(!w||bookLevel(w)!==expected.book||activeBook!==expected.book||day()!==expected.date||next?.date!==expected.date||next.answered!==expected.answered||next.queue[0]!==expected.word)return;
    const wasNew=isNew(w), r=rec||emptyRecord(), now=new Date();
    w.mastery = value===0 ? Math.max(0,w.mastery-1) : value===2 ? Math.min(4,w.mastery+1) : Math.min(2,w.mastery);
    w.reviewCount++; w.lastReview = now.toISOString();
    const interval = value===0 ? 0 : [0,1,3,7,15][w.mastery];
    const reviewDate = new Date(now); if (!interval) reviewDate.setMinutes(reviewDate.getMinutes()+10); else reviewDate.setDate(reviewDate.getDate()+interval);
    w.nextReview = reviewDate.toISOString(); next.queue.shift(); next.answered++;
    // 新词首次遗忘隔 5 个词重现，之后放队尾，避免前几个词循环挤占整个队列。
    // 最后只剩这个词时，按 nextReview 稍后再练，避免连续重复。
    if (value===0&&next.queue.length) next.queue.splice(wasNew?Math.min(5,next.queue.length):next.queue.length,0,w.word);
    if (!r.completedIds.includes(w.word)) { r.completedIds.push(w.word); r.completedWords++; if (wasNew) {r.newWords++;r.newIds.push(w.word);} else {r.reviewWords++;r.reviewIds.push(w.word);} }
    tx.objectStore('words').put(w);tx.objectStore('days').put(r);tx.objectStore('meta').put(saveBookSession(saved,next,expected.book,wordList));changed=true;
    }));
    await reload();revealed=false;render();autoSpeak();if(!changed)notify('学习队列已更新，请重新查看当前单词');
  });
}
function library(favorites=false) {
  return `<div class="eyebrow">${favorites?'YOUR SAVED WORDS':'BUILD YOUR VOCABULARY'}</div><h1>${favorites?'生词本':'我的词库'}</h1><p class="muted">${favorites?'多见几次，陌生的词也会熟悉。':`${bookWords().length} 个单词，慢慢变成自己的。`}</p><div class="toolbar"><input id="search" type="search" placeholder="搜索英文 / 中文释义" aria-label="搜索词库"><select id="filter" aria-label="掌握状态筛选"><option value="all">全部</option>${LABELS.map((l,i)=>`<option value="${i}">${l}</option>`).join('')}${favorites?'':'<option value="favorite">生词本</option>'}</select></div><div id="word-list" data-favorites="${favorites}"></div>`;
}
function updateList() {
  const container = $('#word-list'); if (!container) return;
  const search = $('#search').value.trim().toLowerCase(), filter = $('#filter').value;
  const found = bookWords().filter(w => (container.dataset.favorites!=='true'||w.favorite) && (filter==='all'||filter==='favorite'&&w.favorite||String(w.mastery)===filter) && (w.word.toLowerCase().includes(search)||w.meaning.toLowerCase().includes(search)));
  container.innerHTML = `<p class="caption">${found.length} 个单词</p>` + found.slice(0,listLimit).map(w=>`<div class="word-row"><button class="word-link" data-detail="${esc(w.word)}"><strong>${esc(w.word)}</strong><span>${esc(w.meaning)}</span></button><span class="badge">${LABELS[w.mastery]}</span><button class="icon" data-action="favorite" data-word="${esc(w.word)}" aria-label="${w.favorite?'取消收藏':'收藏'}">${w.favorite?'★':'☆'}</button></div>`).join('') + (!found.length?'<div class="empty">没有找到单词</div>':'') + (found.length>listLimit?'<button class="wide" data-action="more">显示更多</button>':'');
}
function detail(id) {
  const w = bookWords().find(w=>w.word===id); if (!w) return '<p>没有找到这个单词。</p>';
  return `<button class="quiet back" data-action="back">← 返回词库</button><section class="panel"><h1 class="word">${esc(w.word)}</h1>${wordMetadata(w,true)}<div class="row"><button data-action="speak" data-word="${esc(w.word)}">♪ 发音</button><button data-action="favorite" data-word="${esc(w.word)}">${w.favorite?'★ 已收藏':'☆ 收藏'}</button></div>${answerHTML(w,true)}<div class="setting"><label>掌握等级<select id="mastery" data-word="${esc(w.word)}">${LABELS.map((l,i)=>`<option value="${i}" ${w.mastery===i?'selected':''}>${l}</option>`).join('')}</select></label></div><div class="detail-info"><div><span>复习次数</span>${w.reviewCount}</div><div><span>收藏</span>${w.favorite?'是':'否'}</div><div><span>上次复习</span>${dateText(w.lastReview)}</div><div><span>下次复习</span>${dateText(w.nextReview)}</div></div></section>`;
}
function me() {
  const r = todayRecord(), week = records.filter(r=>r.date>=shiftDay(-6)&&r.date<=day()).reduce((sum,r)=>sum+recordForBook(r).completedWords,0);
  return `<div class="eyebrow">YOUR LEARNING SPACE</div><h1>我的</h1><p class="muted">学习有节奏，记忆有回响。</p><section class="panel"><h2>学习统计</h2><div class="metrics"><div class="metric"><strong>${r.completedWords}</strong><span>今日学习</span></div><div class="metric"><strong>${week}</strong><span>近 7 天学习</span></div><div class="metric"><strong>${streak()}</strong><span>连续天数</span></div></div><p class="caption">今日新词 ${r.newWords} · 复习 ${r.reviewWords} · 学习 ${r.studySessions} 轮<br>学习量按每天完成的不同单词统计。</p><button class="menu" data-action="favorites">☆ 生词本 <span class="caption">${bookWords().filter(w=>w.favorite).length} 个词</span></button></section><section class="panel"><h2>学习设置</h2><div class="setting"><label class="book-choice">当前词书<select id="active-book">${Object.entries(BOOKS).map(([id,name])=>`<option value="${id}" ${activeBook===id?'selected':''}>${esc(name)}</option>`).join('')}</select></label></div><div class="setting"><label>每日新词<select id="daily-preset">${[20,30,40,50].map(n=>`<option value="${n}" ${settings.dailyNew===n?'selected':''}>${n} 个</option>`).join('')}<option value="custom" ${![20,30,40,50].includes(settings.dailyNew)?'selected':''}>自定义</option></select></label><label id="custom-row" ${[20,30,40,50].includes(settings.dailyNew)?'hidden':''}>自定义数量<input id="daily-custom" type="number" min="1" max="1000" value="${settings.dailyNew}"></label><p class="caption">新数量在下一轮队列生成时生效。</p></div><div class="setting"><label>自动发音<input id="auto-speak" type="checkbox" ${settings.autoSpeak?'checked':''}></label></div><div class="setting"><label>滑动操作<input id="gestures" type="checkbox" ${settings.gestures?'checked':''}></label><p class="caption">默认关闭，避免滚动时误触。开启后可在单词区域滑动。</p></div><button class="menu" data-action="import">导入词库 <span class="caption">CSV / JSON</span></button><button class="menu" data-action="export">导出完整学习数据</button><button class="menu" data-action="restore">恢复学习数据</button><button class="menu danger" data-action="reset">清空学习进度</button></section><p class="tip">数据保存在当前浏览器。手机与 iPad 进度独立，可通过备份迁移。建议定期导出备份。</p><p class="tip">安装：iPhone / iPad 在 Safari 中点「分享 → 添加到主屏幕」；其他支持的浏览器使用菜单中的安装选项。</p>`;
}
function render() {
  const route = location.hash.slice(1)||'home'; $('#app').classList.toggle('studying',route==='study');
  let wordId='';try{wordId=decodeURIComponent(route.slice(5));}catch(_){}
  $('#app').innerHTML = route==='study'?study():route==='library'?library():route==='favorites'?library(true):route==='me'?me():route.startsWith('word/')?detail(wordId):home();
  $('#nav').querySelectorAll('a').forEach(a=>a.classList.toggle('active',a.hash===`#${route==='favorites'?'me':route.startsWith('word/')?'library':route}`));
  updateList(); bindGestures();
}
async function favorite(id) { return withWrite(async()=>{
  await transaction(['words'],(tx,read)=>read([tx.objectStore('words').get(id)],w=>{if(!w)throw new Error('没有找到这个单词');w.favorite=!w.favorite;tx.objectStore('words').put(w);}));
  await reload();if($('#word-list'))updateList();else render();
}); }
async function setMastery(id,level) { return withWrite(async()=>{
  if(!Number.isInteger(level)||level<0||level>4)throw new Error('掌握等级无效');
  await transaction(['words'],(tx,read)=>read([tx.objectStore('words').get(id)],w=>{if(!w)throw new Error('没有找到这个单词');const d=new Date();if(level===0)d.setMinutes(d.getMinutes()+10);else d.setDate(d.getDate()+[0,1,3,7,15][level]);w.mastery=level;w.nextReview=d.toISOString();tx.objectStore('words').put(w);}));
  await reload();notify('掌握等级已更新');render();
}); }
function saveSettings(next=settings,silent=false) {
  try {const normalized=validateSettings(next,true);localStorage.setItem('cet6-settings',JSON.stringify(normalized));settings=normalized;savedSettings={...normalized};if(!silent)notify('设置已保存');return true;}
  catch (_) {settings={...savedSettings};if(db)render();if(!silent)notify('设置未能保存，请检查浏览器存储权限');return false;}
}
function bindGestures() {
  const card = $('#gesture-zone'); if (!card || !settings.gestures || !revealed) return;
  let begin;
  card.addEventListener('touchstart',e=>{ if (busy || e.touches.length!==1 || e.target.closest('button')) {begin=null;return;} const t=e.touches[0]; begin={id:t.identifier,x:t.clientX,y:t.clientY,time:Date.now(),word:session?.queue[0],answered:session?.answered}; },{passive:true});
  card.addEventListener('touchmove',e=>{if(e.touches.length!==1)begin=null;},{passive:true});
  card.addEventListener('touchcancel',()=>{begin=null;},{passive:true});
  card.addEventListener('touchend',e=>{ const start=begin;begin=null;if(!start||e.touches.length||e.changedTouches.length!==1)return;const t=e.changedTouches[0];if(t.identifier!==start.id||start.word!==session?.queue[0]||start.answered!==session?.answered)return;
    const dx=t.clientX-start.x,dy=t.clientY-start.y,elapsed=Date.now()-start.time;if(elapsed>550)return;
    if (Math.abs(dx)>90 && Math.abs(dx)>Math.abs(dy)*2) safe(()=>answer(dx>0?2:0));
    else if (dy < -110 && Math.abs(dy)>Math.abs(dx)*2) safe(()=>answer(1));
  },{passive:true});
}
async function safe(fn) { try { await fn(); } catch (e) { console.error(e); notify(e.message || '操作失败，请重试'); } }
document.addEventListener('click',e=>safe(async()=>{
  const b = e.target.closest('button'); if (!b) return;
  if(e.detail>1)return;
  if (b.dataset.answer!==undefined) return answer(Number(b.dataset.answer));
  if (b.dataset.detail) {location.hash=`word/${encodeURIComponent(b.dataset.detail)}`;return;}
  switch(b.dataset.action) {
    case 'start':return start(); case 'reveal':if(session?.date!==day())return refreshState();revealed=true;render();break;
    case 'speak':speak(b.dataset.word);break;case 'favorite':return favorite(b.dataset.word);
    case 'favorites':location.hash='favorites';break;case 'back':location.hash='library';break;
    case 'more':listLimit+=80;updateList();break;
    case 'import':$('#import-file').click();break;case 'restore':$('#restore-file').click();break;
    case 'export':return exportData();case 'reset':return resetProgress();
  }
}));
document.addEventListener('input',e=>{if(e.target.id==='search'){listLimit=80;updateList();}});
document.addEventListener('change',e=>safe(async()=>{
  const el=e.target;
  if(busy){notify('正在保存，请稍后重试');return;}
  if(el.id==='active-book')return switchBook(el.value);
  if(el.id==='filter'){listLimit=80;updateList();}
  if(el.id==='daily-preset'){if(el.value==='custom'){$('#custom-row').hidden=false;$('#daily-custom').focus();}else{settings.dailyNew=Number(el.value);$('#custom-row').hidden=true;saveSettings();}}
  if(el.id==='daily-custom'){const n=Number(el.value);if(!Number.isInteger(n)||n<1||n>1000){notify('请输入 1–1000 的整数');el.value=settings.dailyNew;}else{settings.dailyNew=n;saveSettings();}}
  if(el.id==='auto-speak'||el.id==='gestures'){settings[el.id==='auto-speak'?'autoSpeak':'gestures']=el.checked;saveSettings();if(!settings.autoSpeak)stopSpeaking();}
  if(el.id==='mastery')await setMastery(el.dataset.word,Number(el.value));
  if(el.id==='import-file'||el.id==='restore-file'){const file=el.files[0];el.value='';if(file){if(file.size>30*1024*1024)throw new Error('文件超过 30MB，请拆分导入');const text=await readFileText(file);if(el.id==='restore-file')await restoreData(parseJSON(text));else await importWords(file.name.toLowerCase().endsWith('.csv')?parseCSV(text):parseJSON(text));}}
}));
async function readFileText(file) {
  const buffer=await file.arrayBuffer();
  try {return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
  catch(_){throw new Error('文件不是有效的 UTF-8 编码，请保存为 UTF-8 后重新导入');}
}
function parseJSON(text) { return JSON.parse(text.replace(/^\uFEFF/,'')); }
// 支持 CSV 的引号、逗号、双引号转义与跨行例句。
function parseCSV(text) {
  text=text.replace(/^\uFEFF/,'');let rows=[],row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c===','){row.push(cell);cell='';closed=false;}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';closed=false;}
    else if(closed){if(c!==' '&&c!=='\t')throw new Error('CSV 引号后有无效字符');}
    else if(c==='"'){if(cell)throw new Error('CSV 引号位置无效');quoted=true;}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV 引号未闭合');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  const headers=(rows.shift()||[]).map(v=>v.trim());if(!headers.includes('word')||!headers.includes('meaning'))throw new Error('CSV 必须包含 word 和 meaning 表头');
  if(headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error('CSV 表头为空或重复');
  if(rows.some(r=>r.length>headers.length))throw new Error('CSV 存在多余列，请检查未加引号的逗号');
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));
}
function normalizeWord(w,full=false) {
  if(!w||typeof w.word!=='string'||!w.word.trim()||typeof w.meaning!=='string'||!w.meaning.trim())throw new Error('每个单词必须包含 word 和 meaning');
  // 可选词库元数据：旧词库缺失时使用空值，CSV 数值转为数字。
  const rawFrequency=w.frequency, frequency=rawFrequency==null || typeof rawFrequency==='string'&&!rawFrequency.trim() ? null : Number(rawFrequency);
  if(frequency!==null&&(!['string','number'].includes(typeof rawFrequency)||!Number.isFinite(frequency)||frequency<0))throw new Error('frequency 必须为非负数字或空值');
  const importance=w.importance==null||typeof w.importance==='string'&&!w.importance.trim()?null:Number(w.importance);
  if(importance!==null&&(!['number','string'].includes(typeof w.importance)||!Number.isInteger(importance)||importance<1||importance>5))throw new Error('importance 必须为 1–5 的整数或空值');
  const studyPriority=w.studyPriority==null||typeof w.studyPriority==='string'&&!w.studyPriority.trim()?null:Number(w.studyPriority);
  if(studyPriority!==null&&(!['number','string'].includes(typeof w.studyPriority)||!Number.isInteger(studyPriority)||studyPriority<1||studyPriority>5))throw new Error('studyPriority 必须为 1–5 的整数或空值');
  const basicFunctionWord=w.basicFunctionWord==null||w.basicFunctionWord===''?null:w.basicFunctionWord===true||w.basicFunctionWord==='true'?true:w.basicFunctionWord===false||w.basicFunctionWord==='false'?false:undefined;
  if(basicFunctionWord===undefined)throw new Error('basicFunctionWord 必须为布尔值或空值');
  const basicKnownWord=w.basicKnownWord==null||w.basicKnownWord===''?null:w.basicKnownWord===true||w.basicKnownWord==='true'?true:w.basicKnownWord===false||w.basicKnownWord==='false'?false:undefined;
  if(basicKnownWord===undefined)throw new Error('basicKnownWord 必须为布尔值或空值');
  const out={word:w.word.trim().toLowerCase(),phonetic:optionalText(w.phonetic,'phonetic'),meaning:w.meaning.trim(),example:optionalText(w.example,'example'),exampleZh:optionalText(w.exampleZh,'exampleZh'),frequency,level:optionalText(w.level,'level',true),source:optionalText(w.source,'source'),pos:optionalText(w.pos,'pos'),definition:optionalText(w.definition,'definition'),importance,importanceReason:optionalText(w.importanceReason,'importanceReason'),corePos:optionalText(w.corePos,'corePos'),coreMeaning:optionalText(w.coreMeaning,'coreMeaning'),mastery:0,reviewCount:0,lastReview:null,nextReview:null,favorite:false,createdAt:new Date().toISOString()};
  out.basicFunctionWord=basicFunctionWord;
  out.basicKnownWord=basicKnownWord;
  out.studyPriority=studyPriority;
  out.studyPriorityReason=optionalText(w.studyPriorityReason,'studyPriorityReason');
  if(full){if(!Number.isInteger(w.mastery)||w.mastery<0||w.mastery>4||!Number.isSafeInteger(w.reviewCount)||w.reviewCount<0||typeof w.favorite!=='boolean')throw new Error('备份中的学习进度格式无效');Object.assign(out,{mastery:w.mastery,reviewCount:w.reviewCount,lastReview:normalizeDate(w.lastReview),nextReview:normalizeDate(w.nextReview),favorite:w.favorite,createdAt:normalizeDate(w.createdAt)||out.createdAt});if(w.reviewCount>0&&(!out.lastReview||!out.nextReview))throw new Error('已学习单词缺少复习日期');}
  return out;
}
function optionalText(value,name,number=false) { if(value==null)return '';if(typeof value==='string')return value.trim();if(number&&typeof value==='number'&&Number.isFinite(value))return String(value);throw new Error(`${name} 必须为文本或空值`); }
function validDay(value) { return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value; }
function normalizeDate(value) { if(value==null||value==='')return null;if(typeof value!=='string'||!validDay(value.slice(0,10))||!Number.isFinite(Date.parse(value)))throw new Error('备份中的日期格式无效');return new Date(value).toISOString(); }
function mergeDictionary(old,incoming) {
  let changed=false;
  // 仅合并词典内容白名单；缺失/空元数据不抹除旧值，0 和 false 是有效更新。
  // 用户学习字段、每日记录和队列始终不参与词库导入合并。
  for(const k of ['phonetic','meaning','frequency','level','source','pos','definition','importance','importanceReason','corePos','coreMeaning','basicFunctionWord','basicKnownWord','studyPriority','studyPriorityReason']){
    if(incoming[k]!=null&&incoming[k]!==''&&old[k]!==incoming[k]){old[k]=incoming[k];changed=true;}
  }
  // 完整双语对可更新，不再要求词包先提供 core 字段。
  // 半份例句只能补与现有另一半对应的内容，避免拼出错误翻译。
  if(incoming.example&&incoming.exampleZh){
    for(const k of ['example','exampleZh'])if(old[k]!==incoming[k]){old[k]=incoming[k];changed=true;}
  }
  else if(incoming.example&&!old.example?.trim()&&!old.exampleZh?.trim()){old.example=incoming.example;changed=true;}
  else if(incoming.exampleZh&&(!old.example?.trim()||old.example===incoming.example)&&old.exampleZh!==incoming.exampleZh){old.exampleZh=incoming.exampleZh;changed=true;}
  return changed;
}
async function importWords(data) {
  if(!Array.isArray(data))throw new Error('词库 JSON 必须是数组'); const incoming=data.map(w=>normalizeWord(w));
  return withWrite(async()=>{
    let added=0;
    await transaction(['words'],(tx,read)=>read([tx.objectStore('words').getAll()],current=>{
      const map=new Map(current.map(w=>[w.word,w])),changed=new Set();
      for(const w of incoming){if(map.has(w.word)){if(mergeDictionary(map.get(w.word),w))changed.add(w.word);}else{map.set(w.word,w);changed.add(w.word);added++;}}
      for(const id of changed)tx.objectStore('words').put(map.get(id));
    }));
    await reload();render();notify(`导入完成，新增 ${added} 个词；原有进度已保留`);
  });
}
async function exportData() {
  const snapshotData=await snapshot();
  const data={format:'cet6-backup',version:1,exportedAt:new Date().toISOString(),...snapshotData,settings:{...savedSettings},streak:streak(snapshotData.records)};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`cet6-backup-${day()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);notify('备份已导出，请保存好 JSON 文件');
}
async function restoreData(data) {
  if(data?.format!=='cet6-backup'||data.version!==1||!Array.isArray(data.words)||!Array.isArray(data.records)||!Array.isArray(data.meta))throw new Error('不是有效的学习备份文件');
  const restored=data.words.map(w=>normalizeWord(w,true)), ids=new Set(restored.map(w=>w.word));if(ids.size!==restored.length)throw new Error('备份词库存在重复单词');
  validateRecords(data.records,ids);
  validateMeta(data.meta,ids,restored);
  const restoredSettings=validateSettings(data.settings??{},true);
  if(!confirm('恢复将覆盖当前学习进度，是否继续？'))return;
  return withWrite(async()=>{
    const previousSettings={...savedSettings};
    if(!saveSettings(restoredSettings,true))throw new Error('设置无法保存，恢复已取消，原有学习数据未修改');
    // 词库、统计与队列在同一个事务内恢复，避免出现半份备份。
    try {
      await transaction(['words','days','meta'],tx=>{
        for(const s of ['words','days','meta'])tx.objectStore(s).clear();
        restored.forEach(w=>tx.objectStore('words').put(w));
        data.records.forEach(r=>tx.objectStore('days').put(r));
        data.meta.forEach(m=>tx.objectStore('meta').put(m));
        tx.objectStore('meta').put({key:'initialized',value:true});
      });
    } catch(e) { saveSettings(previousSettings,true);throw e; }
    stopSpeaking();revealed=false;await reload();render();notify('学习数据已恢复');
  });
}
function validateRecords(dayList,ids) {
  const dates=new Set();
  for(const r of dayList){
    if(!r||!validDay(r.date)||dates.has(r.date))throw new Error('备份学习日期无效或重复');
    dates.add(r.date);
    for(const key of ['newWords','reviewWords','completedWords','studySessions']){
      if(!Number.isSafeInteger(r[key])||r[key]<0)throw new Error('备份学习记录无效');
    }
    for(const key of ['completedIds','newIds','reviewIds']){
      if(!Array.isArray(r[key])||r[key].some(id=>!ids.has(id))||new Set(r[key]).size!==r[key].length)throw new Error('备份记录的单词无效');
    }
    if(r.bookSessions!==undefined&&(!r.bookSessions||typeof r.bookSessions!=='object'||Array.isArray(r.bookSessions)||Object.keys(r.bookSessions).some(k=>!Object.hasOwn(BOOKS,k))||['cet4','cet6'].some(k=>!Number.isSafeInteger(r.bookSessions[k])||r.bookSessions[k]<0)||r.bookSessions.cet4+r.bookSessions.cet6!==r.studySessions))throw new Error('备份学习轮次无效');
    const completed=new Set(r.completedIds),newIds=new Set(r.newIds);
    const validCounts=r.completedWords===r.completedIds.length&&r.newWords===r.newIds.length&&r.reviewWords===r.reviewIds.length&&r.completedWords===r.newWords+r.reviewWords;
    const validIds=[...r.newIds,...r.reviewIds].every(id=>completed.has(id))&&r.reviewIds.every(id=>!newIds.has(id));
    if(!validCounts||!validIds)throw new Error('备份学习统计不一致');
  }
}
function validateMeta(meta,ids,wordList=words) {
  if(meta.some(m=>!m||!['session','initialized'].includes(m.key)||m.key==='initialized'&&m.value!==true)||new Set(meta.map(m=>m.key)).size!==meta.length)throw new Error('备份队列格式无效');
  const saved=meta.find(m=>m.key==='session');if(!saved)return;
  const check=(item,book)=>{
    const validQueue=Array.isArray(item?.queue)&&item.queue.every(id=>ids.has(id))&&new Set(item.queue).size===item.queue.length;
    if(!validDay(item?.date)||!validQueue||!Number.isSafeInteger(item.answered)||item.answered<0||!Number.isSafeInteger(item.total)||item.total<0||item.book!==undefined&&!Object.hasOwn(BOOKS,item.book))throw new Error('备份队列格式无效');
  };
  check(saved,saved.book);
  if(saved.otherSessions!==undefined){
    if(!saved.otherSessions||typeof saved.otherSessions!=='object'||Array.isArray(saved.otherSessions)||!Object.hasOwn(BOOKS,saved.book))throw new Error('备份队列格式无效');
    for(const [book,item] of Object.entries(saved.otherSessions)){
      if(!Object.hasOwn(BOOKS,book)||book===saved.book||item?.book!==undefined&&item.book!==book||item?.otherSessions!==undefined)throw new Error('备份队列格式无效');
      check(item,book);
    }
  }
}
async function resetProgress() {
  if(!confirm('清空所有学习进度和每日记录？词库与收藏将保留。'))return;
  if(!confirm('再次确认：此操作无法撤销。建议先导出备份。继续清空？'))return;
  return withWrite(async()=>{
    await transaction(['words','days','meta'],(tx,read)=>read([tx.objectStore('words').getAll()],current=>{current.forEach(w=>tx.objectStore('words').put({...w,mastery:0,reviewCount:0,lastReview:null,nextReview:null}));tx.objectStore('days').clear();tx.objectStore('meta').clear();tx.objectStore('meta').put({key:'initialized',value:true});}));
    stopSpeaking();revealed=false;await reload();render();notify('学习进度已清空');
  });
}
async function refreshState() {
  if(busy){refreshPending=true;return;}
  if(!db)db=await openDatabase();
  const oldBook=activeBook;loadBookChoice();
  const oldDay=visibleDay,oldRoute=location.hash,search=$('#search')?.value,filter=$('#filter')?.value;await reload();
  try {const next=validateSettings(parseJSON(localStorage.getItem('cet6-settings')||'{}'));settings=next;savedSettings={...next};} catch (_) {}
  if(oldDay!==day()||oldBook!==activeBook){stopSpeaking();revealed=false;}render();
  if(oldRoute===location.hash&&typeof search==='string'&&$('#search')){$('#search').value=search;$('#filter').value=filter;updateList();}
  scheduleClock();
}
function scheduleClock() {
  clearTimeout(clockTimer);const midnight=new Date();midnight.setHours(24,0,0,0);const now=Date.now();let next=midnight.getTime();
  for(const w of bookWords()){const time=Date.parse(w.nextReview);if(time>now&&time<next)next=time;}
  clockTimer=setTimeout(()=>{if(!document.hidden)safe(refreshState);else refreshPending=true;},next-now+100);
}
window.addEventListener('hashchange',()=>{stopSpeaking();revealed=false;listLimit=80;if(appReady&&!db)safe(refreshState);else if(db){if(visibleDay!==day())safe(refreshState);else{render();if(location.hash==='#study')autoSpeak();}}});
window.addEventListener('pageshow',()=>{if(appReady)safe(refreshState);});
window.addEventListener('focus',()=>{if(appReady)safe(refreshState);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopSpeaking();else if(appReady)safe(refreshState);});
window.addEventListener('storage',e=>{if(['cet6-settings','activeBook'].includes(e.key)&&appReady)safe(refreshState);});
async function openDatabase() {
  const open=indexedDB.open('cet6-words',1);open.onupgradeneeded=()=>{const d=open.result;d.createObjectStore('words',{keyPath:'word'});d.createObjectStore('days',{keyPath:'date'});d.createObjectStore('meta',{keyPath:'key'});};
  open.onblocked=()=>notify('另一个页面正在使用词库，请关闭旧页面后重试');
  const connection=await request(open);
  connection.onversionchange=()=>{connection.close();db=null;notify('数据版本已更新，请刷新页面');};
  connection.onclose=()=>{if(db===connection)db=null;};return connection;
}
async function init() {
  db=await openDatabase();await reload();
  const initialized=await request(db.transaction('meta').objectStore('meta').get('initialized'));
  if(!initialized&&!words.length){const res=await fetch('sample-words.json');if(!res.ok)throw new Error('示例词库加载失败');await importWords(await res.json());}
  if(!initialized)await transaction(['meta'],tx=>tx.objectStore('meta').put({key:'initialized',value:true}));
  await reload();appReady=true;render();scheduleClock();
  if('serviceWorker' in navigator){
    let controller=navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(controller)notify('应用已更新，刷新后使用新版本；学习进度已保留');controller=navigator.serviceWorker.controller;});
    navigator.serviceWorker.register('service-worker.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(e=>console.warn('离线缓存安装或更新暂不可用',e));
  }
}
init().catch(e=>{$('#app').innerHTML=`<h1>暂时无法打开词库</h1><p>${esc(e.message)}</p><p>请使用正常浏览模式，并允许此网站保存本地数据。</p><button onclick="location.reload()">重新打开</button>`;console.error(e);});
