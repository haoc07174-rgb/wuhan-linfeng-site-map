const AREAS = [
  '江岸区','江汉区','硚口区','汉阳区','武昌区','青山区','洪山区',
  '东西湖区','蔡甸区','江夏区','黄陂区','新洲区','汉南区','东湖高新区','经开区'
];
const AMapCfg = { version: 2, map: 'lf-wuhan-map-config-v1', cache: 'lf-wuhan-geocode-v1' };
const CITY_CENTER = [114.305, 30.593];
const TAIL_ORDER = ['top','top-right','top-left','right','left','bottom-right','bottom-left','bottom'];
const app = { map:null, geocoder:null, data:[], locations:new Map(), markers:new Map(), polygons:[], areaPolygons:new Map(), selectedArea:'', busy:false, scheduled:false, geocodeStarted:false, config:null, toastTimer:0, mapLimit:null, pendingFocusId:null, boundariesStarted:false };

const $ = (id) => document.getElementById(id);
const areaList = $('area-list');
const dialog = $('setup-dialog');

async function start() {
  const [data, summary] = await Promise.all([
    fetch('./data/neighborhoods.json').then(r => { if (!r.ok) throw new Error('无法读取小区数据'); return r.json(); }),
    fetch('./data/summary.json').then(r => r.json())
  ]);
  app.data = data;
  app.summary = summary;
  try { app.locations = new Map(Object.entries(JSON.parse(localStorage.getItem(AMapCfg.cache) || '{}'))); } catch { app.locations = new Map(); }
  if (!localStorage.getItem(AMapCfg.cache)) {
    try { app.locations = new Map(Object.entries(JSON.parse(sessionStorage.getItem(AMapCfg.cache) || '{}'))); } catch { /* use empty cache */ }
  }
  renderAreas();
  renderCount();
  bindUi();
  const saved = localStorage.getItem(AMapCfg.map) || sessionStorage.getItem(AMapCfg.map);
  if (saved) {
    try { app.config = JSON.parse(saved); await connectMap(app.config); return; } catch { localStorage.removeItem(AMapCfg.map); }
  }
  $('map-status').textContent = '需要地图连接设置';
  if (dialog.showModal) dialog.showModal();
}

function bindUi() {
  $('setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = $('amap-key').value.trim();
    const secret = $('amap-secret').value.trim();
    if (!key || !secret) return;
    const oldConfig=app.config;
    app.config = {key, secret};
    if ($('remember-key').checked) localStorage.setItem(AMapCfg.map, JSON.stringify(app.config));
    else { localStorage.removeItem(AMapCfg.map); sessionStorage.setItem(AMapCfg.map, JSON.stringify(app.config)); }
    dialog.close();
    if (window.AMap?.Map) {
      if (oldConfig?.key!==key || oldConfig?.secret!==secret) window.location.reload();
      return;
    }
    try { await connectMap(app.config); } catch (error) { toast(error.message || '高德地图连接失败'); }
  });
  $('cancel-setup').addEventListener('click', () => dialog.close());
  document.querySelectorAll('.settings-trigger').forEach(b => b.addEventListener('click', () => {
    $('amap-key').value = app.config?.key || '';
    $('amap-secret').value = app.config?.secret || '';
    if (!dialog.open) dialog.showModal();
  }));
  areaList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-area]');
    if (!button) return;
    app.selectedArea = button.dataset.area;
    updateAreaSelection();
    renderCount();
    scheduleLayout(true);
    if (app.selectedArea) {
      focusArea(app.selectedArea);
      $('map-status').textContent = app.selectedArea + ' · ' + areaCount(app.selectedArea) + ' 个小区';
    } else $('map-status').textContent = '武汉市域 · ' + app.data.length + ' 个小区';
  });
  $('all-areas').addEventListener('click', () => {
    app.selectedArea = '';
    updateAreaSelection();
    renderCount();
    if (app.map) app.map.setCenter(CITY_CENTER);
    $('map-status').textContent = '武汉市域 · ' + app.data.length + ' 个小区';
    scheduleLayout(true);
  });
  $('zoom-in').addEventListener('click', () => app.map?.zoomIn());
  $('zoom-out').addEventListener('click', () => app.map?.zoomOut());
  $('home-view').addEventListener('click', () => { app.selectedArea = ''; updateAreaSelection(); renderCount(); app.map?.setZoomAndCenter(10, CITY_CENTER); scheduleLayout(true); });
  $('search-input').addEventListener('input', renderSearchResults);
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('search-results').hidden = true; } });
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('search-input').focus(); } });
  $('search-results').addEventListener('click', e => {
    const button = e.target.closest('[data-id]');
    if (!button) return;
    const item = app.data.find(x => x.id === button.dataset.id);
    if (!item) return;
    app.selectedArea = item.area; updateAreaSelection(); renderCount();
    $('search-results').hidden = true; $('search-input').value = item.name;
    const loc = app.locations.get(item.id);
    if (loc && app.map) { app.map.setZoomAndCenter(Math.max(15, app.map.getZoom()), [loc.lng,loc.lat]); scheduleLayout(true); showPoint(item); }
    else { app.pendingFocusId=item.id; toast('正在获取小区坐标，请稍候'); }
  });
  window.addEventListener('resize', () => scheduleLayout(true));
}

