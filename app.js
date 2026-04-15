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

var allSats = [], filtered = [], selected = null, activeFilters = {}, loadedGroups = {};
var scene, camera, renderer, earthMesh, satGroup, visibilityCone = null;
var rotX = 0.3, rotY = 0, zoom = 4.0, dragging = false, px = 0, py = 0, searchQ = '';
var timeMultiplier = 1, virtualTime = new Date(), lastFrameTime = Date.now();

CATS.forEach(c => { activeFilters[c.id] = (c.id === 'gps'); loadedGroups[c.id] = false; });

var CELESTRAK_MAP = { 'stations':'stations', 'starlink':'starlink', 'gps':'gps-ops', 'weather':'weather', 'military':'military', 'science':'science', 'amateur':'amateur', 'debris':'1999-025' };

function fetchGroup(catId, done) {
  var group = CELESTRAK_MAP[catId] || catId;
  var url = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://celestrak.org/NORAD/elements/gp.php?GROUP='+group+'&FORMAT=tle')}`;
  fetch(url).then(r => r.text()).then(t => done(null, t)).catch(e => done(e, null));
}

function parseTLE(text, catId) {
  var lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  var out = [], total = Math.floor(lines.length/3), limit = Math.floor(total * 0.5);
  for (var i=0; i<lines.length && out.length<limit; i+=3) {
    if (!lines[i+1] || !lines[i+1].startsWith('1 ')) continue;
    try {
      var satrec = satellite.twoline2satrec(lines[i+1], lines[i+2]);
      out.push({ name: lines[i].replace(/^0 /,''), norad: lines[i+2].substring(2,7).trim(), cat: catId, satrec });
    } catch(e){}
  }
  return out;
}

function getPos(satrec, date) {
  var pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position) return null;
  var geo = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
  var R = 1.0 + (geo.height/6371);
  var phi = (90-satellite.degreesLat(geo.latitude))*Math.PI/180, the = (satellite.degreesLong(geo.longitude)+180)*Math.PI/180;
  return { x: -R*Math.sin(phi)*Math.cos(the), y: R*Math.cos(phi), z: R*Math.sin(phi)*Math.sin(the), alt: geo.height, lat: satellite.degreesLat(geo.latitude), lon: satellite.degreesLong(geo.longitude) };
}

