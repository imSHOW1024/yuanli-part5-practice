'use strict';
const BUILD = {"release":"1026v43-trainer-r26","cache":"cycu-yuanli-pwa-1026v43-trainer-r26-96a33cb10ffeac83","assets":[{"path":"index.html","sha256":"96a33cb10ffeac83d9535ff958515366296d1cfa206743be084bf99e744766ef"},{"path":"manifest.webmanifest","sha256":"209ecffde8b75a12817530031637a1534ba7924ef5490762859e1e00b4ed572d"},{"path":"pwa-192.png","sha256":"61a2fa4353d78d66313ea8db08f73abb77abd3e1f9309eb8223d50a2d80e9fa7"},{"path":"pwa-512.png","sha256":"a64067ae7f62590b5f23a946df414d41be34ca303096254e332e487260b58a9b"}]};
const ROOT = new URL('./', self.location.href);
const READY = new URL('__offline_ready__', ROOT).href;
const STATE_CACHE = 'cycu-yuanli-pwa-state';
const SELECTED = new URL('__offline_selected__', ROOT).href;
async function selection() {
  const response = await (await caches.open(STATE_CACHE)).match(SELECTED);
  return response ? response.json() : BUILD;
}
async function selectBuild(build) {
  await (await caches.open(STATE_CACHE)).put(SELECTED, new Response(JSON.stringify(build), {headers:{'Content-Type':'application/json'}}));
}
async function complete(build) {
  const cache = await caches.open(build.cache);
  if (!(await cache.match(READY))) return false;
  for (const asset of build.assets) if (!(await cache.match(new URL(asset.path,ROOT).href))) return false;
  return true;
}
async function download(build, name = build.cache) {
  const cache = await caches.open(name);
  try {
    for (const asset of build.assets) {
      const response = await fetch(new URL(asset.path,ROOT).href, {cache:'no-store',redirect:'error'});
      if (!response.ok) throw new Error('Download failed: '+asset.path);
      const bytes = await response.clone().arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if (digest !== asset.sha256) throw new Error('Incomplete or changed file: '+asset.path);
      await cache.put(new URL(asset.path,ROOT).href,response);
    }
    // Written last: partial downloads are never ready.
    await cache.put(READY,new Response(JSON.stringify({release:build.release}),{headers:{'Content-Type':'application/json'}}));
  } catch (error) { await caches.delete(name); throw error; }
}
async function cleanup() {
  const chosen = await selection();
  for (const name of await caches.keys()) {
    if (name.startsWith('cycu-yuanli-pwa-') && ![STATE_CACHE,chosen.cache,BUILD.cache].includes(name)) await caches.delete(name);
  }
}
self.addEventListener('install',event=>event.waitUntil(download(BUILD)));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Browser activation may happen when all old windows close. Keep the last
  // explicitly selected content revision until the user presses Apply Update.
  const state = await caches.open(STATE_CACHE);
  if (!(await state.match(SELECTED))) await selectBuild(BUILD);
  await self.clients.claim();
  await cleanup();
})()));
self.addEventListener('message',event=>{
  const type = event.data?.type;
  if (!['APPLY_UPDATE','OFFLINE_STATUS','REPAIR_OFFLINE'].includes(type)) return;
  event.waitUntil((async()=>{
    try {
      if (type==='APPLY_UPDATE') {
        if (!(await complete(BUILD))) throw new Error('New version is incomplete');
        await selectBuild(BUILD);
        await self.skipWaiting();
        await cleanup();
        event.ports[0]?.postMessage({ok:true});return;
      }
      const chosen = await selection();
      if (type==='REPAIR_OFFLINE' && !(await complete(chosen))) {
        const staging = chosen.cache+'-repair';
        await download(chosen,staging);
        try {
          const source = await caches.open(staging),target = await caches.open(chosen.cache);
          await target.delete(READY);
          for (const asset of chosen.assets) {
            const url = new URL(asset.path,ROOT).href;
            await target.put(url,await source.match(url));
          }
          await target.put(READY,await source.match(READY));
        } finally {await caches.delete(staging);}
      }
      event.ports[0]?.postMessage({ok:true,ready:await complete(chosen),release:chosen.release,updateAvailable:chosen.cache!==BUILD.cache && await complete(BUILD)});
    } catch(error) {event.ports[0]?.postMessage({ok:false,error:error.message});}
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
  const asset=BUILD.assets.find(a=>new URL(a.path,ROOT).pathname===url.pathname);
  const entry=request.mode==='navigate'&&(url.pathname===ROOT.pathname||url.pathname===new URL('index.html',ROOT).pathname);
  if(!asset&&!entry)return;
  event.respondWith((async()=>{
    const chosen=await selection(),cache=await caches.open(chosen.cache);
    if(await cache.match(READY)){
      const hit=await cache.match(entry?new URL('index.html',ROOT).href:new URL(asset.path,ROOT).href);
      if(hit)return hit;
    }
    return fetch(request);
  })());
});
