const CACHE = 'cet6-shell-v12';
const FILES = ['./index.html', './style.css', './app.js', './sample-words.json', './manifest.json', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];
const urls = FILES.map(file => new URL(file, self.registration.scope).href);
// 每个版本缓存一整套资源；安装时跳过 HTTP 旧缓存，避免新 HTML 配上旧 JS。
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(urls.map(url => new Request(url, {cache:'reload'})))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('cet6-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  if(event.request.method!=='GET'||url.origin!==scope.origin)return;
  const navigation=event.request.mode==='navigate'&&(url.pathname===scope.pathname||url.pathname===new URL('./index.html',scope).pathname);
  const key=navigation?urls[0]:url.origin+url.pathname;
  if(!navigation&&!urls.includes(key))return;
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(key)).then(cached=>cached||fetch(event.request)));
});
