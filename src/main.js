import * as THREE from 'three';

// ============ helpers ============
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

// ============ HITBOX DEFINITIONS (explicit) ============
// Zones are spheres in bot-local space. Damage = weapon base × zone multiplier.
const HITBOXES = {
  head:  { y: 1.68, r: 0.30, mult: 4.0,  label: 'HEAD'  },
  torso: { y: 1.08, r: 0.55, mult: 1.0,  label: 'TORSO' },
  legs:  { y: 0.38, r: 0.46, mult: 0.75, label: 'LEGS'  },
};
const HITBOX_ORDER = ['head', 'torso', 'legs']; // priority when overlapping

// ============ audio (procedural, no assets) ============
const AudioSys = {
  ctx: null,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  noise(dur, freq, gain, type = 'lowpass') {
    if (!this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.ctx.destination); src.start();
  },
  tone(freq, dur, gain, slide = 0) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), this.ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + dur);
  },
  shoot() { this.noise(0.14, 1800, 0.5); this.tone(120, 0.12, 0.35, -60); },
  pistol() { this.noise(0.12, 2400, 0.45); this.tone(160, 0.1, 0.3, -70); },
  enemyShoot() { this.noise(0.12, 900, 0.2); this.tone(90, 0.1, 0.18, -40); },
  allyShoot() { this.noise(0.12, 1400, 0.25); this.tone(110, 0.1, 0.22, -50); },
  swing() { this.noise(0.12, 3000, 0.2, 'highpass'); },
  stab() { this.noise(0.1, 700, 0.35); this.tone(200, 0.08, 0.25, -100); },
  hit() { this.tone(1200, 0.07, 0.25); },
  kill() { this.tone(600, 0.18, 0.3, 500); },
  reload() { this.tone(300, 0.06, 0.2); setTimeout(() => this.tone(450, 0.06, 0.2), 150); },
  hurt() { this.noise(0.2, 400, 0.4); },
  click() { this.tone(800, 0.05, 0.15); },
  buy() { this.tone(520, 0.09, 0.25); setTimeout(() => this.tone(780, 0.12, 0.25), 100); },
  deny() { this.tone(180, 0.15, 0.25); },
  round() { this.tone(440, 0.3, 0.25, 440); }
};

