'use strict';

var CATS = [
  { id:'stations', label:'Space Stations', color:'#00ffcc' },
  { id:'starlink',  label:'Starlink',       color:'#4488ff' },
  { id:'gps',       label:'GPS',            color:'#ffcc00' },
  { id:'weather',   label:'Weather',        color:'#ff8800' },
  { id:'military',  label:'Military',       color:'#ff4444' },
  { id:'science',   label:'Science',        color:'#cc44ff' },
  { id:'amateur',   label:'Amateur',        color:'#44ff88' },
  { id:'debris',    label:'Debris',         color:'#556677' },
];

var allSats  = [];
var filtered = [];
var selected = null;
var activeFilters = {};
var loadedGroups  = {}; 
var searchQ  = '';
var scene, camera, renderer, earthMesh, satGroup;
var visibilityCone = null; 
var dragging = false, px = 0, py = 0;
var rotX = 0.3, rotY = 0, zoom = 2.8;
var lastUpd  = 0;

// NEW: Time Machine Variables
var timeMultiplier = 1;
var virtualTime = new Date();
var lastFrameTime = Date.now();

CATS.forEach(function(c){ 
  activeFilters[c.id] = (c.id === 'gps'); 
  loadedGroups[c.id]  = false;
});

var CELESTRAK_MAP = {
  'stations': 'stations', 'starlink': 'starlink', 'gps': 'gps-ops',
  'weather': 'weather', 'military': 'military', 'science': 'science',
  'amateur': 'amateur', 'debris': '1999-025' 
};

function fetchGroup(catId, done) {
  var groupName = CELESTRAK_MAP[catId] || catId;
  var directUrl = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=' + groupName + '&FORMAT=tle';
  var proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(directUrl);

  fetch(directUrl)
    .then(r => r.ok ? r.text() : Promise.reject())
    .catch(() => fetch(proxyUrl).then(r2 => r2.text()))
    .then(txt => done(null, txt))
    .catch(e => done(e, null));
}

function parseTLE(text, catId) {
  var lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  var out = [];
  var totalSats = Math.floor(lines.length / 3);
  var maxLimit = Math.max(1, Math.floor(totalSats * 0.50)); 
  var count = 0;

  for (var i = 0; i + 2 < lines.length; i += 3) {
    if (count >= maxLimit) break;
    var name = lines[i].replace(/^0 /, '').trim();
    var l1 = lines[i+1], l2 = lines[i+2];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    try {
      var satrec = satellite.twoline2satrec(l1, l2);
      out.push({ name, norad: l2.substring(2,7).trim(), l1, l2, cat: catId, 
                 satrec, inc: parseFloat(l2.substring(8,16)), period: (1440/parseFloat(l2.substring(52,63))).toFixed(1) });
      count++;
    } catch(e) {}
  }
  return out;
}

function getPos(satrec, date) {
  var pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position) return null;
  var gmst = satellite.gstime(date);
  var geo  = satellite.eciToGeodetic(pv.position, gmst);
  return { lat: satellite.degreesLat(geo.latitude), lon: satellite.degreesLong(geo.longitude), 
           alt: geo.height, vel: Math.sqrt(pv.velocity.x**2 + pv.velocity.y**2 + pv.velocity.z**2) };
}

function lla2xyz(lat, lon, alt) {
  var R = 1.0 + (alt / 6371);
  var phi = (90 - lat) * Math.PI / 180, the = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(-R * Math.sin(phi) * Math.cos(the), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(the));
}

function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.01, 1000);
  camera.position.set(0, 0, zoom);
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 64, 64), new THREE.MeshPhongMaterial({
    map: new THREE.TextureLoader().load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
  }));
  scene.add(earthMesh);
  scene.add(new THREE.AmbientLight(0x444444, 1.5));
  var sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(5,3,5); scene.add(sun);

  satGroup = new THREE.Group(); scene.add(satGroup);
  
  renderer.domElement.addEventListener('mousedown', e => { dragging=true; px=e.clientX; py=e.clientY; });
  window.addEventListener('mouseup', () => dragging=false);
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    rotY += (e.clientX-px)*0.005; rotX += (e.clientY-py)*0.005;
    rotX = Math.max(-Math.PI/2, Math.min(Math.PI/2, rotX));
    px = e.clientX; py = e.clientY;
  });
  renderer.domElement.addEventListener('wheel', e => { zoom = Math.max(1.1, Math.min(15, zoom + e.deltaY*0.005)); e.preventDefault(); }, {passive:false});
  renderer.domElement.addEventListener('click', onCanvasClick);
}

function buildMeshes() {
  while(satGroup.children.length) satGroup.remove(satGroup.children[0]);
  allSats.forEach(sat => {
    var pos = getPos(sat.satrec, virtualTime);
    if (!pos) return;
    sat.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.006, 4, 4), getMat(sat.cat));
    sat.mesh.position.copy(lla2xyz(pos.lat, pos.lon, pos.alt));
    sat.mesh.userData = { sat };
    satGroup.add(sat.mesh);
  });
}

