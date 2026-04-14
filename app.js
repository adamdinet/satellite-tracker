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

CATS.forEach(function(c){ 
  activeFilters[c.id] = (c.id === 'gps'); 
  loadedGroups[c.id]  = false;
});

// Map our category IDs to Celestrak's actual group names
var CELESTRAK_MAP = {
  'stations': 'stations',
  'starlink': 'starlink',
  'gps': 'gps-ops',
  'weather': 'weather',
  'military': 'military',
  'science': 'science',
  'amateur': 'amateur',
  'debris': '1999-025' // Specifically tracks debris from the 1999-025 collision
};

function fetchGroup(catId, done) {
  var groupName = CELESTRAK_MAP[catId] || catId;
  
  // By fetching directly from the browser, we bypass Render's blocked IP addresses entirely!
  var directUrl = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=' + groupName + '&FORMAT=tle';
  var proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(directUrl);

  // Try direct first, fallback to proxy if the browser complains about CORS
  fetch(directUrl)
    .then(function(r) {
      if (!r.ok) throw new Error('Direct HTTP ' + r.status);
      return r.text();
    })
    .catch(function(e) {
      console.warn('Direct fetch blocked, trying proxy...', e);
      return fetch(proxyUrl).then(function(r2) {
         if (!r2.ok) throw new Error('Proxy HTTP ' + r2.status);
         return r2.text();
      });
    })
    .then(function(txt) {
      // Ensure we actually got TLE data and not an HTML error page
      if (txt.indexOf('1 ') === -1) throw new Error('Invalid TLE data received');
      done(null, txt);
    })
    .catch(function(e) {
      done(e, null);
    });
}

