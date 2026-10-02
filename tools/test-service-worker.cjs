// 离线资源、版本更新、缓存隔离与 manifest 检查，无 npm 依赖。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function environment(failInstall=false,scope='https://example.test/cet6/'){
  const handlers={},entries=new Map([['cet6-shell-v1',new Map()],['other-app',new Map()]]);
  const state={requests:[],network:0,skipped:false,claimed:false};
  const context={URL,Request,Response,Promise,
    self:{registration:{scope},addEventListener:(type,fn)=>handlers[type]=fn,skipWaiting:async()=>{state.skipped=true;},clients:{claim:async()=>{state.claimed=true;}}},
    caches:{open:async name=>{
      if(!entries.has(name))entries.set(name,new Map());const values=entries.get(name);
      return {addAll:async requests=>{state.requests=requests;if(failInstall)throw new Error('offline during update');for(const r of requests)values.set(r.url,new Response(r.url.endsWith('index.html')?'current HTML':'current asset'));},match:async key=>values.get(typeof key==='string'?key:key.url)?.clone()};
    },keys:async()=>[...entries.keys()],delete:async key=>entries.delete(key)},
    fetch:async()=>{state.network++;return new Response('network fallback');}
  };
  vm.runInNewContext(fs.readFileSync('service-worker.js','utf8'),context);
  const lifetime=async type=>{let promise;handlers[type]({waitUntil:p=>promise=p});await promise;};
  const fetchRequest=async request=>{let promise;handlers.fetch({request,respondWith:p=>promise=p});return promise?await promise:undefined;};
  return {state,entries,lifetime,fetchRequest};
}
(async()=>{
  const env=environment();await env.lifetime('install');assert.ok(env.state.skipped);assert.ok(env.state.requests.every(r=>r.cache==='reload'));
  await env.lifetime('activate');assert.ok(env.state.claimed);assert.ok(!env.entries.has('cet6-shell-v1'));assert.ok(env.entries.has('other-app'));
  const page=await env.fetchRequest({method:'GET',url:'https://example.test/cet6/?qa=1',mode:'navigate'});assert.equal(await page.text(),'current HTML');
  const asset=await env.fetchRequest({method:'GET',url:'https://example.test/cet6/app.js',mode:'cors'});assert.equal(await asset.text(),'current asset');assert.equal(env.state.network,0);
  assert.equal(await env.fetchRequest({method:'GET',url:'https://example.test/cet6/tools/browser-audit.html',mode:'navigate'}),undefined);
  assert.equal(await env.fetchRequest({method:'POST',url:'https://example.test/cet6/',mode:'cors'}),undefined);
  assert.equal(await env.fetchRequest({method:'GET',url:'https://other.test/app.js',mode:'cors'}),undefined);
  const failed=environment(true);await assert.rejects(()=>failed.lifetime('install'));assert.equal(failed.state.skipped,false);assert.ok(failed.entries.has('cet6-shell-v1'));
  const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
  for(const icon of manifest.icons){const png=fs.readFileSync(icon.src),size=png.readUInt32BE(16);assert.equal(png.readUInt32BE(20),size);assert.equal(icon.sizes,`${size}x${size}`);}
  // 同时验证站点根目录和 GitHub Pages 的大小写敏感项目子目录。
  const html=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('app.js','utf8');
  const resources=[...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map(match=>match[1]);
  const sample=app.match(/fetch\('([^']+sample-words\.json|sample-words\.json)'\)/)?.[1];
  const worker=app.match(/serviceWorker\.register\('([^']+)'/)?.[1];
  assert.ok(sample);assert.ok(worker);assert.ok(fs.existsSync('.nojekyll'));
  for(const scope of ['https://username.github.io/','https://username.github.io/CET-6/']){
    for(const page of [scope,new URL('index.html',scope).href]){
      for(const path of [...resources,sample,worker]){
        const resolved=new URL(path,page);assert.ok(resolved.href.startsWith(scope),`${path} escapes ${scope}`);
        assert.ok(fs.existsSync(path),`missing resource: ${path}`);
      }
    }
    const manifestURL=new URL('manifest.json',scope);
    assert.equal(new URL(manifest.start_url,manifestURL).href,scope);
    assert.equal(new URL(manifest.scope,manifestURL).href,scope);
    for(const icon of manifest.icons)assert.ok(new URL(icon.src,manifestURL).href.startsWith(scope));
    const scoped=environment(false,scope);await scoped.lifetime('install');
    for(const request of scoped.state.requests){
      assert.ok(request.url.startsWith(scope));
      assert.ok(fs.existsSync(decodeURIComponent(request.url.slice(scope.length))));
      const cached=await scoped.fetchRequest({method:'GET',url:request.url,mode:'cors'});assert.ok(cached);
    }
    for(const url of [scope,scope+'?offline=1',new URL('index.html',scope).href]){
      const cached=await scoped.fetchRequest({method:'GET',url,mode:'navigate'});assert.equal(await cached.text(),'current HTML');
    }
    assert.equal(scoped.state.network,0);
    if(new URL(scope).pathname!=='/')assert.equal(await scoped.fetchRequest({method:'GET',url:'https://username.github.io/app.js',mode:'cors'}),undefined);
  }
  console.log('PASS: coherent shell cache, HTTP cache bypass, offline navigation/assets, failed update safety, scoped cache cleanup, manifest/icons');
  console.log('PASS: root and /CET-6/ deployment paths, HTML resources, sample fetch, worker registration, manifest URLs, scoped offline cache, .nojekyll');
})().catch(e=>{console.error(e);process.exitCode=1;});