function animate() {
  requestAnimationFrame(animate);
  var now = Date.now();
  var delta = now - lastFrameTime;
  lastFrameTime = now;

  // NEW: Update Virtual Time based on multiplier
  virtualTime = new Date(virtualTime.getTime() + (delta * timeMultiplier));

  // NEW: Earth rotation matches time speed (approx 0.0004 rad/frame at real-time)
  earthMesh.rotation.y += 0.0004 * timeMultiplier;

  // Update Satellites
  satGroup.children.forEach(m => {
    var sat = m.userData.sat;
    var pos = getPos(sat.satrec, virtualTime);
    if (pos) {
      m.position.copy(lla2xyz(pos.lat, pos.lon, pos.alt));
      m.visible = activeFilters[sat.cat] && passesSearch(sat);
      if (selected === sat) {
        updateInfoCard(sat, pos);
        if (visibilityCone) {
          visibilityCone.position.copy(m.position);
          visibilityCone.lookAt(0,0,0);
        }
      }
    }
  });

  camera.position.set(zoom*Math.sin(rotY)*Math.cos(rotX), zoom*Math.sin(rotX), zoom*Math.cos(rotY)*Math.cos(rotX));
  camera.lookAt(0,0,0);
  document.getElementById('hud-time').textContent = virtualTime.toUTCString().slice(17, 25);
  document.getElementById('hud-date').textContent = virtualTime.toUTCString().slice(0, 16) + ' UTC';
  renderer.render(scene, camera);
}

function selectSat(sat) {
  selected = sat;
  document.getElementById('info').style.display = 'block';
  if (visibilityCone) scene.remove(visibilityCone);
  var r = 1.0 + (sat.pos.alt / 6371), y = 1.0/r, H = r-y, rad = Math.sqrt(1-(1.0/r)**2);
  visibilityCone = new THREE.Mesh(new THREE.ConeGeometry(rad, H, 64, 1, true), new THREE.MeshBasicMaterial({ color: getMat(sat.cat).color, transparent:true, opacity:0.3, blending:THREE.AdditiveBlending }));
  visibilityCone.geometry.translate(0, -H/2, 0); visibilityCone.geometry.rotateX(-Math.PI/2);
  scene.add(visibilityCone);
}

function updateInfoCard(sat, pos) {
  document.getElementById('i-name').textContent = sat.name;
  document.getElementById('i-norad').textContent = sat.norad;
  document.getElementById('i-alt').textContent = pos.alt.toFixed(0) + ' km';
  document.getElementById('i-lat').textContent = pos.lat.toFixed(2) + '°';
  document.getElementById('i-lon').textContent = pos.lon.toFixed(2) + '°';
}

function loadSpecificGroup(id) {
  var btn = document.querySelector(`.fbtn[data-id="${id}"]`); btn.textContent = 'Loading...';
  fetchGroup(id, (err, txt) => {
    btn.textContent = CATS.find(c=>c.id===id).label;
    if (!err) { allSats = allSats.concat(parseTLE(txt, id)); loadedGroups[id] = true; buildMeshes(); applyFilters(); }
  });
}

function buildFilterBar() {
  var bar = document.getElementById('filter-bar');
  CATS.forEach(cat => {
    var btn = document.createElement('div'); btn.className = 'fbtn'; btn.textContent = cat.label; btn.dataset.id = cat.id;
    btn.style.borderColor = cat.color; btn.style.color = activeFilters[cat.id] ? '#000' : cat.color;
    btn.style.background = activeFilters[cat.id] ? cat.color : '';
    btn.onclick = () => {
      activeFilters[cat.id] = !activeFilters[cat.id];
      if (activeFilters[cat.id] && !loadedGroups[cat.id]) loadSpecificGroup(cat.id);
      btn.style.background = activeFilters[cat.id] ? cat.color : '';
      btn.style.color = activeFilters[cat.id] ? '#000' : cat.color;
      applyFilters();
    };
    bar.appendChild(btn);
  });
}

// NEW: Time Slider Listener
document.addEventListener('DOMContentLoaded', () => {
  initThree(); buildFilterBar(); buildLegend();
  document.getElementById('time-slider').oninput = (e) => {
    timeMultiplier = parseInt(e.target.value);
    var label = timeMultiplier === 1 ? 'Real-time' : (timeMultiplier > 0 ? timeMultiplier + 'x Fast' : Math.abs(timeMultiplier) + 'x Reverse');
    document.getElementById('speed-val').textContent = label;
  };
  document.getElementById('search').oninput = (e) => { searchQ = e.target.value.toLowerCase(); applyFilters(); };
  document.getElementById('info-close').onclick = () => { document.getElementById('info').style.display='none'; selected=null; scene.remove(visibilityCone); };
  loadInitial();
});

function getMat(id) { return new THREE.MeshBasicMaterial({ color: CATS.find(c=>c.id===id).color }); }
function passesSearch(s) { return !searchQ || s.name.toLowerCase().includes(searchQ) || s.norad.includes(searchQ); }
function applyFilters() { filtered = allSats.filter(s => activeFilters[s.cat] && passesSearch(s)); renderList(); document.getElementById('sat-count').textContent = filtered.length; }
function renderList() { var list = document.getElementById('sat-list'); list.innerHTML = ''; filtered.slice(0,100).forEach(s => { var d = document.createElement('div'); d.className = 'sitem'; d.innerHTML = `<div class="sname">${s.name}</div><div class="smeta">NORAD ${s.norad}</div>`; d.onclick = () => selectSat(s); list.appendChild(d); }); }
function buildLegend() { var body = document.getElementById('legend-body'); CATS.forEach(cat => { var r = document.createElement('div'); r.className='lrow'; r.innerHTML=`<div class="ldot" style="background:${cat.color}"></div><span>${cat.label}</span>`; body.appendChild(r); }); }
function loadInitial() { fetchGroup('gps', (err, txt) => { if (!err) { allSats = parseTLE(txt, 'gps'); loadedGroups['gps']=true; buildMeshes(); applyFilters(); } document.getElementById('loading').style.display='none'; requestAnimationFrame(animate); }); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