function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.01, 1000);
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('canvas-container').appendChild(renderer.domElement);
  earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1,64,64), new THREE.MeshPhongMaterial({ map: new THREE.TextureLoader().load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg') }));
  scene.add(earthMesh);
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  var sun = new THREE.DirectionalLight(0xffffff, 1); sun.position.set(5,3,5); scene.add(sun);
  satGroup = new THREE.Group(); scene.add(satGroup);
  renderer.domElement.addEventListener('mousedown', e => { dragging=true; px=e.clientX; py=e.clientY; });
  window.addEventListener('mouseup', () => dragging=false);
  window.addEventListener('mousemove', e => { if(dragging) { rotY+=(e.clientX-px)*0.005; rotX+=(e.clientY-py)*0.005; px=e.clientX; py=e.clientY; } });
  renderer.domElement.addEventListener('wheel', e => { zoom = Math.max(1.1, Math.min(20, zoom+e.deltaY*0.005)); e.preventDefault(); }, {passive:false});
  renderer.domElement.addEventListener('click', onCanvasClick);
}

function animate() {
  requestAnimationFrame(animate);
  var now = Date.now(), delta = now - lastFrameTime; lastFrameTime = now;
  virtualTime = new Date(virtualTime.getTime() + (delta * timeMultiplier));
  earthMesh.rotation.y += 0.0002 * timeMultiplier;
  satGroup.children.forEach(m => {
    var p = getPos(m.userData.sat.satrec, virtualTime);
    if(p) { m.position.set(p.x, p.y, p.z); m.visible = activeFilters[m.userData.sat.cat] && (!searchQ || m.userData.sat.name.toLowerCase().includes(searchQ)); }
    if(selected === m.userData.sat && p) {
      document.getElementById('i-alt').textContent = p.alt.toFixed(0)+'km';
      if(visibilityCone) { visibilityCone.position.copy(m.position); visibilityCone.lookAt(0,0,0); }
    }
  });
  camera.position.set(zoom*Math.sin(rotY)*Math.cos(rotX), zoom*Math.sin(rotX), zoom*Math.cos(rotY)*Math.cos(rotX));
  camera.lookAt(0,0,0);
  document.getElementById('hud-time').textContent = virtualTime.toUTCString().slice(17,25);
  document.getElementById('hud-date').textContent = virtualTime.toUTCString().slice(0,16);
  renderer.render(scene, camera);
}

function onCanvasClick(e) {
  var rect = renderer.domElement.getBoundingClientRect();
  var mouse = new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
  var rc = new THREE.Raycaster(); rc.setFromCamera(mouse, camera);
  var hits = rc.intersectObjects(satGroup.children);
  if (hits.length) selectSat(hits[0].object.userData.sat);
}

function selectSat(sat) {
  selected = sat; document.getElementById('info').style.display = 'block';
  document.getElementById('i-name').textContent = sat.name; document.getElementById('i-norad').textContent = sat.norad;
  if(visibilityCone) scene.remove(visibilityCone);
  var p = getPos(sat.satrec, virtualTime);
  var r = 1.0 + (p.alt/6371), y = 1.0/r, H = r-y, rad = Math.sqrt(1-y**2);
  visibilityCone = new THREE.Mesh(new THREE.ConeGeometry(rad, H, 64, 1, true), new THREE.MeshBasicMaterial({ color: CATS.find(c=>c.id===sat.cat).color, transparent:true, opacity:0.3, blending:THREE.AdditiveBlending }));
  visibilityCone.geometry.translate(0, -H/2, 0); visibilityCone.geometry.rotateX(-Math.PI/2);
  scene.add(visibilityCone);
}

function loadGroup(id) {
  var btn = document.querySelector(`.fbtn[data-id="${id}"]`); btn.textContent = '...';
  fetchGroup(id, (err, txt) => {
    btn.textContent = CATS.find(c=>c.id===id).label;
    if(!err) {
      var newSats = parseTLE(txt, id);
      newSats.forEach(s => {
        var p = getPos(s.satrec, virtualTime);
        if(p) {
          var m = new THREE.Mesh(new THREE.SphereGeometry(0.006, 4, 4), new THREE.MeshBasicMaterial({ color: CATS.find(c=>c.id===id).color }));
          m.userData = { sat: s }; m.position.set(p.x, p.y, p.z); satGroup.add(m);
        }
      });
      allSats = allSats.concat(newSats); loadedGroups[id] = true;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initThree();
  var bar = document.getElementById('filter-bar');
  CATS.forEach(c => {
    var b = document.createElement('div'); b.className = 'fbtn'; b.textContent = c.label; b.dataset.id = c.id;
    b.style.borderColor = c.color; b.style.background = activeFilters[c.id] ? c.color : ''; b.style.color = activeFilters[c.id] ? '#000' : c.color;
    b.onclick = () => { activeFilters[c.id] = !activeFilters[c.id]; b.style.background = activeFilters[c.id] ? c.color : ''; b.style.color = activeFilters[c.id] ? '#000' : c.color; if(activeFilters[c.id] && !loadedGroups[c.id]) loadGroup(c.id); };
    bar.appendChild(b);
  });
  document.getElementById('time-slider').oninput = (e) => { timeMultiplier = parseInt(e.target.value); document.getElementById('speed-val').textContent = timeMultiplier === 1 ? 'Real-time' : timeMultiplier + 'x Speed'; };
  document.getElementById('search').oninput = (e) => searchQ = e.target.value.toLowerCase();
  document.getElementById('info-close').onclick = () => { document.getElementById('info').style.display='none'; selected=null; if(visibilityCone) scene.remove(visibilityCone); };
  loadGroup('gps');
  document.getElementById('loading').style.display='none';
  animate();
});