function parseTLE(text, catId) {
  var lines = text.trim().split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  var out = [];

  // CUSTOM LIMITS: Prevents the browser from freezing on huge datasets
  var limits = {
    'stations': 50,
    'starlink': 150, // Top 150 Starlink
    'gps': 50,       
    'weather': 50,
    'military': 50,
    'science': 50,
    'amateur': 50,
    'debris': 200    // A generous chunk of debris
  };
  var maxLimit = limits[catId] || 50;
  var count = 0;

  for (var i = 0; i + 2 < lines.length; i += 3) {
    if (count >= maxLimit) break; // Stop parsing once we hit our limit

    var name = lines[i].replace(/^0 /, '').trim();
    var l1   = lines[i + 1];
    var l2   = lines[i + 2];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    try {
      var satrec = satellite.twoline2satrec(l1, l2);
      var norad  = l2.substring(2, 7).trim();
      var inc    = parseFloat(l2.substring(8, 16));
      var mm     = parseFloat(l2.substring(52, 63));
      var period = mm > 0 ? (1440 / mm).toFixed(1) : '?';
      out.push({ name:name, norad:norad, l1:l1, l2:l2, cat:catId,
                 satrec:satrec, inc:inc, period:period, mesh:null, pos:null });
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
  var vx = pv.velocity ? pv.velocity.x : 0;
  var vy = pv.velocity ? pv.velocity.y : 0;
  var vz = pv.velocity ? pv.velocity.z : 0;
  return {
    lat: satellite.degreesLat(geo.latitude),
    lon: satellite.degreesLong(geo.longitude),
    alt: geo.height,
    vel: Math.sqrt(vx*vx + vy*vy + vz*vz),
  };
}

var ER = 1.0;
function lla2xyz(lat, lon, alt) {
  var R   = ER + (alt / 6371) * ER;
  var phi = (90 - lat) * Math.PI / 180;
  var the = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -R * Math.sin(phi) * Math.cos(the),
     R * Math.cos(phi),
     R * Math.sin(phi) * Math.sin(the)
  );
}

function initThree() {
  scene    = new THREE.Scene();
  camera   = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(0, 0, zoom);
  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  var sv = [];
  for (var i = 0; i < 7000; i++) {
    var vx = (Math.random() - 0.5) * 400;
    var vy = (Math.random() - 0.5) * 400;
    var vz = (Math.random() - 0.5) * 400;
    if (Math.sqrt(vx*vx+vy*vy+vz*vz) > 20) sv.push(vx, vy, vz);
  }
  var sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color:0xffffff, size:0.12, sizeAttenuation:true })));

  var texLoader = new THREE.TextureLoader();
  var earthTex  = texLoader.load(
    'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
    undefined, undefined,
    function() {
      earthMesh.material = new THREE.MeshPhongMaterial({
        color:0x1a3a5c, emissive:0x0a1a2a, specular:0x224466, shininess:12
      });
    }
  );
  var bumpTex = texLoader.load('https://unpkg.com/three-globe/example/img/earth-topology.png');
  var specTex = texLoader.load('https://unpkg.com/three-globe/example/img/earth-water.png');

  earthMesh = new THREE.Mesh(
    new THREE.SphereGeometry(ER, 64, 64),
    new THREE.MeshPhongMaterial({
      map:      earthTex,
      bumpMap:  bumpTex,
      bumpScale: 0.005,
      specularMap: specTex,
      specular: new THREE.Color(0x333333),
      shininess: 15,
    })
  );
  scene.add(earthMesh);

  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(ER * 1.02, 32, 32),
    new THREE.MeshPhongMaterial({ color:0x0044aa, transparent:true, opacity:0.08, side:THREE.FrontSide })
  ));

  var gm = new THREE.LineBasicMaterial({ color:0x1a3a5c, transparent:true, opacity:0.35 });
  var R  = ER * 1.001;
  for (var lat = -80; lat <= 80; lat += 20) {
    var pts = [];
    for (var lon = 0; lon <= 360; lon += 4) {
      var phi = (90-lat)*Math.PI/180, the = (lon+180)*Math.PI/180;
      pts.push(new THREE.Vector3(-R*Math.sin(phi)*Math.cos(the), R*Math.cos(phi), R*Math.sin(phi)*Math.sin(the)));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gm));
  }
  for (var lon2 = 0; lon2 < 360; lon2 += 20) {
    var pts2 = [];
    for (var lat2 = -90; lat2 <= 90; lat2 += 4) {
      var phi2 = (90-lat2)*Math.PI/180, the2 = (lon2+180)*Math.PI/180;
      pts2.push(new THREE.Vector3(-R*Math.sin(phi2)*Math.cos(the2), R*Math.cos(phi2), R*Math.sin(phi2)*Math.sin(the2)));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2), gm));
  }

  scene.add(new THREE.AmbientLight(0x223344, 1.2));
  var sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 3, 5);
  scene.add(sun);

  satGroup = new THREE.Group();
  scene.add(satGroup);

  var cvs = renderer.domElement;
  cvs.addEventListener('mousedown', function(e){ dragging=true; px=e.clientX; py=e.clientY; });
  cvs.addEventListener('mouseup',   function(){ dragging=false; });
  cvs.addEventListener('mousemove', function(e){
    if (!dragging) return;
    rotY += (e.clientX-px)*0.005; rotX += (e.clientY-py)*0.005;
    rotX = Math.max(-Math.PI/2, Math.min(Math.PI/2, rotX));
    px = e.clientX; py = e.clientY;
  });
  cvs.addEventListener('wheel', function(e){
    zoom = Math.max(1.3, Math.min(15, zoom + e.deltaY*0.005));
    e.preventDefault();
  }, { passive:false });
  cvs.addEventListener('click', onCanvasClick);
  window.addEventListener('resize', function(){
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

var SAT_GEO  = new THREE.SphereGeometry(0.006, 4, 4);
var matCache = {};
function getMat(catId) {
  if (!matCache[catId]) {
    var c = CATS.find(function(x){ return x.id === catId; });
    matCache[catId] = new THREE.MeshBasicMaterial({ color: new THREE.Color(c ? c.color : '#ffffff') });
  }
  return matCache[catId];
}

function buildMeshes() {
  while (satGroup.children.length) satGroup.remove(satGroup.children[0]);
  var now = new Date();
  allSats.forEach(function(sat) {
    var pos = getPos(sat.satrec, now);
    if (!pos || pos.alt < 0) return;
    var mesh = new THREE.Mesh(SAT_GEO, getMat(sat.cat));
    mesh.position.copy(lla2xyz(pos.lat, pos.lon, pos.alt));
    mesh.userData = { sat: sat };
    satGroup.add(mesh);
    sat.mesh = mesh;
    sat.pos  = pos;
  });
}

function onCanvasClick(e) {
  var rect  = renderer.domElement.getBoundingClientRect();
  var mouse = new THREE.Vector2(
    ((e.clientX-rect.left)/rect.width)*2-1,
   -((e.clientY-rect.top)/rect.height)*2+1
  );
  var rc = new THREE.Raycaster();
  rc.setFromCamera(mouse, camera);
  var hits = rc.intersectObjects(satGroup.children);
  if (hits.length) selectSat(hits[0].object.userData.sat);
}

function animate(ts) {
  requestAnimationFrame(animate);
  if (ts - lastUpd > 2000) {
    lastUpd = ts;
    var now = new Date();
    satGroup.children.forEach(function(m) {
      var sat = m.userData.sat;
      if (!sat) return;
      var pos = getPos(sat.satrec, now);
      if (!pos || pos.alt < 0) { m.visible = false; return; }
      m.visible = !!(activeFilters[sat.cat] && passesSearch(sat));
      m.position.copy(lla2xyz(pos.lat, pos.lon, pos.alt));
      sat.pos = pos;
    });
    
    if (selected && selected.pos) {
      updateInfoCard(selected);
      if (visibilityCone) {
        visibilityCone.position.copy(lla2xyz(selected.pos.lat, selected.pos.lon, selected.pos.alt));
        visibilityCone.lookAt(0,0,0);
      }
    }
  }
  earthMesh.rotation.y += 0.0004;
  camera.position.x = zoom * Math.sin(rotY) * Math.cos(rotX);
  camera.position.y = zoom * Math.sin(rotX);
  camera.position.z = zoom * Math.cos(rotY) * Math.cos(rotX);
  camera.lookAt(0, 0, 0);
  var now2 = new Date();
  document.getElementById('hud-time').textContent = now2.toUTCString().slice(17, 25);
  document.getElementById('hud-date').textContent = now2.toUTCString().slice(0, 16) + ' UTC';
  renderer.render(scene, camera);
}

function passesSearch(sat) {
  if (!searchQ) return true;
  return sat.name.toLowerCase().indexOf(searchQ) >= 0 || sat.norad.indexOf(searchQ) >= 0;
}

function applyFilters() {
  filtered = allSats.filter(function(s) {
    return activeFilters[s.cat] && passesSearch(s);
  });
  satGroup.children.forEach(function(m) {
    var sat = m.userData.sat;
    if (!sat) return;
    m.visible = !!(activeFilters[sat.cat] && passesSearch(sat));
  });
  renderList();
  document.getElementById('sat-count').textContent = filtered.length;
}

function renderList() {
  var list = document.getElementById('sat-list');
  list.innerHTML = '';
  var show = filtered.slice(0, 300);
  show.forEach(function(sat) {
    var div = document.createElement('div');
    div.className = 'sitem' + (selected === sat ? ' sel' : '');
    var cat = CATS.find(function(c){ return c.id === sat.cat; });
    var alt = sat.pos ? sat.pos.alt.toFixed(0) + ' km' : 'calculating…';
    div.innerHTML =
      '<div class="sname" style="color:' + (cat ? cat.color : '#fff') + '">' + esc(sat.name) + '</div>' +
      '<div class="smeta">NORAD ' + sat.norad + ' &nbsp;|&nbsp; ' + alt + '</div>';
    div.addEventListener('click', function(){ selectSat(sat); });
    list.appendChild(div);
  });
  if (filtered.length > 300) {
    var more = document.createElement('div');
    more.style.cssText = 'padding:8px 14px;font-size:10px;color:#3a5060;text-align:center';
    more.textContent = '+ ' + (filtered.length - 300) + ' more — refine search to see them';
    list.appendChild(more);
  }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function selectSat(sat) {
  selected = sat;
  updateInfoCard(sat);
  document.getElementById('info').style.display = 'block';
  renderList();

  if (sat.pos) {
    rotX = sat.pos.lat * (Math.PI / 180);
    rotY = (sat.pos.lon + 90) * (Math.PI / 180);
    
    if (visibilityCone) {
      scene.remove(visibilityCone);
      visibilityCone.geometry.dispose();
      visibilityCone.material.dispose();
      visibilityCone = null;
    }

    var r = ER + (sat.pos.alt / 6371) * ER;
    zoom = r + 1.2; 
    
    var y = (ER * ER) / r;
    var H = r - y;
    var rad = ER * Math.sqrt(1 - Math.pow(ER/r, 2));

    var geo = new THREE.ConeGeometry(rad, H, 64, 1, true);
    geo.translate(0, -H/2, 0); 
    geo.rotateX(-Math.PI/2); 

    var cat = CATS.find(function(c){ return c.id === sat.cat; });
    var col = cat ? cat.color : '#ffffff';

    visibilityCone = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.3, 
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    
    visibilityCone.position.copy(lla2xyz(sat.pos.lat, sat.pos.lon, sat.pos.alt));
    visibilityCone.lookAt(0, 0, 0); 
    scene.add(visibilityCone);
  }
}

function updateInfoCard(sat) {
  var cat = CATS.find(function(c){ return c.id === sat.cat; });
  document.getElementById('i-name').textContent  = sat.name;
  document.getElementById('i-name').style.color  = cat ? cat.color : '#00aaff';
  document.getElementById('i-norad').textContent = sat.norad;
  document.getElementById('i-type').textContent  = cat ? cat.label : sat.cat;
  document.getElementById('i-inc').textContent   = sat.inc.toFixed(2) + '°';
  document.getElementById('i-per').textContent   = sat.period + ' min';
  if (sat.pos) {
    document.getElementById('i-alt').textContent = sat.pos.alt.toFixed(1) + ' km';
    document.getElementById('i-lat').textContent = sat.pos.lat.toFixed(4) + '°';
    document.getElementById('i-lon').textContent = sat.pos.lon.toFixed(4) + '°';
    document.getElementById('i-vel').textContent = sat.pos.vel.toFixed(2) + ' km/s';
  }
}

function loadSpecificGroup(catId) {
  var btn = document.querySelector('.fbtn[data-id="' + catId + '"]');
  if (btn) btn.textContent = 'Loading...';

  fetchGroup(catId, function(err, text) {
    if (btn) {
       var cat = CATS.find(function(c){ return c.id === catId; });
       btn.textContent = cat ? cat.label : catId;
    }

    if (!err && text) {
      var sats = parseTLE(text, catId);
      allSats = allSats.concat(sats);
      loadedGroups[catId] = true;
      buildMeshes();
      applyFilters();
      document.getElementById('panel-sub').textContent = allSats.length.toLocaleString() + ' satellites loaded';
    } else {
      console.warn('Failed to load:', catId);
      activeFilters[catId] = false; 
      updateFilterBtns();
    }
  });
}

function buildFilterBar() {
  var bar = document.getElementById('filter-bar');
  bar.innerHTML = '';
  var allBtn = document.createElement('div');
  allBtn.className = 'fbtn'; allBtn.textContent = 'All'; allBtn.dataset.id = '__all__';
  allBtn.style.borderColor = '#607080'; allBtn.style.color = '#c0d0e0';
  
  allBtn.addEventListener('click', function() {
    var allOn = CATS.every(function(c){ return activeFilters[c.id]; });
    var newState = !allOn;

    CATS.forEach(function(c){ 
      activeFilters[c.id] = newState; 
      if (newState && !loadedGroups[c.id]) {
        loadSpecificGroup(c.id);
      }
    });
    updateFilterBtns(); 
    applyFilters();
  });
  bar.appendChild(allBtn);

  CATS.forEach(function(cat) {
    var btn = document.createElement('div');
    btn.className = 'fbtn'; btn.textContent = cat.label; btn.dataset.id = cat.id;
    btn.style.borderColor = cat.color; btn.style.color = cat.color;
    
    btn.addEventListener('click', function() {
      activeFilters[cat.id] = !activeFilters[cat.id];
      updateFilterBtns(); 
      
      if (activeFilters[cat.id] && !loadedGroups[cat.id]) {
        loadSpecificGroup(cat.id);
      } else {
        applyFilters();
      }
    });
    bar.appendChild(btn);
  });
  updateFilterBtns();
}

function updateFilterBtns() {
  document.querySelectorAll('.fbtn').forEach(function(btn) {
    var id = btn.dataset.id;
    if (id === '__all__') {
      var allOn = CATS.every(function(c){ return activeFilters[c.id]; });
      btn.style.background = allOn ? '#607080' : ''; btn.style.color = allOn ? '#000' : '#c0d0e0';
      return;
    }
    var cat = CATS.find(function(c){ return c.id === id; });
    var on  = activeFilters[id];
    btn.style.background = on ? cat.color : ''; btn.style.color = on ? '#000' : cat.color;
  });
}

function buildLegend() {
  var body = document.getElementById('legend-body');
  body.innerHTML = '';
  CATS.forEach(function(cat) {
    var row = document.createElement('div');
    row.className = 'lrow';
    row.innerHTML = '<div class="ldot" style="background:' + cat.color + '"></div>' +
                    '<span style="color:#8090a0">' + cat.label + '</span>';
    body.appendChild(row);
  });
}

function loadInitial() {
  document.getElementById('load-msg').textContent = 'Fetching GPS Data...';
  
  fetchGroup('gps', function(err, text) {
    if (!err && text) {
      var sats = parseTLE(text, 'gps');
      allSats  = allSats.concat(sats);
      loadedGroups['gps'] = true;
    } else {
      console.warn('Failed to load GPS:', err ? err.message : 'no data');
    }
    
    buildMeshes();
    applyFilters();
    document.getElementById('panel-sub').textContent = allSats.length.toLocaleString() + ' satellites loaded';
    document.getElementById('upd-time').textContent = new Date().toUTCString().slice(17, 25) + ' UTC';
    
    document.getElementById('loading').style.display = 'none';
    requestAnimationFrame(animate);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  initThree();
  buildFilterBar();
  buildLegend();
  document.getElementById('search').addEventListener('input', function(e) {
    searchQ = e.target.value.toLowerCase().trim();
    applyFilters();
  });
  
  document.getElementById('info-close').addEventListener('click', function() {
    document.getElementById('info').style.display = 'none';
    selected = null; 
    
    if (visibilityCone) {
      scene.remove(visibilityCone);
      visibilityCone.geometry.dispose();
      visibilityCone.material.dispose();
      visibilityCone = null;
    }
    
    renderList();
  });
  
  loadInitial();
});