function areaCount(area) { return app.summary?.districts?.[area]?.communities ?? app.data.reduce((n,x)=>n+(x.area===area),0); }
function areaWorksiteCount(area) { return area ? (app.summary?.districts?.[area]?.openRecords || 0) : (app.summary?.openRecordTotal || 0); }
function renderAreas() {
  areaList.innerHTML = AREAS.map(area => `<button class="area-chip" type="button" data-area="${escapeAttr(area)}" aria-pressed="false"><span class="area-pin"></span><span class="area-name">${escapeHtml(area)}</span><span class="area-count">${areaCount(area)}</span></button>`).join('');
}
function updateAreaSelection() {
  for (const button of areaList.querySelectorAll('[data-area]')) {
    const active = button.dataset.area === app.selectedArea;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $('selected-area-label').textContent = app.selectedArea || '全武汉';
}
function renderCount() {
  const count = app.selectedArea ? areaCount(app.selectedArea) : app.data.length;
  $('visible-count').textContent = count.toLocaleString('zh-CN');
  $('visible-label').textContent = `个小区点位 · ${areaWorksiteCount(app.selectedArea)} 条开工记录`;
}
function renderSearchResults() {
  const input = $('search-input').value.trim();
  const box = $('search-results');
  if (!input) { box.hidden = true; return; }
  const results = app.data.filter(x => x.name.toLowerCase().includes(input.toLowerCase()) || x.area.includes(input)).slice(0,8);
  box.innerHTML = results.length ? results.map(x => `<button class="result-row" type="button" data-id="${x.id}"><span class="result-pin">⌖</span><span class="result-main"><span class="result-name">${escapeHtml(x.name)}</span><span class="result-area">${escapeHtml(x.area)}</span></span></button>`).join('') : '<div class="result-row"><span class="result-main"><span class="result-name">没有找到匹配的小区</span><span class="result-area">试试小区名称或行政区名称</span></span></div>';
  box.hidden = false;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function loadAmap({key,secret}) {
  if (window.AMap?.Map) return Promise.resolve(window.AMap);
  window._AMapSecurityConfig = { securityJsCode: secret };
  return new Promise((resolve,reject) => {
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder,AMap.DistrictSearch`;
    script.async = true;
    script.onload = () => window.AMap ? resolve(window.AMap) : reject(new Error('高德地图脚本未能初始化'));
    script.onerror = () => reject(new Error('地图脚本加载失败，请检查 Key、网络和域名白名单'));
    document.head.appendChild(script);
  });
}
async function connectMap(config) {
  $('map-status').textContent = '正在连接高德地图';
  const AMap = await loadAmap(config);
  app.map = new AMap.Map('map', {
    center:CITY_CENTER, zoom:10, viewMode:'2D', mapStyle:'amap://styles/normal',
    resizeEnable:true, pitch:0, rotation:0, rotateEnable:false, pitchEnable:false,
    zooms:[7,19], features:['bg','road','building','point'], showLabel:true
  });
  app.geocoder = new AMap.Geocoder({city:'武汉市', radius:1000, extensions:'base', batch:true});
  app.map.on('moveend', () => scheduleLayout());
  app.map.on('zoomchange', () => scheduleLayout(true));
  app.map.on('complete', () => {
    $('map-status').textContent = '武汉市域 · 正在定位小区';
    // Boundary lookup and geocoding are independent services. A stalled
    // DistrictSearch callback must never prevent the initial site labels.
    geocodeMissing();
    loadWuhanBoundaries(AMap).then(() => scheduleLayout(true));
  });
  $('map-status').textContent = '正在载入武汉地图';
}

async function loadWuhanBoundaries(AMap) {
  if (app.polygons.length || app.boundariesStarted) return;
  app.boundariesStarted = true;
  $('map-status').textContent = '正在绘制武汉行政区边界';
  return new Promise(resolve => {
    let settled = false;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!success) $('map-status').textContent = '武汉市域 · 正在定位小区';
      resolve(success);
    };
    const timeout = setTimeout(() => {
      toast('行政区边界加载超时，小区定位仍会继续');
      finish(false);
    }, 12000);
    const search = new AMap.DistrictSearch({subdistrict:1, extensions:'all', showbiz:false, level:'city'});
    search.search('420100', (status,result) => {
      if (status !== 'complete' || !result?.districtList?.[0]) { toast('武汉行政区边界暂时未能加载，小区定位仍会继续'); finish(false); return; }
      const city = result.districtList[0];
      const cityBounds = city.boundaries || [];
      for (const boundary of cityBounds) addPolygon(boundary,{strokeColor:'#405c43',strokeWeight:2.2,strokeOpacity:.9,fillColor:'#f5f2ea',fillOpacity:.035,zIndex:4});
      const list = city.districtList || [];
      for (const district of list) {
        if (!district.boundaries) continue;
        const normalized = normalizeDistrictName(district.name);
        for (const boundary of district.boundaries) {
          const polygon = addPolygon(boundary,{strokeColor:'#71836b',strokeWeight:1.1,strokeOpacity:.83,fillColor:'#f5f2ea',fillOpacity:.018,zIndex:5});
          if (normalized) {
            if (!app.areaPolygons.has(normalized)) app.areaPolygons.set(normalized,[]);
            app.areaPolygons.get(normalized).push(polygon);
          }
        }
      }
      if (cityBounds[0]) {
        try { app.mapLimit = new AMap.Bounds(cityBounds[0].map(p=>p.toArray())); } catch { /* keep visual city boundary */ }
      }
      $('map-status').textContent = '武汉市域 · ' + app.data.length + ' 个小区';
      finish(true);
    });
  });
  function addPolygon(path,style) {
    const polygon = new AMap.Polygon({path,...style,bubble:false,clickable:false});
    app.map.add(polygon); app.polygons.push(polygon); return polygon;
  }
}
function normalizeDistrictName(name='') {
  const n=String(name).replace(/武汉市/g,'');
  if (n.includes('东湖新技术')) return '东湖高新区';
  if (n.includes('经济技术开发')) return '经开区';
  return AREAS.find(a=>n.includes(a)) || '';
}
function focusArea(area) {
  const polygons=app.areaPolygons.get(area);
  if (polygons?.length) { app.map.setFitView(polygons,false,[42,42,42,42],13); return; }
  const first=app.data.find(x=>x.area===area && app.locations.has(x.id));
  if (first) app.map.setZoomAndCenter(Math.max(11,app.map.getZoom()),[app.locations.get(first.id).lng,app.locations.get(first.id).lat]);
}

function geocodeMissing() {
  if (app.geocodeStarted || !app.geocoder) return;
  app.geocodeStarted = true;
  const missing = app.data.filter(item => !app.locations.has(item.id));
  buildMarkers(app.data.filter(item=>app.locations.has(item.id)));
  if (!missing.length) { $('map-status').textContent = '武汉市域 · ' + app.data.length + ' 个小区'; return; }
  const progress = $('geo-progress'); progress.hidden = false;
  const cache = app.locations;
  let done = 0, nextBatch = 0, flush = [], failed=0;
  const total = missing.length;
  const batchSize = 8;
  const batches = Array.from({length:Math.ceil(total / batchSize)}, (_,i)=>missing.slice(i*batchSize,(i+1)*batchSize));
  const save = () => {
    try {
      const value = Object.fromEntries(cache);
      localStorage.setItem(AMapCfg.cache, JSON.stringify(value));
    } catch {
      try { sessionStorage.setItem(AMapCfg.cache, JSON.stringify(Object.fromEntries(cache))); } catch { /* cache is optional */ }
    }
  };
  const updateProgress = (count) => {
    done += count;
    const percent = Math.round(done / total * 100);
    $('progress-text').textContent = `正在定位小区 · ${done}/${total}`;
    $('progress-value').textContent = `${percent}%`;
    $('progress-bar').style.width = `${percent}%`;
    if (flush.length >= 16 || done === total) { buildMarkers(flush); flush = []; save(); }
    if (done === total) {
      $('progress-text').textContent = failed ? `已定位 ${cache.size} 个小区 · ${failed} 个待重试` : '小区坐标已更新';
      $('map-status').textContent = failed ? `已定位 ${cache.size} 个小区 · ${failed} 个待重试` : `已定位 ${cache.size} 个小区`;
      window.setTimeout(()=>{ progress.hidden=true; },2200);
    }
  };
  const workers = Array.from({length:3}, async () => {
    while (true) {
      const batch = batches[nextBatch++];
      if (!batch) return;
      let points = [];
      try { points = await locateBatch(batch); }
      catch {
        // Batch responses can omit unmatched addresses; retry those items
        // individually so a missing result never shifts coordinates to the
        // wrong community.
        points = await Promise.all(batch.map(item=>locate(item).catch(()=>null)));
      }
      for (let i=0;i<batch.length;i++) {
        const point = points[i];
        if (point) { cache.set(batch[i].id,point); flush.push(batch[i]); }
        else failed++;
      }
      updateProgress(batch.length);
      await new Promise(r=>setTimeout(r,220));
    }
  });
  Promise.all(workers).then(save);
}
function locateBatch(items) {
  return new Promise((resolve,reject) => {
    let settled=false;
    const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('geocode timeout'));}},15000);
    app.geocoder.getLocation(items.map(item=>item.query),(status,result)=>{
      if (settled) return;
      settled=true; clearTimeout(timer);
      const geocodes=result?.geocodes;
      if (status !== 'complete' || result?.info !== 'OK' || !Array.isArray(geocodes) || geocodes.length !== items.length) {
        reject(new Error(result?.info || status || 'batch geocode failed')); return;
      }
      resolve(geocodes.map(geo=>{
        const point=geo?.location;
        if (!point) return null;
        const lng=Number(point.lng),lat=Number(point.lat);
        return lng>113.7 && lng<115.15 && lat>29.8 && lat<31.5 ? {lng,lat} : null;
      }));
    });
  });
}
function locate(item) {
  return new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error('geocode timeout')),15000);
    app.geocoder.getLocation(item.query,(status,result)=>{
      clearTimeout(timer);
      const point = result?.geocodes?.[0]?.location;
      if (status === 'complete' && result?.info === 'OK' && point) {
        const lng=Number(point.lng), lat=Number(point.lat);
        if (lng>113.7 && lng<115.15 && lat>29.8 && lat<31.5) resolve({lng,lat});
        else resolve(null);
      } else reject(new Error(result?.info || status || 'geocode failed'));
    });
  });
}

function buildMarkers(items=null) {
  if (!app.map) return;
  const batch = items || app.data;
  for (const item of batch) {
    const location = app.locations.get(item.id);
    if (!location || app.markers.has(item.id)) continue;
    const content = document.createElement('div');
    content.className = 'map-label tail-top';
    content.textContent = item.name;
    content.title = `${item.area} · ${item.name}`;
    content.setAttribute('role','button');
    content.setAttribute('aria-label',`${item.area}，${item.name}`);
    content.addEventListener('click',()=>showPoint(item));
    const marker = new AMap.Marker({position:[location.lng,location.lat],content,anchor:'top-left',offset:new AMap.Pixel(0,0),zIndex:60,topWhenClick:true,clickable:true,visible:true,extData:{id:item.id}});
    marker.__lf = {item,content};
    app.markers.set(item.id,marker);
    app.map.add(marker);
  }
  if (app.pendingFocusId && app.locations.has(app.pendingFocusId)) {
    const item=app.data.find(x=>x.id===app.pendingFocusId), loc=app.locations.get(app.pendingFocusId);
    app.pendingFocusId=null;
    if (item) { app.selectedArea=item.area; updateAreaSelection(); renderCount(); app.map.setZoomAndCenter(15,[loc.lng,loc.lat]); showPoint(item); }
  }
  scheduleLayout(true);
}
function showPoint(item) {
  const loc=app.locations.get(item.id);
  if (loc && app.map) app.map.setCenter([loc.lng,loc.lat]);
  toast(`${item.area} · ${item.name}`);
}
function scheduleLayout(force=false) {
  if (!app.map || app.scheduled) return;
  app.scheduled=true;
  requestAnimationFrame(()=>{ app.scheduled=false; layoutMarkers(force); });
}
function layoutMarkers() {
  const AMap=window.AMap;
  if (!app.map || !AMap) return;
  const mapEl=$('map');
  const width=mapEl.clientWidth,height=mapEl.clientHeight;
  const visible=[];
  const bounds=app.map.getBounds();
  for (const marker of app.markers.values()) {
    const {item,content}=marker.__lf;
    const show=!app.selectedArea || item.area===app.selectedArea;
    marker.setVisible(show);
    if (!show) continue;
    const pos=marker.getPosition();
    if (bounds && !bounds.contains(pos)) { marker.setVisible(false); continue; }
    const p=app.map.lngLatToContainer(pos);
    if (!p || p.x < -40 || p.x > width+40 || p.y < -40 || p.y > height+40) { marker.setVisible(false); continue; }
    visible.push({marker,item,content,x:p.x,y:p.y});
  }
  const densityRadius=112;
  for (const node of visible) {
    let neighbors=0;
    for (const other of visible) if (node!==other && Math.hypot(node.x-other.x,node.y-other.y)<densityRadius) neighbors++;
    node.neighbors=neighbors;
    node.content.classList.toggle('dense-9',neighbors>=15);
    node.content.classList.toggle('dense-10',neighbors>=8 && neighbors<15);
  }
  visible.sort((a,b)=>b.neighbors-a.neighbors || a.item.name.localeCompare(b.item.name,'zh-CN'));
  const placed=[];
  const gap=5, edge=8;
  for (const node of visible) {
    node.content.classList.remove('unplaced');
    const w=Math.max(node.content.offsetWidth,30),h=Math.max(node.content.offsetHeight,20);
    let chosen=null;
    for (let ring=0;ring<8 && !chosen;ring++) {
      const r=12+ring*24;
      for (let i=0;i<TAIL_ORDER.length;i++) {
        const side=TAIL_ORDER[i];
        const d=directionOffset(side,r,w,h);
        const x=clamp(node.x+d.x,edge,width-w-edge);
        const y=clamp(node.y+d.y,edge,height-h-edge);
        const rect={x,y,w,h};
        if (placed.every(p=>!intersects(rect,p,gap))) { chosen={x,y,side}; break; }
      }
    }
    if (!chosen) {
      node.content.classList.add('unplaced');
      node.marker.setVisible(false);
      continue;
    }
    node.marker.setVisible(true);
    node.content.className=`map-label tail-${chosen.side}${node.neighbors>=15?' dense-9':node.neighbors>=8?' dense-10':''}`;
    node.marker.setOffset(new AMap.Pixel(Math.round(chosen.x-node.x),Math.round(chosen.y-node.y)));
    placed.push({x:chosen.x,y:chosen.y,w,h});
  }
  const missing=app.data.reduce((n,item)=>n+((!app.selectedArea || item.area===app.selectedArea) && !app.locations.has(item.id)),0);
  $('visible-label').textContent=missing>0?`个小区点位 · ${missing} 个待定位`:'个小区点位';
}
function directionOffset(side,r,w,h) {
  if (side==='top') return {x:-w/2,y:-h-r};
  if (side==='bottom') return {x:-w/2,y:r};
  if (side==='top-right') return {x:r,y:-h-r};
  if (side==='top-left') return {x:-w-r,y:-h-r};
  if (side==='bottom-right') return {x:r,y:r};
  if (side==='bottom-left') return {x:-w-r,y:r};
  if (side==='right') return {x:r,y:-h/2};
  return {x:-w-r,y:-h/2};
}
function intersects(a,b,g) { return a.x < b.x+b.w+g && a.x+a.w+g > b.x && a.y < b.y+b.h+g && a.y+a.h+g > b.y; }
function clamp(n,min,max) { return Math.max(min,Math.min(n,max)); }
function toast(text) {
  const node=$('toast'); node.textContent=text; node.classList.add('show');
  window.clearTimeout(app.toastTimer); app.toastTimer=window.setTimeout(()=>node.classList.remove('show'),2300);
}

start().catch(error=>{ $('map-status').textContent='小区数据加载失败'; toast(error.message || '网站数据加载失败'); });

