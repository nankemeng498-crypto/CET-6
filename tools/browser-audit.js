// 开发用集成检查：独立端口 + 真实 IndexedDB；不接入 App 导航。
const results=document.querySelector('#results'),runButton=document.querySelector('#run-audit');
const report=line=>{results.textContent+=line+'\n';};
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const expectFailure=async(fn,message)=>{let failed=false;try{await fn();}catch(_){failed=true;}check(failed,message);};
const waitReady=setInterval(()=>{if(appReady){clearInterval(waitReady);runButton.disabled=false;results.textContent='准备完成。\n';}},100);
runButton.addEventListener('click',async()=>{
  if(location.hostname!=='localhost'||location.port!=='8011'){report('拒绝运行：必须使用 localhost:8011 的独立测试地址。');return;}
  runButton.disabled=true;results.textContent='';
  const nativeConfirm=window.confirm,nativeDate=window.Date,nativeSetItem=Storage.prototype.setItem;
  const oldSynthDescriptor=Object.getOwnPropertyDescriptor(window,'speechSynthesis');
  const oldUtteranceDescriptor=Object.getOwnPropertyDescriptor(window,'SpeechSynthesisUtterance');
  const nativeNotify=notify,nativeAnchorClick=HTMLAnchorElement.prototype.click,nativeObjectURL=URL.createObjectURL,nativeTransaction=transaction;
  let foreign,exportedBlob;
  try {
    window.confirm=()=>true;
    await transaction(['words','days','meta'],tx=>{for(const name of ['words','days','meta'])tx.objectStore(name).clear();tx.objectStore('meta').put({key:'initialized',value:true});});await reload();
    const input=Array.from({length:5000},(_,i)=>({word:`audit${String(i).padStart(5,'0')}`,meaning:`测试释义 ${i}`,phonetic:'',example:'A sample sentence.',exampleZh:'一条例句。',frequency:i,level:'CET-6',source:'audit'}));
    let t=performance.now();await importWords(JSON.parse(JSON.stringify(input)));report(`5000 词 JSON 导入：${(performance.now()-t).toFixed(1)} ms`);check(words.length===5000,'5000 词数量不正确');
    const first=words[0].word;await start();check(session.queue.length===40,'默认新词数量应为 40');
    revealed=true;await answer(0);check(session.queue[5]===first,'不认识应隔 5 个词重现');check(todayRecord().completedWords===1,'首次完成应计数一次');
    const afterAnswer=await snapshot();
    await expectFailure(()=>transaction(['words','days','meta'],tx=>{tx.objectStore('words').put({...words[0],mastery:4});tx.objectStore('days').clear();throw new Error('模拟写入失败');}),'模拟失败未抛错');
    check(JSON.stringify(await snapshot())===JSON.stringify(afterAnswer),'事务失败没有完整回滚');report('PASS 真实 IndexedDB 事务失败回滚');
    foreign=await request(indexedDB.open('cet6-words',1));
    const foreignPut=async(store,value)=>{const tx=foreign.transaction(store,'readwrite');tx.objectStore(store).put(value);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});};
    const staleWord=words.find(w=>w.word===first),newWord={...staleWord,mastery:3,reviewCount:7,lastReview:new Date().toISOString(),nextReview:new Date(Date.now()+7*86400000).toISOString()};
    await foreignPut('words',newWord);await favorite(first);check(words.find(w=>w.word===first).reviewCount===7,'收藏覆盖了另一个页面的进度');
    await foreignPut('words',{...words.find(w=>w.word===first),reviewCount:8});
    t=performance.now();await importWords(input);report(`5000 词重复导入：${(performance.now()-t).toFixed(1)} ms`);
    check(words.find(w=>w.word===first).reviewCount===8,'重复导入覆盖了更新后的进度');check(words.find(w=>w.word===first).favorite,'重复导入丢失收藏');
    report('PASS 收藏及重复导入读取最新进度');
    const expectedCurrent=session.queue[0];await foreignPut('meta',{...session,answered:session.answered+1,queue:session.queue.slice(1)});
    revealed=true;await answer(2);check(words.find(w=>w.word===expectedCurrent).reviewCount===0,'旧页面回答跳过了更新队列');report('PASS 旧页面的重复提交被拒绝');
    const untouched=words.find(isNew);await setMastery(untouched.word,4);check(!plan().fresh.some(w=>w.word===untouched.word),'手动掌握的词仍被当新词');
    check(home().includes('今日进度')&&!home().includes('<span>100%</span>'),'未完成队列显示了 100%');
    t=performance.now();for(let i=0;i<10;i++){revealed=true;await answer(2);}report(`5000 词库下 10 次学习保存：${(performance.now()-t).toFixed(1)} ms`);
    const csv='word,meaning,frequency,level,source\n'+input.map(w=>`${w.word},${w.meaning},${w.frequency},${w.level},${w.source}`).join('\n');
    t=performance.now();await importWords(parseCSV(csv));report(`5000 词 CSV 解析及重复导入：${(performance.now()-t).toFixed(1)} ms`);
    check(words.length===5000,'CSV 导入产生重复词');
    for(const invalid of ['word,word,meaning\na,b,c','word,meaning\na,extra,测试','word,meaning\na,"测试"garbage'])await expectFailure(()=>Promise.resolve(parseCSV(invalid)),'无效 CSV 未被拒绝');
    check(parseJSON('\uFEFF[{"word":"test","meaning":"测试"}]').length===1,'JSON BOM 不兼容');report('PASS CSV 错列/重复表头/引号检查及 JSON BOM');
    await expectFailure(()=>readFileText(new File([new Uint8Array([255])],'bad.csv')),'错误编码被静默转换成乱码');report('PASS 无效 UTF-8 文件拒绝');
    URL.createObjectURL=blob=>{exportedBlob=blob;return nativeObjectURL(blob);};HTMLAnchorElement.prototype.click=()=>{};
    const answering=session.queue[0];revealed=true;await Promise.all([answer(2),exportData()]);
    const concurrentBackup=JSON.parse(await exportedBlob.text()),concurrentWord=concurrentBackup.words.find(w=>w.word===answering);
    check(concurrentWord.reviewCount>0&&concurrentBackup.records.find(r=>r.date===day()).completedIds.includes(answering),'并发导出产生了不一致快照');report('PASS 学习写入期间导出的词库与统计一致');
    await exportData();const backup=JSON.parse(await exportedBlob.text());check(backup.words.length===5000,'备份漏词');
    const beforeRestore=await snapshot();await restoreData(backup);check(JSON.stringify(await snapshot())===JSON.stringify(beforeRestore),'完整备份恢复不一致');
    const savedBeforeFailure=JSON.stringify(settings),failedRestore=structuredClone(backup);failedRestore.settings.dailyNew=50;
    transaction=(stores,fn)=>nativeTransaction(stores,(tx,read)=>{fn(tx,read);throw new Error('模拟恢复写入失败');});
    await expectFailure(()=>restoreData(failedRestore),'恢复写入失败未抛错');transaction=nativeTransaction;
    check(JSON.stringify(await snapshot())===JSON.stringify(beforeRestore),'失败恢复没有保留旧数据');check(JSON.stringify(settings)===savedBeforeFailure&&localStorage.getItem('cet6-settings')===savedBeforeFailure,'失败恢复没有回滚设置');report('PASS 恢复事务失败时同时保留旧进度及旧设置');
    for(const mutate of [b=>b.records[0].date='2026-02-30',b=>b.words[0].nextReview=123,b=>{b.records[0].newIds=b.records[0].completedIds.slice();b.records[0].reviewIds=b.records[0].completedIds.slice();b.records[0].newWords=b.records[0].newIds.length;b.records[0].reviewWords=b.records[0].reviewIds.length;},b=>b.meta.find(m=>m.key==='session').date='2026-99-99']){
      const invalid=structuredClone(backup);mutate(invalid);await expectFailure(()=>restoreData(invalid),'损坏备份未被拒绝');check(JSON.stringify(await snapshot())===JSON.stringify(beforeRestore),'无效备份改变了数据');
    }
    Storage.prototype.setItem=()=>{throw new DOMException('模拟存储限制','QuotaExceededError');};
    const oldSettings={...settings};settings.dailyNew=50;check(!saveSettings(settings,true),'设置失败未返回错误');check(settings.dailyNew===oldSettings.dailyNew,'失败设置仍停留在内存');
    await expectFailure(()=>restoreData(backup),'设置不可写时恢复应取消');check(JSON.stringify(await snapshot())===JSON.stringify(beforeRestore),'恢复失败破坏数据');Storage.prototype.setItem=nativeSetItem;
    report('PASS 5000 词备份往返、损坏备份拒绝、设置失败保护');
    const oldBackup=structuredClone(backup);oldBackup.words.forEach(w=>{delete w.frequency;delete w.level;delete w.source;});await restoreData(oldBackup);check(words.every(w=>w.frequency===null&&w.level===''&&w.source===''),'旧备份不兼容');await restoreData(backup);report('PASS 新旧元数据备份兼容');
    const notices=[];notify=message=>notices.push(message);let spoken;
    Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(value){this.text=value;}}});
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel:()=>{spoken?.onerror?.({error:'interrupted'});},getVoices:()=>[{lang:'en-GB'}],speak:u=>{spoken=u;}}});
    speak('first');const oldSpeech=spoken;speak('second');oldSpeech.onerror({error:'canceled'});check(notices.length===0,'主动取消发音被当作故障');check(spoken.lang==='en-GB','语音与语言不匹配');spoken.onerror({error:'not-allowed'});check(notices.length===1,'真正发音错误未提示');notify=nativeNotify;report('PASS 发音取消、过期回调与语音语言匹配（模拟）');
    settings.gestures=true;revealed=true;render();
    const zone=document.querySelector('#gesture-zone'),previousAnswers=session.answered;
    const touch=(type,touches,changedTouches=touches)=>{const event=new Event(type,{bubbles:true});Object.defineProperties(event,{touches:{value:touches},changedTouches:{value:changedTouches}});zone.dispatchEvent(event);};
    const begin={identifier:1,clientX:10,clientY:150},end={identifier:1,clientX:150,clientY:150};
    touch('touchstart',[begin]);touch('touchcancel',[]);touch('touchend',[],[end]);
    touch('touchstart',[begin]);touch('touchmove',[begin,{identifier:2,clientX:20,clientY:20}]);touch('touchend',[],[end]);
    touch('touchstart',[begin]);touch('touchend',[],[{...end,clientX:50}]);
    check(session.answered===previousAnswers,'取消、多指或短滑动误触回答');report('PASS 取消触摸、多指触摸及短距离滑动保护（模拟）');
    let now=new nativeDate(2026,9,2,23,59).getTime();window.Date=class extends nativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
    await transaction(['words','days','meta'],tx=>{for(const store of ['words','days','meta'])tx.objectStore(store).clear();tx.objectStore('meta').put({key:'initialized',value:true});});await reload();
    await importWords([{word:'midnight-a',meaning:'跨天词 A'},{word:'midnight-b',meaning:'跨天词 B'}]);await start();revealed=true;await answer(0);
    const second=session.queue[0];revealed=true;now+=2*60000;await answer(2);check(todayRecord().completedWords===0,'昨日队列写入今日统计');check(words.find(w=>w.word===second).reviewCount===0,'跨天时误回答了昨日卡片');
    await start();check(session.date===day(),'新队列日期未更新');check(session.queue[0]==='midnight-a','跨天薄弱词未优先进入队列');
    while(session.queue.length){revealed=true;await answer(2);}
    await foreignPut('words',{...words.find(w=>w.word==='midnight-a'),nextReview:new Date(Date.now()-1000).toISOString()});await reload();await start();check(session.queue.length===1,'单词尾部重复测试准备失败');revealed=true;await answer(0);check(session.queue.length===0,'最后一个陌生词被立即连续重复');check(Date.parse(words.find(w=>w.word==='midnight-a').nextReview)>Date.now()+9*60000,'尾部陌生词没有安排当天稍后复习');
    const rows=[1,2,3].map(n=>({...emptyRecord(`2026-10-0${n}`),completedWords:1,newWords:1,completedIds:['midnight-a'],newIds:['midnight-a']}));
    check(streak(rows)===3,'连续天数跨天统计不正确');check(streak(rows.filter(r=>r.date!=='2026-10-02'))===1,'断签后连续天数不正确');
    report('PASS 跨午夜拒绝旧队列、今日重建、连续天数、断签及尾部陌生词稍后复习');
    await transaction(['words','days','meta'],tx=>{for(const store of ['words','days','meta'])tx.objectStore(store).clear();tx.objectStore('meta').put({key:'initialized',value:true});});await reload();
    await importWords(Array.from({length:12},(_,i)=>({word:`fair${i}`,meaning:'队列公平性测试'})));await start();for(let i=0;i<36;i++){revealed=true;await answer(0);}check(todayRecord().completedWords===12,'队列困在前几个陌生词');report('PASS 连续遗忘仍能遍历全部新词');
    const savedQueue=JSON.stringify(session);words=[];records=[];session=null;db.close();db=null;await reload();check(JSON.stringify(session)===savedQueue&&words.length===12,'关闭连接后未恢复队列');report('PASS 关闭连接后重新打开词库及续学队列');
    location.hash='library';await new Promise(resolve=>setTimeout(resolve,0));$('#search').value='fair10';$('#filter').value='0';updateList();await refreshState();check($('#search').value==='fair10'&&$('#filter').value==='0','前台刷新丢失搜索条件');report('PASS 回到前台时保留搜索与筛选条件');
    window.Date=nativeDate;
    await transaction(['words','days','meta'],tx=>{for(const store of ['words','days','meta'])tx.objectStore(store).clear();tx.objectStore('meta').put({key:'initialized',value:true});});await reload();
    await importWords(await (await fetch('sample-words.json')).json());
    report('全部浏览器数据检查通过。');results.dataset.status='passed';
  } catch(error){report(`FAIL ${error.stack||error}`);results.dataset.status='failed';}
  finally {
    window.confirm=nativeConfirm;window.Date=nativeDate;Storage.prototype.setItem=nativeSetItem;notify=nativeNotify;
    transaction=nativeTransaction;
    if(oldSynthDescriptor)Object.defineProperty(window,'speechSynthesis',oldSynthDescriptor);else delete window.speechSynthesis;
    if(oldUtteranceDescriptor)Object.defineProperty(window,'SpeechSynthesisUtterance',oldUtteranceDescriptor);else delete window.SpeechSynthesisUtterance;
    HTMLAnchorElement.prototype.click=nativeAnchorClick;URL.createObjectURL=nativeObjectURL;foreign?.close();clearTimeout(clockTimer);runButton.disabled=false;
  }
});