// ============ renderer / scene (graphical improvements) ============
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a5c4);
scene.fog = new THREE.Fog(0xd8bd94, 32, 150);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 400);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x8a6f4d, 0.95));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.9);
sun.position.set(30, 48, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 130;
sun.shadow.bias = -0.0004;
scene.add(sun);
// warm bounce fill so shadows aren't pitch black
const bounce = new THREE.DirectionalLight(0xffd9a8, 0.35);
bounce.position.set(-20, 12, -24);
scene.add(bounce);

// sky dome + sun disc + drifting clouds
{
  const skyGeo = new THREE.SphereGeometry(260, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f5da3) }, mid: { value: new THREE.Color(0x9fc0e0) }, bot: { value: new THREE.Color(0xe3c69a) } },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){ float h=normalize(vP).y; vec3 c=h>0.12?mix(mid,top,smoothstep(0.12,0.75,h)):mix(bot,mid,smoothstep(-0.08,0.12,h));
      gl_FragColor=vec4(c,1.0); }`
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  // sun disc
  const sunSpr = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: 0xfff6dd, fog: false }));
  sunSpr.position.set(120, 130, 60); sunSpr.lookAt(0, 0, 0); scene.add(sunSpr);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(16, 24), new THREE.MeshBasicMaterial({ color: 0xfff6dd, transparent: true, opacity: 0.3, fog: false }));
  glow.position.copy(sunSpr.position).add(new THREE.Vector3(0, 0, -1)); glow.lookAt(0, 0, 0); scene.add(glow);
}
// ambient dust motes
const dustMotes = [];
{
  const g = new THREE.BufferGeometry();
  const N = 220, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rand(-34, 34); pos[i * 3 + 1] = rand(0.3, 9); pos[i * 3 + 2] = rand(-34, 34); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xffe9c0, size: 0.09, transparent: true, opacity: 0.65, depthWrite: false });
  const pts = new THREE.Points(g, m);
  scene.add(pts);
  dustMotes.push(pts);
}

// ============ map ============
const colliders = [];
const solidMeshes = [];
function addCollider(x, z, w, d) {
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}
function crateTexture(base) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 128); g.moveTo(128, 0); g.lineTo(0, 128); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 60; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 4, 2);
  const t = new THREE.CanvasTexture(c);
  return t;
}
function solidBox(x, y, z, w, h, d, color, opts = {}) {
  let mat;
  if (opts.crate) {
    mat = new THREE.MeshStandardMaterial({ map: crateTexture(color), roughness: 0.85, metalness: 0.03 });
  } else {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.02 });
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = !opts.noShadow; m.receiveShadow = true;
  m.userData.solid = true;
  scene.add(m);
  solidMeshes.push(m);
  // wall cap trim for graphical polish on tall walls
  if (opts.trim && h >= 3) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.15, 0.22, d + 0.15), new THREE.MeshStandardMaterial({ color: 0x6e5f48, roughness: 0.9 }));
    cap.position.set(x, y + h / 2 + 0.11, z);
    cap.castShadow = true; scene.add(cap);
  }
  if (opts.collide !== false) addCollider(x, z, w, d);
  return m;
}

// ground with richer canvas texture
let groundMesh;
{
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#c2a06f'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(120,90,55,0.25)' : 'rgba(255,235,200,0.14)';
    g.fillRect(Math.random() * 512, Math.random() * 512, rand(1, 4), rand(1, 4));
  }
  g.strokeStyle = 'rgba(60,40,20,0.35)'; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo((i * 512) / 4, 0); g.lineTo((i * 512) / 4, 512); g.stroke();
    g.beginPath(); g.moveTo(0, (i * 512) / 4); g.lineTo(512, (i * 512) / 4); g.stroke();
  }
  // cracks
  g.strokeStyle = 'rgba(70,50,30,0.4)'; g.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    g.beginPath(); let px = Math.random() * 512, py = Math.random() * 512; g.moveTo(px, py);
    for (let s = 0; s < 5; s++) { px += rand(-30, 30); py += rand(-30, 30); g.lineTo(px, py); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(14, 14);
  tex.anisotropy = 4;
  groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  groundMesh.rotation.x = -Math.PI / 2; groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}
const ARENA = 32;
solidBox(0, 2, -ARENA, 70, 4, 1, 0x9a8a72, { trim: true });
solidBox(0, 2, ARENA, 70, 4, 1, 0x9a8a72, { trim: true });
solidBox(-ARENA, 2, 0, 1, 4, 70, 0x9a8a72, { trim: true });
solidBox(ARENA, 2, 0, 1, 4, 70, 0x9a8a72, { trim: true });
solidBox(-8, 1.75, 0, 1.2, 3.5, 18, 0xb09a78, { trim: true });
solidBox(8, 1.75, -8, 16, 3.5, 1.2, 0xb09a78, { trim: true });
solidBox(-6, 1.75, 10, 20, 3.5, 1.2, 0xa8906c, { trim: true });
solidBox(0, 1.5, -20, 10, 3, 1.2, 0x8f7a5e);
const crateColor = ['#7a5c33', '#6e5230', '#86653c'];
const crateSpots = [
  [-12, -12], [-10.4, -12], [-11.2, -10.4], [12, 6], [13.6, 6], [12.8, 7.6],
  [-4, -4], [5, 12], [-14, 14], [16, -14], [0, 20], [-20, 0], [20, 2], [4, -14]
];
crateSpots.forEach(([x, z], i) => {
  const s = i % 4 === 0 ? 2.2 : 1.5;
  solidBox(x, s / 2, z, s, s, s, crateColor[i % 3], { crate: true });
});
solidBox(-11.2, 2.2, -12, 1.5, 1.5, 1.5, '#7a5c33', { crate: true });
solidBox(12.8, 2.3, 6, 1.5, 1.5, 1.5, '#6e5230', { crate: true });
// barrels (red + blue teams)
for (const [x, z, col] of [[-18, -18, 0xa03a2a], [-17, -17, 0xa03a2a], [18, 14, 0x2e5f8a], [19, 14.5, 0x2e5f8a]]) {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 14), new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.25 }));
  b.position.set(x, 0.65, z); b.castShadow = b.receiveShadow = true; scene.add(b);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.12, 14), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 }));
  band.position.set(x, 0.9, z); scene.add(band);
  addCollider(x, z, 1.1, 1.1);
}
function siteMark(x, z, label, color = 0xffd75e) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.03, z); scene.add(ring);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.set(x, 0.025, z); scene.add(glow);
  siteRings.push({ ring, phase: Math.random() * 6 });
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d'); g.fillStyle = '#ffd75e'; g.font = '900 84px sans-serif'; g.textAlign = 'center';
  g.shadowColor = '#000'; g.shadowBlur = 12; g.fillText(label, 128, 95);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(6, 3, 1); sp.position.set(x, 5.2, z); scene.add(sp);
}
const siteRings = [];
siteMark(-20, -20, 'A');
siteMark(20, 20, 'B');
// palms
for (const [x, z] of [[-26, 8], [26, -8], [-8, 26]]) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.38, 5, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 1 }));
  t.position.set(x, 2.5, z); t.castShadow = true; scene.add(t);
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.9, 7, 6), new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 }));
    const a = (i / 5) * Math.PI * 2;
    l.position.set(x + Math.cos(a) * 1.1, 5.3 + rand(-0.2, 0.2), z + Math.sin(a) * 1.1);
    l.scale.set(1.4, 0.55, 1.4); l.castShadow = true; scene.add(l);
  }
  addCollider(x, z, 0.7, 0.7);
}
// string lights across mid for polish
{
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    pts.push(new THREE.Vector3(-20 + t * 40, 6.5 - Math.sin(t * Math.PI) * 0.8, -4));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x333333 }));
  scene.add(line);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
    bulb.position.set(-20 + t * 40, 6.5 - Math.sin(t * Math.PI) * 0.8 - 0.15, -4);
    scene.add(bulb);
  }
  const pl = new THREE.PointLight(0xffd9a0, 12, 30, 1.8);
  pl.position.set(0, 6, -4); scene.add(pl);
}

function collide(px, pz, r) {
  for (const c of colliders) {
    const nx = clamp(px, c.minX, c.maxX), nz = clamp(pz, c.minZ, c.maxZ);
    const dx = px - nx, dz = pz - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        px += dx * push; pz += dz * push;
      } else {
        const l = px - c.minX, rr = c.maxX - px, t = pz - c.minZ, bb = c.maxZ - pz;
        const m = Math.min(l, rr, t, bb);
        if (m === l) px = c.minX - r; else if (m === rr) px = c.maxX + r;
        else if (m === t) pz = c.minZ - r; else pz = c.maxZ + r;
      }
    }
  }
  px = clamp(px, -ARENA + 1, ARENA - 1);
  pz = clamp(pz, -ARENA + 1, ARENA - 1);
  return [px, pz];
}

// ============ tracers / particles / decals ============
const fx = [];
function tracer(a, b, color = 0xffe28a) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
  scene.add(line);
  fx.push({ obj: line, life: 0.09, max: 0.09, kind: 'fade' });
}
const particlePool = [];
function burst(p, color = 0xffcf7a, n = 10, speed = 5) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(p);
    scene.add(m);
    particlePool.push({ obj: m, vel: new THREE.Vector3(rand(-1, 1) * speed, rand(0.5, 2.5) * speed * 0.6, rand(-1, 1) * speed), life: rand(0.25, 0.55), max: 0.55 });
  }
}
function blood(p) { burst(p, 0xb32020, 12, 4); groundDecal(p, 0x6a1010); }
const decals = [];
function groundDecal(p, color = 0x3a2a1a) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(rand(0.15, 0.35), 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(p.x + rand(-0.2, 0.2), 0.02 + Math.random() * 0.01, p.z + rand(-0.2, 0.2));
  scene.add(m);
  decals.push({ obj: m, life: 9, max: 9 });
}
function smokePuff(p) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 6), new THREE.MeshBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.5, depthWrite: false }));
  m.position.copy(p); scene.add(m);
  fx.push({ obj: m, life: 0.7, max: 0.7, kind: 'smoke' });
}

// floating damage numbers (screen-space via projection)
function dmgNumber(worldPos, text, cls = '') {
  const v = worldPos.clone().project(camera);
  if (v.z > 1) return;
  const el = document.createElement('div');
  el.className = 'dmg-num ' + cls;
  el.textContent = text;
  el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px';
  el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  $('dmg-numbers').appendChild(el);
  setTimeout(() => el.remove(), 850);
}

// ============ weapon viewmodels: knife / pistol / rifle ============
const gunGroup = new THREE.Group();
camera.add(gunGroup);
scene.add(camera);
let muzzle, muzzleLight, knifeTip;
const viewmodels = {};
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.45, metalness: 0.55 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4d21, roughness: 0.8 });
  // rifle
  const rifle = new THREE.Group();
  const rbody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark); rifle.add(rbody);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 10), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.45); rifle.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.09), wood);
  grip.position.set(0, -0.15, 0.12); grip.rotation.x = 0.3; rifle.add(grip);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), dark);
  mag.position.set(0, -0.15, -0.08); mag.rotation.x = -0.25; rifle.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), dark);
  sight.position.set(0, 0.1, -0.1); rifle.add(sight);
  const sightRear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), dark);
  sightRear.position.set(0, 0.09, 0.18); rifle.add(sightRear);
  muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0, depthWrite: false }));
  muzzle.position.set(0, 0.02, -0.66); rifle.add(muzzle);
  muzzleLight = new THREE.PointLight(0xffb14e, 0, 9); muzzleLight.position.set(0, 0.1, -0.7); rifle.add(muzzleLight);
  gunGroup.add(rifle);
  viewmodels.rifle = rifle;
  // pistol
  const pistol = new THREE.Group();
  const pbody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.34), dark); pistol.add(pbody);
  const pgrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.08), wood);
  pgrip.position.set(0, -0.12, 0.1); pgrip.rotation.x = 0.25; pistol.add(pgrip);
  const psight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.015), dark);
  psight.position.set(0, 0.07, -0.1); pistol.add(psight);
  const pmuzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false }));
  pmuzzle.position.set(0, 0.01, -0.2); pistol.add(pmuzzle);
  pistol.userData.muzzle = pmuzzle;
  gunGroup.add(pistol);
  viewmodels.pistol = pistol;
  // knife
  const knife = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.22), wood);
  handle.position.set(0, -0.02, 0.05); knife.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.42), new THREE.MeshStandardMaterial({ color: 0xc9d2da, roughness: 0.25, metalness: 0.9 }));
  blade.position.set(0, 0.01, -0.28); knife.add(blade);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.42), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  edge.position.set(0, -0.015, -0.28); knife.add(edge);
  knifeTip = new THREE.Object3D(); knifeTip.position.set(0, 0, -0.5); knife.add(knifeTip);
  knife.rotation.set(0.3, 0, 0.15);
  gunGroup.add(knife);
  viewmodels.knife = knife;
  gunGroup.position.set(0.28, -0.26, -0.5);
}
let gunKick = 0, knifeSwing = 0;
function showViewmodel() {
  const w = G.weapons[G.wi];
  viewmodels.rifle.visible = w.kind === 'rifle';
  viewmodels.pistol.visible = w.kind === 'pistol';
  viewmodels.knife.visible = w.kind === 'knife';
}

// ============ game state ============
const G = {
  mode: 'menu',
  yaw: 0, pitch: 0,
  pos: new THREE.Vector3(0, 1.7, 26),
  vel: new THREE.Vector3(),
  grounded: true,
  hp: 100, armor: 100, money: 800,
  weapons: [
    { slot: 1, kind: 'knife', name: 'KNIFE · MELEE', dmg: 55, interval: 0.45, range: 2.6, spread: 0, auto: false, mag: Infinity, magSize: Infinity, reserve: Infinity, reloadT: 0 },
    { slot: 2, kind: 'pistol', name: 'DEAGLE · PISTOL', mag: 7, magSize: 7, reserve: 35, dmg: 34, interval: 0.28, spread: 0.008, auto: false, reloadT: 1.5 },
    { slot: 3, kind: 'rifle', name: 'AK-47 · RIFLE', mag: 30, magSize: 30, reserve: 90, dmg: 26, interval: 0.105, spread: 0.014, auto: true, reloadT: 2.2 },
  ],
  wi: 2, lastShot: 0, reloading: 0, aiming: false,
  kills: 0, deaths: 0,
  round: 1, ct: 0, t: 0, time: 120, roundOver: false,
  keys: {}, bots: [], allies: [], over: false,
  orders: 'FOLLOW', showHitboxes: false, interactOpen: false,
};
const WIN_SCORE = 5, ROUND_TIME = 120, ENEMY_COUNT = 4, ALLY_COUNT = 2;

// ============ bot skins: Terrorist vs CT ============
function teamColors(team) {
  return team === 'T'
    ? { uniform: 0x6f5b35, pants: 0x4a4030, vest: 0x2c2620, skin: 0xd9a877, head: 0x5a1f1f, accent: 0xb3402a }
    : { uniform: 0x2e4f7a, pants: 0x232d3d, vest: 0x1c2a40, skin: 0xe0b088, head: 0x1d3252, accent: 0x6db7ff };
}
function makeBotMesh(team) {
  const C = teamColors(team);
  const grp = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: C.uniform, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.85 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.32), new THREE.MeshStandardMaterial({ color: C.pants, roughness: 0.95 }));
  legs.position.y = 0.38; legs.castShadow = true; grp.add(legs);
  const boots = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.14, 0.4), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
  boots.position.y = 0.07; grp.add(boots);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.4), uniform);
  torso.position.y = 1.1; torso.castShadow = true; grp.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.42, 0.44), new THREE.MeshStandardMaterial({ color: C.vest, roughness: 0.9 }));
  vest.position.y = 1.08; grp.add(vest);
  // shoulder team patch
  const patch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.02), new THREE.MeshBasicMaterial({ color: C.accent }));
  patch.position.set(-0.24, 1.3, 0.21); grp.add(patch);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), skin);
  head.position.y = HITBOXES.head.y; head.castShadow = true; grp.add(head);
  if (team === 'T') {
    // terrorist: wrap mask + goggles
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.32), new THREE.MeshStandardMaterial({ color: C.head, roughness: 0.95 }));
    mask.position.y = 1.66; grp.add(mask);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0x3a2c1c }));
    band.position.y = 1.82; grp.add(band);
  } else {
    // CT: helmet + visor
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, 1.5), new THREE.MeshStandardMaterial({ color: C.head, roughness: 0.5, metalness: 0.3 }));
    helm.position.y = 1.72; grp.add(helm);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.05), new THREE.MeshStandardMaterial({ color: 0x0e1622, roughness: 0.2, metalness: 0.7 }));
    visor.position.set(0, 1.7, 0.22); grp.add(visor);
  }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.8), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
  gun.position.set(0.3, 1.15, -0.3); grp.add(gun);
  // team ring at feet
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 20), new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; grp.add(ring);
  // hp bar
  const hpBar = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.1), new THREE.MeshBasicMaterial({ color: 0x33ff66, depthTest: false, transparent: true }));
  hpBar.position.y = 2.12; grp.add(hpBar);
  grp.userData.hpBar = hpBar;
  // hitbox debug helpers (wireframe spheres per zone)
  const helpers = new THREE.Group();
  for (const key of HITBOX_ORDER) {
    const hb = HITBOXES[key];
    const col = key === 'head' ? 0xffd75e : key === 'torso' ? 0x33ff66 : 0x6db7ff;
    const s = new THREE.Mesh(new THREE.SphereGeometry(hb.r, 12, 8), new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: 0.9, depthTest: false }));
    s.position.y = hb.y; s.visible = false;
    s.userData.zone = key;
    helpers.add(s);
  }
  grp.add(helpers);
  grp.userData.helpers = helpers;
  grp.userData.team = team;
  return grp;
}

// ============ bots + allies ============
const enemySpawns = [[-20, -20], [20, 20], [0, -24], [-8, 8], [14, -10]];
const allySpawns = [[-3, 24], [3, 24]];
function spawnBots() {
  for (const b of [...G.bots, ...G.allies]) scene.remove(b.mesh);
  G.bots = []; G.allies = [];
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const [sx, sz] = enemySpawns[i % enemySpawns.length];
    const mesh = makeBotMesh('T');
    mesh.position.set(sx + rand(-2, 2), 0, sz + rand(-2, 2));
    scene.add(mesh);
    G.bots.push({
      mesh, team: 'T', hp: 100, maxHp: 100, state: 'alive', deathT: 0,
      speed: rand(2.6, 3.6), shootCd: rand(0.5, 1.5),
      strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1, 3),
    });
  }
  for (let i = 0; i < ALLY_COUNT; i++) {
    const [sx, sz] = allySpawns[i % allySpawns.length];
    const mesh = makeBotMesh('CT');
    mesh.position.set(sx + rand(-1, 1), 0, sz + rand(-1, 1));
    scene.add(mesh);
    G.allies.push({
      mesh, team: 'CT', hp: 100, maxHp: 100, state: 'alive', deathT: 0,
      speed: rand(3.4, 4.0), shootCd: rand(0.4, 1.0),
      strafe: 1, strafeT: 2,
    });
  }
  refreshHitboxHelpers();
}
function refreshHitboxHelpers() {
  for (const b of [...G.bots, ...G.allies]) {
    b.mesh.userData.helpers.children.forEach(h => { h.visible = G.showHitboxes && b.state === 'alive'; });
  }
  $('hitbox-lbl').textContent = G.showHitboxes ? 'ON' : 'OFF';
}

// ---- damage pipeline: explicit hitboxes, per-zone multipliers, killed state ----
function hitboxWorld(b, zone) {
  const hb = HITBOXES[zone];
  return b.mesh.position.clone().add(new THREE.Vector3(0, hb.y, 0));
}
function damageBot(b, baseDmg, zone, point) {
  if (!b || b.state !== 'alive') return;
  const hb = HITBOXES[zone] || HITBOXES.torso;
  const dmg = Math.max(1, Math.round(baseDmg * hb.mult));
  b.hp -= dmg;
  dmgNumber(point, (zone === 'head' ? '☠ ' : '') + dmg, zone === 'head' ? 'head' : '');
  // hit flash
  b.mesh.traverse(o => { if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setHex(0x771111); });
  setTimeout(() => { if (b.mesh) b.mesh.traverse(o => { if (o.isMesh && o.material && o.material.emissive) o.material.emissive.setHex(0x000000); }); }, 90);
  blood(point);
  if (b.hp <= 0) {
    b.hp = 0;
    killBot(b, zone, point);
  } else {
    AudioSys.hit();
    showHit(false);
  }
  updateHUD();
}
function killBot(b, zone, point) {
  // KILLED state: death animation plays, corpse lingers, then removed
  b.state = 'dying';
  b.deathT = 0;
  b.deathZone = zone;
  burst(point, 0xb32020, 18, 5);
  groundDecal(point, 0x5a0d0d);
  AudioSys.kill();
  dmgNumber(point.clone().add(new THREE.Vector3(0, 0.4, 0)), 'KILLED', 'kill');
  showHit(true);
  if (b.team === 'T') {
    G.kills++;
    G.money += zone === 'head' ? 400 : 300;
    feed(`<b class="ct">YOU${b.killer === 'ALLY' ? ' + ALLY' : ''}</b> ⟂ <b class="t">TERRORIST · ${HITBOXES[zone].label}${zone === 'head' ? 'SHOT' : ''}</b> <span style="opacity:.7">(${b.maxHp}→0)</span>`);
  } else {
    feed(`<b class="t">TERRORIST</b> ⟂ <b class="ct">ALLY CT</b>`);
  }
  b.mesh.userData.helpers.children.forEach(h => h.visible = false);
  checkRoundEnd();
}
function updateDeaths(dt) {
  for (const b of [...G.bots, ...G.allies]) {
    if (b.state !== 'dying') continue;
    b.deathT += dt;
    // fall over backward over ~0.45s, then linger 4s, sink + fade
    const k = Math.min(1, b.deathT / 0.45);
    b.mesh.rotation.x = -k * Math.PI / 2 * 0.96;
    b.mesh.position.y = k * 0.15;
    if (b.deathT > 3.2) {
      b.mesh.position.y = 0.15 - (b.deathT - 3.2) * 0.5;
      b.mesh.traverse(o => { if (o.isMesh && o.material && o.material.transparent !== undefined) { o.material.transparent = true; o.material.opacity = Math.max(0, 1 - (b.deathT - 3.2) / 1.2); } });
    }
    if (b.deathT > 4.4) {
      b.state = 'dead';
      scene.remove(b.mesh);
    }
  }
}

// ============ HUD ============
function feed(html) {
  const d = document.createElement('div'); d.className = 'feed'; d.innerHTML = html;
  $('killfeed').prepend(d);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  setTimeout(() => d.remove(), 6000);
}
function showHit(kill = false) {
  const h = $('hitmarker');
  h.classList.remove('show'); void h.offsetWidth; h.classList.add('show');
  h.style.filter = kill ? 'hue-rotate(-60deg) brightness(1.6)' : 'none';
}
function banner(text, ms = 1800) {
  const b = $('banner'); b.textContent = text; b.classList.remove('hidden');
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.add('hidden'), ms);
}
function updateHUD() {
  $('health-num').textContent = Math.max(0, Math.ceil(G.hp));
  $('armor-num').textContent = Math.max(0, Math.ceil(G.armor));
  $('health-bar').style.width = clamp(G.hp, 0, 100) + '%';
  $('armor-bar').style.width = clamp(G.armor, 0, 100) + '%';
  const w = G.weapons[G.wi];
  if (w.kind === 'knife') {
    $('ammo-mag').textContent = '🔪';
    $('ammo-res').textContent = '';
  } else {
    $('ammo-mag').textContent = G.reloading > 0 ? '--' : w.mag;
    $('ammo-res').textContent = '/ ' + w.reserve;
  }
  $('weapon-name').textContent = w.name + (G.reloading > 0 ? ' · RELOADING' : '');
  for (let i = 0; i < 3; i++) $('slot-' + (i + 1)).classList.toggle('active', i === G.wi);
  $('money').textContent = '$' + G.money;
  $('ct-score').textContent = G.ct; $('t-score').textContent = G.t;
  $('round-label').textContent = 'ROUND ' + G.round + ' · FIRST TO ' + WIN_SCORE;
  const t = Math.max(0, Math.ceil(G.time));
  $('timer').textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  $('pause-score').textContent = G.ct + ' : ' + G.t;
  $('allies-num').textContent = G.allies.filter(a => a.state === 'alive').length;
  $('foes-num').textContent = G.bots.filter(a => a.state === 'alive').length;
  $('orders-lbl').textContent = G.orders;
}

// ============ shooting (uses explicit hitboxes) ============
const ray = new THREE.Raycaster();
function pickHit(targets, wallDist) {
  // returns closest {b, zone, along, point}
  let best = null;
  for (const t of targets) {
    const to = t.p.clone().sub(ray.ray.origin);
    const along = to.dot(ray.ray.direction);
    if (along < 0 || along > wallDist) continue;
    const closest = ray.ray.origin.clone().add(ray.ray.direction.clone().multiplyScalar(along));
    if (closest.distanceTo(t.p) < t.r && (!best || along < best.along)) best = { b: t.b, zone: t.zone, along, point: closest };
  }
  return best;
}
function buildTargets(list) {
  const targets = [];
  for (const b of list) {
    if (b.state !== 'alive') continue;
    for (const zone of HITBOX_ORDER) {
      targets.push({ b, zone, p: hitboxWorld(b, zone), r: HITBOXES[zone].r });
    }
  }
  return targets;
}
function wallDistance() {
  const wallHits = ray.intersectObjects(solidMeshes, false);
  let wallDist = wallHits.length ? wallHits[0].distance : 120;
  const gHit = ray.intersectObject(groundMesh);
  if (gHit.length) wallDist = Math.min(wallDist, gHit[0].distance);
  return wallDist;
}
function switchWeapon(i, silent = false) {
  if (i < 0 || i > 2 || i === G.wi) return;
  G.wi = i; G.reloading = 0;
  showViewmodel();
  if (!silent) AudioSys.click();
  updateHUD();
}
function playerShoot(now) {
  const w = G.weapons[G.wi];
  if (w.kind === 'knife') { meleeAttack(now); return; }
  if (now - G.lastShot < w.interval || G.reloading > 0 || w.mag <= 0) {
    if (w.mag <= 0 && now - G.lastShot > 0.3) startReload();
    return;
  }
  G.lastShot = now;
  w.mag--;
  if (w.kind === 'rifle') AudioSys.shoot(); else AudioSys.pistol();
  gunKick = Math.min(0.09, gunKick + (w.kind === 'rifle' ? 0.035 : 0.05));
  const isRifle = w.kind === 'rifle';
  const mz = isRifle ? muzzle : viewmodels.pistol.userData.muzzle;
  mz.material.opacity = 1;
  if (isRifle) muzzleLight.intensity = 6;
  mz.rotation.z = Math.random() * Math.PI;
  setTimeout(() => { mz.material.opacity = 0; if (isRifle) muzzleLight.intensity = 0; }, 55);
  const sp = w.spread * (G.aiming ? 0.35 : 1) * (isMoving() ? 1.7 : 1);
  ray.setFromCamera(new THREE.Vector2(rand(-sp, sp) * 60, rand(-sp, sp) * 60), camera);
  const wallDist = wallDistance();
  const best = pickHit(buildTargets(G.bots), wallDist);
  const origin = camera.position.clone();
  const dir = ray.ray.direction.clone();
  if (best) {
    best.b.killer = 'YOU';
    damageBot(best.b, w.dmg, best.zone, best.point.clone());
    tracer(origin.add(dir.clone().multiplyScalar(0.6)), best.point, 0xfff2b0);
  } else {
    const end = origin.add(dir.multiplyScalar(wallDist));
    tracer(camera.position.clone().add(ray.ray.direction.clone().multiplyScalar(0.6)), end);
    if (wallDist < 100) { burst(end, 0xffcf7a, 5, 3); groundDecal(end); smokePuff(end); }
  }
  if (w.mag === 0) startReload();
  updateHUD();
}
function meleeAttack(now) {
  const w = G.weapons[0];
  if (now - G.lastShot < w.interval) return;
  G.lastShot = now;
  knifeSwing = 1;
  AudioSys.swing();
  setTimeout(() => {
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const wallDist = Math.min(wallDistance(), w.range);
    const best = pickHit(buildTargets(G.bots), wallDist);
    if (best) {
      AudioSys.stab();
      best.b.killer = 'YOU';
      // stabbing upward aims head when looking up
      const zone = G.pitch > 0.35 ? 'head' : best.zone;
      damageBot(best.b, w.dmg, zone, best.point.clone());
    }
  }, 120);
}
function startReload() {
  const w = G.weapons[G.wi];
  if (w.kind === 'knife' || G.reloading > 0 || w.mag === w.magSize || w.reserve <= 0) return;
  G.reloading = w.reloadT;
  AudioSys.reload();
}

// ---- enemy + ally fire ----
const losRay = new THREE.Raycaster();
function hasLOS(eye, targetPos) {
  const dir = targetPos.clone().sub(eye);
  const dist = dir.length(); dir.normalize();
  losRay.set(eye, dir);
  losRay.far = dist;
  const hit = losRay.intersectObjects(solidMeshes, false);
  return !(hit.length && hit[0].distance < dist - 0.8);
}
function nearestTarget(pos, candidates) {
  let best = null, bd = 1e9;
  for (const c of candidates) {
    if (c.state !== 'alive') continue;
    const p = c.mesh ? c.mesh.position : c; // allies store mesh; player passes pos vector wrapper
    const pp = c.mesh ? new THREE.Vector3(p.x, 0, p.z) : c;
    const d = pos.distanceTo(pp);
    if (d < bd) { bd = d; best = c; }
  }
  return { best, bd };
}
function botShoot(b) {
  // T bot targets nearest of player + alive allies
  const eye = b.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const options = [{ pos: G.pos, isPlayer: true, alive: G.hp > 0 }];
  for (const a of G.allies) if (a.state === 'alive') options.push({ pos: new THREE.Vector3(a.mesh.position.x, 1.4, a.mesh.position.z), ally: a, alive: true });
  let tgt = options[0], bd = eye.distanceTo(new THREE.Vector3(G.pos.x, 1.4, G.pos.z));
  for (const o of options.slice(1)) {
    const d = eye.distanceTo(o.pos);
    if (d < bd) { bd = d; tgt = o; }
  }
  const aimPos = tgt.isPlayer ? G.pos.clone() : tgt.pos.clone();
  if (!hasLOS(eye, aimPos)) return false;
  AudioSys.enemyShoot();
  tracer(eye.add(aimPos.clone().sub(eye).normalize().multiplyScalar(0.8)), aimPos.clone(), 0xff9a6a);
  const dist = bd;
  const acc = clamp(0.55 - dist * 0.008, 0.08, 0.5);
  if (Math.random() < acc) {
    if (tgt.isPlayer) hurtPlayer(rand(8, 22));
    else if (tgt.ally) hurtAlly(tgt.ally, rand(10, 26));
  } else {
    burst(aimPos.clone().add(new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1))), 0xcccccc, 2, 2);
  }
  return true;
}
function allyShoot(a) {
  const alive = G.bots.filter(b => b.state === 'alive');
  if (!alive.length) return false;
  let best = alive[0], bd = 1e9;
  for (const b of alive) {
    const d = a.mesh.position.distanceTo(b.mesh.position);
    if (d < bd) { bd = d; best = b; }
  }
  if (bd > 46) return false;
  const eye = a.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0));
  const aimPos = best.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
  if (!hasLOS(eye, aimPos)) return false;
  AudioSys.allyShoot();
  tracer(eye.add(aimPos.clone().sub(eye).normalize().multiplyScalar(0.8)), aimPos.clone(), 0x9fd8ff);
  // allies use rifle base 20 with head chance
  const zone = Math.random() < 0.18 ? 'head' : Math.random() < 0.7 ? 'torso' : 'legs';
  const hitCh = clamp(0.6 - bd * 0.009, 0.12, 0.55);
  if (Math.random() < hitCh) {
    best.killer = 'ALLY';
    damageBot(best, 20, zone, aimPos.clone());
  } else {
    burst(aimPos.clone().add(new THREE.Vector3(rand(-1, 1), rand(0, 1), rand(-1, 1))), 0xcccccc, 2, 2);
  }
  return true;
}
function hurtAlly(a, dmg) {
  if (a.state !== 'alive' || G.roundOver) return;
  a.hp -= dmg;
  blood(a.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
  if (a.hp <= 0) { a.hp = 0; killBot(a, 'torso', a.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0))); }
  updateHUD();
}
function hurtPlayer(dmg) {
  if (G.roundOver || G.mode !== 'play') return;
  let rem = dmg;
  if (G.armor > 0) { const ab = Math.min(G.armor, rem * 0.5); G.armor -= ab; rem -= ab; }
  G.hp -= rem;
  AudioSys.hurt();
  const v = $('damage-vignette'); v.style.opacity = 0.9;
  setTimeout(() => v.style.opacity = 0, 220);
  if (G.hp <= 0) {
    G.hp = 0; G.deaths++;
    feed(`<b class="t">TERRORIST</b> ⟂ <b class="ct">YOU</b>`);
    endRound(false, 'YOU WERE ELIMINATED');
  }
  updateHUD();
}

// ============ rounds ============
function startRound() {
  G.time = ROUND_TIME; G.roundOver = false;
  G.hp = 100; G.armor = Math.max(G.armor, 0);
  if (G.round === 1) G.armor = 100;
  G.pos.set(rand(-4, 4), 1.7, 26); G.vel.set(0, 0, 0);
  G.yaw = Math.PI; G.pitch = 0;
  for (const w of G.weapons) { if (w.kind !== 'knife') w.mag = w.magSize; }
  G.weapons[1].reserve = 35; G.weapons[2].reserve = 90;
  G.reloading = 0;
  spawnBots();
  banner('ROUND ' + G.round);
  AudioSys.round();
  updateHUD();
}
function checkRoundEnd() {
  if (G.roundOver) return;
  if (G.bots.every(b => b.state !== 'alive')) endRound(true, 'SITE CLEARED');
  else if (G.hp <= 0) endRound(false, 'YOU WERE ELIMINATED');
}
function endRound(ctWin, reason) {
  if (G.roundOver) return;
  G.roundOver = true;
  if (ctWin) { G.ct++; G.money += 800; } else { G.t++; }
  banner(ctWin ? '★ CT WIN — ' + reason : '✖ T WIN — ' + reason, 2200);
  feed(ctWin ? `<b class="ct">CT WIN</b> · ${reason}` : `<b class="t">T WIN</b> · ${reason}`);
  updateHUD();
  if (G.ct >= WIN_SCORE || G.t >= WIN_SCORE) {
    setTimeout(() => gameOver(G.ct > G.t), 2300);
  } else {
    setTimeout(() => { G.round++; startRound(); }, 2300);
  }
}
function gameOver(win) {
  G.mode = 'over'; G.over = true;
  document.exitPointerLock?.();
  $('gameover').classList.remove('hidden');
  $('go-title').textContent = win ? '🏆 MISSION ACCOMPLISHED' : '☠ MISSION FAILED';
  $('go-title').style.color = win ? '#7dff9a' : '#ff6b6b';
  $('go-sub').textContent = `Final ${G.ct} : ${G.t} · ${G.kills} kills in ${G.round} rounds.`;
}

// ============ interaction menu ============
function toggleInteract(force) {
  const open = force !== undefined ? force : !G.interactOpen;
  G.interactOpen = open;
  $('interact').classList.toggle('hidden', !open);
  $('interact-hint').style.display = open ? 'none' : 'block';
  if (open) {
    document.exitPointerLock?.();
    AudioSys.click();
  } else {
    if (G.mode === 'play' && !G.over) canvas.requestPointerLock();
  }
}
document.querySelectorAll('#interact [data-act]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    AudioSys.ensure();
    const act = btn.dataset.act;
    if (act === 'ammo') {
      if (G.money >= 200) { G.money -= 200; G.weapons[1].reserve = 70; G.weapons[2].reserve = 120; AudioSys.buy(); feed('🛒 <b class="ct">YOU</b> bought ammo'); }
      else AudioSys.deny();
    } else if (act === 'armor') {
      if (G.money >= 500) { G.money -= 500; G.armor = 100; AudioSys.buy(); feed('🛒 <b class="ct">YOU</b> bought armor'); }
      else AudioSys.deny();
    } else if (act === 'heal') {
      if (G.money >= 300) { G.money -= 300; G.hp = 100; AudioSys.buy(); feed('⛑ <b class="ct">YOU</b> field-healed'); }
      else AudioSys.deny();
    } else if (act === 'orders') {
      G.orders = G.orders === 'FOLLOW' ? 'HOLD' : 'FOLLOW';
      AudioSys.click(); feed(`📢 Allies ordered to <b class="ct">${G.orders}</b>`);
    } else if (act === 'hitbox') {
      G.showHitboxes = !G.showHitboxes;
      refreshHitboxHelpers();
      AudioSys.click();
    }
    updateHUD();
  });
});

// ============ input ============
addEventListener('keydown', e => {
  G.keys[e.code] = true;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit1') switchWeapon(0);
  if (e.code === 'Digit2') switchWeapon(1);
  if (e.code === 'Digit3') switchWeapon(2);
  if (e.code === 'KeyE' && G.mode === 'play') toggleInteract();
  if (e.code === 'Escape' && G.interactOpen) toggleInteract(false);
  if (['Space', 'ArrowUp'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => G.keys[e.code] = false);
addEventListener('wheel', e => {
  if (G.mode !== 'play') return;
  const dir = e.deltaY > 0 ? 1 : -1;
  switchWeapon((G.wi + dir + 3) % 3, true);
}, { passive: true });
document.addEventListener('mousemove', e => {
  if (G.mode !== 'play' || document.pointerLockElement !== canvas) return;
  G.yaw -= e.movementX * 0.0022 * (G.aiming ? 0.6 : 1);
  G.pitch -= e.movementY * 0.0022 * (G.aiming ? 0.6 : 1);
  G.pitch = clamp(G.pitch, -1.45, 1.45);
});
let mouseDown = false;
canvas.addEventListener('mousedown', e => {
  AudioSys.ensure();
  if (G.mode !== 'play') return;
  if (document.pointerLockElement !== canvas) { if (!G.interactOpen) canvas.requestPointerLock(); return; }
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) G.aiming = true;
});
addEventListener('mouseup', e => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) G.aiming = false;
});
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (G.interactOpen) return; // menu handles its own lock
  if (document.pointerLockElement !== canvas && G.mode === 'play' && !G.over) {
    if (G.hp > 0 && !G.roundOver) $('pause').classList.remove('hidden');
  } else {
    $('pause').classList.add('hidden');
  }
});
$('play-btn').onclick = () => {
  AudioSys.ensure(); AudioSys.click();
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  G.mode = 'play';
  canvas.requestPointerLock();
  if (G.bots.length === 0) startRound(); else $('pause').classList.add('hidden');
  $('loading').textContent = '';
};
$('resume-btn').onclick = () => { $('pause').classList.add('hidden'); canvas.requestPointerLock(); };
$('again-btn').onclick = () => {
  $('gameover').classList.add('hidden');
  Object.assign(G, { round: 1, ct: 0, t: 0, kills: 0, deaths: 0, money: 800, over: false, mode: 'play' });
  startRound();
  canvas.requestPointerLock();
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
function isMoving() { return G.keys['KeyW'] || G.keys['KeyA'] || G.keys['KeyS'] || G.keys['KeyD']; }

// ============ update loop ============
const clock = new THREE.Clock();
let orbit = 0;
function moveBot(b, dt, now, anchorPos, engageDist) {
  const bp = b.mesh.position;
  const toP = new THREE.Vector3(anchorPos.x - bp.x, 0, anchorPos.z - bp.z);
  const dist = toP.length();
  if (dist > 0.1) toP.normalize();
  b.strafeT -= dt;
  if (b.strafeT <= 0) { b.strafeT = rand(1, 2.5); b.strafe *= -1; if (Math.random() < 0.3) b.strafe = 0; }
  let mv;
  if (dist > engageDist) mv = toP.clone();
  else if (dist < 5) mv = toP.clone().negate();
  else mv = new THREE.Vector3(-toP.z * b.strafe, 0, toP.x * b.strafe).multiplyScalar(0.8).add(toP.clone().multiplyScalar(0.25));
  if (mv.lengthSq() < 1e-6) return dist;
  mv.normalize().multiplyScalar(b.speed * dt);
  let bx = bp.x + mv.x, bz = bp.z + mv.z;
  [bx, bz] = collide(bx, bz, 0.45);
  bp.x = bx; bp.z = bz;
  b.mesh.rotation.y = Math.atan2(anchorPos.x - bp.x, anchorPos.z - bp.z) + Math.PI;
  b.mesh.position.y = Math.abs(Math.sin(now * 9 + bp.x)) * 0.05;
  return dist;
}
function update(dt, now) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.life -= dt;
    if (f.life <= 0) { scene.remove(f.obj); f.obj.geometry?.dispose?.(); fx.splice(i, 1); }
    else if (f.kind === 'smoke') { f.obj.scale.multiplyScalar(1 + dt * 2); f.obj.material.opacity = (f.life / f.max) * 0.5; }
    else f.obj.material.opacity = f.life / f.max;
  }
  for (let i = particlePool.length - 1; i >= 0; i--) {
    const p = particlePool[i]; p.life -= dt;
    p.obj.position.addScaledVector(p.vel, dt);
    p.vel.y -= 12 * dt;
    if (p.obj.position.y < 0.03) { p.obj.position.y = 0.03; p.vel.set(0, 0, 0); }
    p.obj.material.transparent = true; p.obj.material.opacity = p.life / p.max;
    if (p.life <= 0) { scene.remove(p.obj); particlePool.splice(i, 1); }
  }
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i]; d.life -= dt;
    if (d.life < 2) d.obj.material.opacity = (d.life / 2) * 0.75;
    if (d.life <= 0) { scene.remove(d.obj); decals.splice(i, 1); }
  }
  // site ring pulse
  for (const s of siteRings) {
    s.phase += dt * 2;
    s.ring.material.opacity = 0.55 + Math.sin(s.phase) * 0.25;
  }
  dustMotes.forEach(pts => { pts.rotation.y += dt * 0.01; });
  // hp bars face camera
  for (const b of [...G.bots, ...G.allies]) {
    if (b.state !== 'alive') continue;
    const hb = b.mesh.userData.hpBar;
    if (hb) {
      hb.material.color.setHex(b.hp > 50 ? 0x33ff66 : b.hp > 25 ? 0xffb02e : 0xff4444);
      hb.scale.x = clamp(b.hp / b.maxHp, 0.05, 1);
      hb.lookAt(camera.position);
    }
  }
  updateDeaths(dt);

  if (G.mode !== 'play') {
    orbit += dt * 0.12;
    camera.position.set(Math.sin(orbit) * 30, 12, Math.cos(orbit) * 30);
    camera.lookAt(0, 1, 0);
    gunGroup.visible = false;
    return;
  }
  gunGroup.visible = true;

  if (!G.roundOver) {
    G.time -= dt;
    if (G.time <= 0) { G.time = 0; endRound(false, 'TIME EXPIRED'); }
  }

  camera.position.copy(G.pos);
  camera.rotation.set(G.pitch + gunKick * 0.9, G.yaw, 0);

  const speed = G.keys['ShiftLeft'] ? 2.6 : 4.6;
  const f = new THREE.Vector3(-Math.sin(G.yaw), 0, -Math.cos(G.yaw));
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const wish = new THREE.Vector3();
  if (G.keys['KeyW']) wish.add(f);
  if (G.keys['KeyS']) wish.sub(f);
  if (G.keys['KeyD']) wish.add(r);
  if (G.keys['KeyA']) wish.sub(r);
  const moving = wish.lengthSq() > 0;
  if (moving) wish.normalize().multiplyScalar(speed);
  const accel = G.grounded ? 14 : 3;
  G.vel.x += (wish.x - G.vel.x) * Math.min(1, accel * dt);
  G.vel.z += (wish.z - G.vel.z) * Math.min(1, accel * dt);
  G.vel.y -= 22 * dt;
  if (G.grounded && G.keys['Space']) { G.vel.y = 7.5; G.grounded = false; }
  let nx = G.pos.x + G.vel.x * dt, nz = G.pos.z + G.vel.z * dt;
  [nx, nz] = collide(nx, nz, 0.45);
  let ny = G.pos.y + G.vel.y * dt;
  const groundY = groundHeightAt(nx, nz);
  if (ny <= groundY + 1.7) { ny = groundY + 1.7; G.vel.y = 0; G.grounded = true; } else G.grounded = false;
  G.pos.set(nx, ny, nz);
  const bob = moving && G.grounded ? Math.sin(now * 11) * 0.035 : 0;
  camera.position.y += bob;

  if (G.reloading > 0) {
    G.reloading -= dt;
    if (G.reloading <= 0) {
      const w = G.weapons[G.wi];
      if (w.kind !== 'knife') {
        const need = w.magSize - w.mag, take = Math.min(need, w.reserve);
        w.mag += take; w.reserve -= take;
      }
      updateHUD();
    }
  }
  const w = G.weapons[G.wi];
  if (mouseDown && !G.interactOpen && (w.auto || !w._clicked)) {
    playerShoot(now);
    w._clicked = true;
  }
  if (!mouseDown) w._clicked = false;

  gunKick = Math.max(0, gunKick - dt * 0.35);
  knifeSwing = Math.max(0, knifeSwing - dt * 3);
  const targetPos = G.aiming && w.kind !== 'knife' ? new THREE.Vector3(0, -0.185, -0.4) : new THREE.Vector3(0.28, -0.26, -0.5);
  gunGroup.position.lerp(targetPos, 1 - Math.pow(0.0001, dt));
  const targetFov = G.aiming && w.kind !== 'knife' ? 55 : 75;
  camera.fov += (targetFov - camera.fov) * Math.min(1, 12 * dt);
  camera.updateProjectionMatrix();
  gunGroup.rotation.x = gunKick * 2.2;
  if (w.kind === 'knife') {
    // swing animation
    viewmodels.knife.rotation.z = 0.15 + Math.sin(now * 2) * 0.03 - knifeSwing * 1.4;
    viewmodels.knife.rotation.x = 0.3 - knifeSwing * 0.7;
    viewmodels.knife.position.z = -knifeSwing * 0.25;
  } else {
    viewmodels.knife.rotation.set(0.3, 0, 0.15);
    viewmodels.knife.position.z = 0;
  }

  // --- enemy AI: chase nearest of player/allies ---
  for (const b of G.bots) {
    if (b.state !== 'alive') continue;
    let anchor = G.pos, bd = b.mesh.position.distanceTo(new THREE.Vector3(G.pos.x, 0, G.pos.z));
    if (G.hp <= 0) bd = 1e9;
    for (const a of G.allies) {
      if (a.state !== 'alive') continue;
      const d = b.mesh.position.distanceTo(a.mesh.position);
      if (d < bd) { bd = d; anchor = new THREE.Vector3(a.mesh.position.x, 1.4, a.mesh.position.z); }
    }
    const dist = moveBot(b, dt, now, anchor, 14);
    b.shootCd -= dt;
    if (b.shootCd <= 0 && dist < 42 && !G.roundOver && (G.hp > 0 || G.allies.some(a => a.state === 'alive'))) {
      if (botShoot(b)) b.shootCd = rand(0.7, 1.8);
      else b.shootCd = 0.35;
    }
  }
  // --- ally AI: follow player or hold, engage nearest enemy ---
  for (const a of G.allies) {
    if (a.state !== 'alive') continue;
    let anchor;
    if (G.orders === 'FOLLOW') {
      const off = a === G.allies[0] ? new THREE.Vector3(-1.8, 0, 1.2) : new THREE.Vector3(1.8, 0, 1.2);
      const fx2 = new THREE.Vector3(-Math.sin(G.yaw), 0, -Math.cos(G.yaw));
      const rx = new THREE.Vector3(-fx2.z, 0, fx2.x);
      anchor = G.pos.clone().add(fx2.clone().multiplyScalar(off.z)).add(rx.clone().multiplyScalar(off.x));
      anchor.y = 0;
      const dPlayer = a.mesh.position.distanceTo(new THREE.Vector3(G.pos.x, 0, G.pos.z));
      // if far from player, regroup; else fight nearest enemy
      let foe = null, fd = 1e9;
      for (const b of G.bots) {
        if (b.state !== 'alive') continue;
        const d = a.mesh.position.distanceTo(b.mesh.position);
        if (d < fd) { fd = d; foe = b; }
      }
      if (dPlayer > 7 || !foe || fd > 26) {
        moveBot(a, dt, now, anchor, 1.6);
      } else {
        moveBot(a, dt, now, foe.mesh.position, 12);
      }
    } else {
      // HOLD: strafe in place, face nearest foe
      let foe = null, fd = 1e9;
      for (const b of G.bots) {
        if (b.state !== 'alive') continue;
        const d = a.mesh.position.distanceTo(b.mesh.position);
        if (d < fd) { fd = d; foe = b; }
      }
      if (foe) a.mesh.rotation.y = Math.atan2(foe.mesh.position.x - a.mesh.position.x, foe.mesh.position.z - a.mesh.position.z) + Math.PI;
    }
    a.shootCd -= dt;
    if (a.shootCd <= 0 && !G.roundOver) {
      if (allyShoot(a)) a.shootCd = rand(0.6, 1.4);
      else a.shootCd = 0.4;
    }
  }
  updateHUD();
}

const tops = [];
{
  scene.traverse(o => {
    if (o.isMesh && o.geometry?.type === 'BoxGeometry') {
      const y = o.position.y, h = o.geometry.parameters.height;
      if (y - h / 2 < 1.2 && h <= 2.5 && h >= 1.4) {
        tops.push({ x: o.position.x, z: o.position.z, w: o.geometry.parameters.width, d: o.geometry.parameters.depth, top: y + h / 2 });
      }
    }
  });
}
function groundHeightAt(x, z) {
  let g = 0;
  for (const t of tops) {
    if (Math.abs(x - t.x) < t.w / 2 && Math.abs(z - t.z) < t.d / 2) {
      if (G.pos.y - 1.7 >= t.top - 0.6) g = Math.max(g, t.top);
    }
  }
  return g;
}

// ============ main loop ============
spawnBots();
showViewmodel();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt, clock.elapsedTime);
  renderer.render(scene, camera);
}
animate();
$('loading').textContent = 'ready — click DEPLOY';
updateHUD();
