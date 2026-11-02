import * as THREE from 'three';

const canvas = document.querySelector('#game-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x89938c);
scene.fog = new THREE.Fog(0x89938c, 28, 83);
const camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, 0.1, 120);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const obstacles = [];
const bots = [];
const tracers = [];
const particles = [];
const keys = {};
const player = { x: 0, z: 18, y: 1.65, yaw: 0, pitch: 0, health: 100, armor: 100, kills: 0, ammo: 30, reserve: 90, shots: 0, hits: 0, reloading: false, reloadAt: 0, lastShot: 0, bob: 0, recoil: 0, hurt: 0 };
let active = false, ended = false, mouseHeld = false, roundTime = 90, lastBotShot = 0, lastMinimap = 0, toastTimer = 0;

const mats = {
  floor: new THREE.MeshStandardMaterial({ color: 0x777d70, roughness: 0.93 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x747a70, roughness: .88 }),
  darkConcrete: new THREE.MeshStandardMaterial({ color: 0x424a43, roughness: .9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x555f59, roughness: .58, metalness: .55 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xc6a832, roughness: .68 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x77765d, roughness: .85 }),
  playerGun: new THREE.MeshStandardMaterial({ color: 0x171d1a, roughness: .36, metalness: .72 }),
  gunAccent: new THREE.MeshStandardMaterial({ color: 0x59645b, roughness: .4, metalness: .55 }),
};
const mat = (color, roughness=.8, metalness=0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });

scene.add(new THREE.HemisphereLight(0xdce9ec, 0x3e4337, 2.0));
const sun = new THREE.DirectionalLight(0xffe6c1, 3.2);
sun.position.set(-17, 30, 11); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -34; sun.shadow.camera.right = 34; sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34; sun.shadow.bias = -.0004;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xa6c9d0, 1.1); fill.position.set(20, 12, -20); scene.add(fill);

function box(name, x, y, z, sx, sy, sz, material, collides=true, cast=true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; scene.add(mesh);
  if (collides) { mesh.userData.bounds = { minX:x-sx/2, maxX:x+sx/2, minZ:z-sz/2, maxZ:z+sz/2 }; obstacles.push(mesh); }
  return mesh;
}
function addStripe(x,z,sx,sz,rotation=0) { const m = new THREE.Mesh(new THREE.BoxGeometry(sx,.018,sz), mat(0xe0be3c,.7));m.position.set(x,.012,z);m.rotation.y=rotation;scene.add(m); }

// Concrete yard, perimeter walls and industrial silhouettes.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(58,58), mats.floor); ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
for(let i=-24;i<=24;i+=4){ const line=new THREE.Mesh(new THREE.BoxGeometry(.035,.012,48),mat(0x929487,.95));line.position.set(i,.009,0);scene.add(line); }
for(let i=-24;i<=24;i+=4){ const line=new THREE.Mesh(new THREE.BoxGeometry(48,.012,.035),mat(0x929487,.95));line.position.set(0,.01,i);scene.add(line); }
// Outer barriers: open-feeling warehouse yard enclosed by tall boundary walls.
box('north wall',0,4,-26,54,8,2,mats.darkConcrete,true);
box('south wall',0,4,26,54,8,2,mats.darkConcrete,true);
box('west wall',-26,4,0,2,8,54,mats.darkConcrete,true);
box('east wall',26,4,0,2,8,54,mats.darkConcrete,true);
// Yard containers and waist-high cover.
const containerA=box('container A',-13,1.5,-11,11,3,5,mat(0x7d4734,.65,.25));
const containerB=box('container B',13,1.5,-13,10,3,5,mat(0x526653,.62,.3));
const containerC=box('container C',14,1.5,10,11,3,5,mat(0x8c7041,.65,.25));
const containerD=box('container D',-14,1.5,13,9,3,5,mat(0x566a70,.62,.3));
// Container ribs and door details.
function containerDetails(mesh, width, depth, color) {
  for(let i=-width/2+.5;i<width/2;i+=.8){const rib=new THREE.Mesh(new THREE.BoxGeometry(.055,2.85,.075),mat(color,.55,.35));rib.position.set(mesh.position.x+i,1.5,mesh.position.z+depth/2+.035);scene.add(rib);}
  const top=new THREE.Mesh(new THREE.BoxGeometry(width+.1,.12,depth+.1),mat(0x303a36,.52,.45));top.position.set(mesh.position.x,3.04,mesh.position.z);scene.add(top);
}
containerDetails(containerA,11,5,0xa65d43);containerDetails(containerB,10,5,0x71816c);containerDetails(containerC,11,5,0xb08e51);containerDetails(containerD,9,5,0x748c91);
box('central barricade',0,.75,-2,7,1.5,2.2,mats.crate);
box('west pallet',-6,.65,4,3.2,1.3,1.5,mats.crate);
box('east pallet',7,.6,-8,2.4,1.2,2,mats.crate);
box('south cover',2,.65,12,3,1.3,1.6,mats.metal);
box('north block',-6,.7,-18,3,1.4,2,mats.concrete);
// Loading dock and warning lines.
box('loading dock',-19,.45,1,7,.9,8,mats.concrete);
for(let i=0;i<5;i++){const rail=box('dock rail',-22,.35,-2+i*1.35,.18,.7,.12,mats.yellow,false);}
addStripe(-19,5,7,.12);addStripe(-19,-3,7,.12);addStripe(0,20,11,.12);addStripe(0,-22,13,.12);
// Warehouse facade beyond the north wall.
box('warehouse',0,8,-31,31,16,5,mat(0x444c48,.94),false);
for(let x=-13;x<=13;x+=6){box('warehouse panel',x,8,-28.43,.09,13,.08,mat(0x69716a),false,false);}
for(let x=-10;x<=10;x+=10){const win=box('warehouse window',x,11,-28.38,4,2.2,.06,mat(0x738b8a,.3,.2),false,false);}
// Lamps, poles and gantry.
function pole(x,z){const stem=new THREE.Mesh(new THREE.CylinderGeometry(.09,.13,7,8),mats.metal);stem.position.set(x,3.5,z);stem.castShadow=true;scene.add(stem);const arm=box('lamp arm',x+.6,6.8,z,1.25,.12,.12,mats.metal,false);const lamp=new THREE.Mesh(new THREE.BoxGeometry(.8,.16,.4),mat(0xd5c98d,.28,.1));lamp.position.set(x+1.15,6.72,z);scene.add(lamp);const light=new THREE.PointLight(0xf6d9a1,16,12,2);light.position.set(x+1.15,6.4,z);scene.add(light);}
pole(-22,-17);pole(21,17);
box('gantry crossbeam',0,8,-23,34,.5,.5,mats.metal,false);
for(let x=-15;x<=15;x+=15)box('gantry post',x,4,-23,.35,8,.35,mats.metal,false);
// Scattered decals / puddles.
for(let i=0;i<9;i++){const puddle=new THREE.Mesh(new THREE.CircleGeometry(.45+(i%3)*.2,16),mat(0x454e48,.24,.25));puddle.rotation.x=-Math.PI/2;puddle.scale.set(1.7,.7,1);puddle.position.set(-19+i*4.4,.022, i%2?7:-6);scene.add(puddle);}

// Weapon view model mounted to camera.
const gun = new THREE.Group(); camera.add(gun); scene.add(camera);
const receiver=new THREE.Mesh(new THREE.BoxGeometry(.17,.17,.48),mats.playerGun);receiver.position.set(.32,-.28,-.48);gun.add(receiver);
const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.42,8),mats.playerGun);barrel.rotation.x=Math.PI/2;barrel.position.set(.32,-.255,-.88);gun.add(barrel);
const handguard=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.27),mats.gunAccent);handguard.position.set(.32,-.25,-.73);gun.add(handguard);
const grip=new THREE.Mesh(new THREE.BoxGeometry(.095,.22,.12),mats.playerGun);grip.position.set(.32,-.44,-.45);grip.rotation.x=-.14;gun.add(grip);
const stock=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.22),mats.gunAccent);stock.position.set(.32,-.29,-.18);gun.add(stock);
const sight=new THREE.Mesh(new THREE.BoxGeometry(.055,.11,.08),mats.playerGun);sight.position.set(.32,-.15,-.55);gun.add(sight);
const mag=new THREE.Mesh(new THREE.BoxGeometry(.1,.2,.11),mats.playerGun);mag.position.set(.32,-.44,-.55);mag.rotation.x=-.12;gun.add(mag);
const muzzleLight=new THREE.PointLight(0xffd982,0,4);muzzleLight.position.set(.32,-.25,-1.05);gun.add(muzzleLight);
const muzzleFlash=new THREE.Mesh(new THREE.SphereGeometry(.09,8,8),new THREE.MeshBasicMaterial({color:0xffe084}));muzzleFlash.position.copy(muzzleLight.position);muzzleFlash.visible=false;gun.add(muzzleFlash);

const botMaterials=[0x8b6246,0x596b58,0x596471,0x82714c,0x74535a].map(c=>({cloth:mat(c,.88), armor:mat(0x343b37,.65,.2), skin:mat(0xb58a6a,.85), accent:mat(0xc9a83b,.6,.15)}));
const botSpawns=[[-19,-19],[19,-5],[-19,7],[20,20],[1,-19]];
function makeBot(index,x,z){
  const group=new THREE.Group();group.position.set(x,0,z);group.userData={index,alive:true,hp:100,attack:Math.random()*1.7,phase:Math.random()*6,strafe:Math.random()<.5?-1:1,hitFlash:0};
  const lookMat=botMaterials[index%botMaterials.length];
  const torso=new THREE.Mesh(new THREE.BoxGeometry(.62,.78,.34),lookMat.cloth);torso.position.y=1.22;torso.castShadow=true;group.add(torso);
  const vest=new THREE.Mesh(new THREE.BoxGeometry(.65,.46,.37),lookMat.armor);vest.position.set(0,1.26,-.015);vest.castShadow=true;group.add(vest);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.23,12,10),lookMat.skin);head.position.y=1.83;head.scale.set(.85,1.05,.9);head.castShadow=true;group.add(head);
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(.25,12,8,0,Math.PI*2,0,Math.PI*.52),lookMat.accent);helmet.position.y=1.91;helmet.castShadow=true;group.add(helmet);
  const legs=[];for(const side of [-1,1]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.23,.66,.28),lookMat.cloth);leg.position.set(side*.17,.48,0);leg.castShadow=true;group.add(leg);legs.push(leg);const boot=new THREE.Mesh(new THREE.BoxGeometry(.26,.14,.4),lookMat.armor);boot.position.set(side*.17,.13,-.055);group.add(boot);const arm=new THREE.Mesh(new THREE.BoxGeometry(.2,.62,.23),lookMat.cloth);arm.position.set(side*.42,1.24,-.05);arm.rotation.z=side*.16;arm.castShadow=true;group.add(arm);}
  const rifle=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.65),mats.playerGun);rifle.position.set(.2,1.16,-.48);group.add(rifle);
  const barrelBot=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.22,6),mats.playerGun);barrelBot.rotation.x=Math.PI/2;barrelBot.position.set(.2,1.17,-.9);group.add(barrelBot);
  group.userData.legs=legs;group.userData.torso=torso;group.userData.materials=[lookMat.cloth,lookMat.armor,lookMat.skin,lookMat.accent];scene.add(group);bots.push(group);return group;
}
botSpawns.forEach((p,i)=>makeBot(i,p[0],p[1]));

function collides(x,z,r=.42){
  if(x < -24.4+r || x > 24.4-r || z < -24.4+r || z > 24.4-r)return true;
  for(const o of obstacles){const b=o.userData.bounds;if(x+r>b.minX&&x-r<b.maxX&&z+r>b.minZ&&z-r<b.maxZ)return true;}
  return false;
}
function updateCamera(){camera.position.set(player.x,player.y,player.z);camera.rotation.order='YXZ';camera.rotation.y=player.yaw;camera.rotation.x=player.pitch;}
function activeBots(){return bots.filter(b=>b.userData.alive)}
function showToast(text){const el=document.querySelector('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1800);}
function setScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('visible'));if(id)document.querySelector(id).classList.add('visible');}
function startGame(){
  if(ended)resetGame();
  setScreen(null);document.querySelector('#hud').classList.add('active');active=true;ended=false;
  document.querySelector('#controls-tip').style.opacity='1';
  canvas.requestPointerLock?.();showToast('MISSION ACTIVE — CLEAR THE HOSTILES');
}
function pauseGame(){if(!active||ended)return;active=false;document.querySelector('#hud').classList.remove('active');setScreen('#pause-screen');}
function resumeGame(){setScreen(null);document.querySelector('#hud').classList.add('active');active=true;canvas.requestPointerLock?.();}
function resetGame(){
  for(const b of bots)scene.remove(b);bots.length=0;botSpawns.forEach((p,i)=>makeBot(i,p[0],p[1]));
  player.x=0;player.z=18;player.yaw=0;player.pitch=0;player.health=100;player.armor=100;player.kills=0;player.ammo=30;player.reserve=90;player.shots=0;player.hits=0;player.reloading=false;roundTime=90;ended=false;updateCamera();
  document.querySelector('#health').textContent='100';document.querySelector('#armor').textContent='100';document.querySelector('#kills').textContent='00';document.querySelector('#ammo').textContent='30';document.querySelector('#reserve').textContent='90';document.querySelector('#timer').textContent='01:30';
}
function endGame(won){if(ended)return;ended=true;active=false;document.exitPointerLock?.();document.querySelector('#hud').classList.remove('active');setScreen('#end-screen');document.querySelector('#end-title').innerHTML=won?'YARD<br><span>SECURED.</span>':'MISSION<br><span>FAILED.</span>';document.querySelector('#end-copy').textContent=won?'ALL HOSTILES ELIMINATED. CLEAN WORK.':'YOU WERE ELIMINATED IN ACTION.';document.querySelector('#final-kills').textContent=String(player.kills).padStart(2,'0');document.querySelector('#final-accuracy').textContent=`${player.shots?Math.round(player.hits/player.shots*100):0}%`;document.querySelector('#final-time').textContent=formatTime(90-roundTime);}
function formatTime(seconds){const s=Math.max(0,Math.floor(seconds));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function reload(){if(!active||player.reloading||player.ammo===30||player.reserve===0)return;player.reloading=true;player.reloadAt=performance.now()+1250;document.querySelector('#reload-indicator').classList.add('show');}
function finishReload(){const amount=Math.min(30-player.ammo,player.reserve);player.ammo+=amount;player.reserve-=amount;player.reloading=false;document.querySelector('#reload-indicator').classList.remove('show');document.querySelector('#ammo').textContent=player.ammo;document.querySelector('#reserve').textContent=player.reserve;}
function showHit(){const el=document.querySelector('#hit-marker');el.classList.add('show');setTimeout(()=>el.classList.remove('show'),110);}
function addTracer(start,end,color=0xffd46b){const points=[start.clone(),end.clone()];const geometry=new THREE.BufferGeometry().setFromPoints(points);const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity:.9}));scene.add(line);tracers.push({line,life:.09});}
function shoot(){if(!active||player.reloading||performance.now()-player.lastShot<105)return;if(player.ammo<=0){reload();return;}player.lastShot=performance.now();player.ammo--;player.shots++;player.recoil=Math.min(player.recoil+.045,.13);document.querySelector('#ammo').textContent=player.ammo;document.querySelector('#crosshair').classList.add('spread');setTimeout(()=>document.querySelector('#crosshair').classList.remove('spread'),90);muzzleLight.intensity=18;muzzleFlash.visible=true;setTimeout(()=>{muzzleLight.intensity=0;muzzleFlash.visible=false;},48);
  raycaster.setFromCamera(new THREE.Vector2(0,0),camera);raycaster.far=90;
  const targets=[];for(const b of activeBots())for(const c of b.children)if(c.isMesh)targets.push(c);
  const hit=raycaster.intersectObjects(targets,false)[0];
  let end=raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(44));
  if(hit){end.copy(hit.point);const bot=hit.object.parent;const headshot=hit.object.geometry.type==='SphereGeometry';bot.userData.hp-=headshot?100:38;player.hits++;showHit();if(bot.userData.hp<=0)eliminate(bot,headshot);}
  else {const wallHits=raycaster.intersectObjects(obstacles,false);if(wallHits.length)end.copy(wallHits[0].point);}
  addTracer(raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(.5)),end,0xffe4a0);
}
function eliminate(bot,headshot){bot.userData.alive=false;bot.visible=false;player.kills++;document.querySelector('#kills').textContent=String(player.kills).padStart(2,'0');document.querySelector('#bot-count').textContent=String(activeBots().length).padStart(2,'0');const feed=document.createElement('div');feed.className='feed-item';feed.innerHTML=`YOU <span>✕</span> HOSTILE-${String(bot.userData.index+1).padStart(2,'0')}${headshot?' <b style="color:#d5ff3f"> // HEADSHOT</b>':''}`;const holder=document.querySelector('#kill-feed');holder.prepend(feed);setTimeout(()=>feed.remove(),4200);document.querySelector('#center-message').textContent=headshot?'HEADSHOT':'HOSTILE DOWN';setTimeout(()=>document.querySelector('#center-message').textContent='',700);if(activeBots().length===0)endGame(true);}
function botHasLine(bot,dir,distance){raycaster.set(new THREE.Vector3(bot.position.x,1.45,bot.position.z),dir);raycaster.far=distance;const h=raycaster.intersectObjects(obstacles,false);return !h.length||h[0].distance>distance;}
function botFire(bot){const origin=new THREE.Vector3(bot.position.x,1.45,bot.position.z);const target=new THREE.Vector3(player.x,player.y-.13,player.z);const dir=target.clone().sub(origin).normalize();addTracer(origin,target,0xff664e);const miss=.16+Math.min(.18,origin.distanceTo(target)*.006);if(Math.random()<miss)return;
  player.hurt=.25;player.armor=Math.max(0,player.armor-8);player.health=Math.max(0,player.health-(player.armor?4:11));document.querySelector('#armor').textContent=player.armor;document.querySelector('#health').textContent=player.health;const flash=document.querySelector('#damage-flash');flash.style.opacity='.78';setTimeout(()=>flash.style.opacity='0',120);if(player.health<=0)endGame(false);
}
function updateBots(dt,t){for(const b of activeBots()){
  const dx=player.x-b.position.x,dz=player.z-b.position.z,dist=Math.hypot(dx,dz);const dir=new THREE.Vector3(dx,0,dz).normalize();b.rotation.y=Math.atan2(-dx,-dz);b.userData.phase+=dt*5;
  if(dist>5.8){const speed=dist>12?1.8:1.05;const nx=b.position.x+dir.x*speed*dt,nz=b.position.z+dir.z*speed*dt;if(!collides(nx,b.position.z,.4))b.position.x=nx;else b.userData.strafe*=-1;if(!collides(b.position.x,nz,.4))b.position.z=nz;else b.userData.strafe*=-1;b.userData.legs.forEach((l,i)=>l.rotation.x=Math.sin(b.userData.phase+i*Math.PI)*.45);}
  else {b.userData.legs.forEach(l=>l.rotation.x=0);const sx=-dir.z*b.userData.strafe*.35*dt,sz=dir.x*b.userData.strafe*.35*dt;if(Math.random()<.008)b.userData.strafe*=-1;if(!collides(b.position.x+sx,b.position.z+sz,.4)){b.position.x+=sx;b.position.z+=sz;}}
  const canSee=dist<27&&botHasLine(b,dir,dist);b.userData.attack-=dt;if(canSee&&b.userData.attack<=0){botFire(b);b.userData.attack=1.15+Math.random()*1.2;}
}}
function updatePlayer(dt){
  const forward=(keys.KeyW?1:0)-(keys.KeyS?1:0),side=(keys.KeyD?1:0)-(keys.KeyA?1:0);let dx=0,dz=0;
  if(forward||side){const length=Math.hypot(forward,side);const f=forward/length,s=side/length;const speed=(keys.ShiftLeft||keys.ShiftRight)?8.4:5.2;dx=(-Math.sin(player.yaw)*f+Math.cos(player.yaw)*s)*speed*dt;dz=(-Math.cos(player.yaw)*f-Math.sin(player.yaw)*s)*speed*dt;player.bob+=dt*((speed>7)?13:9);}
  else player.bob*=.85;
  if(!collides(player.x+dx,player.z,.42))player.x+=dx;if(!collides(player.x,player.z+dz,.42))player.z+=dz;
  player.recoil*=Math.pow(.08,dt);camera.rotation.x=player.pitch-player.recoil;gun.position.y=Math.sin(player.bob)*.008;gun.position.x=Math.cos(player.bob*.5)*.006;
}
function drawMinimap(t){if(t-lastMinimap<.12)return;lastMinimap=t;const c=document.querySelector('#minimap'),ctx=c.getContext('2d'),w=c.width,h=c.height,scale=w/52;ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(37,45,38,.96)';ctx.fillRect(0,0,w,h);ctx.strokeStyle='rgba(220,230,215,.12)';ctx.lineWidth=1;for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(i*w/5,0);ctx.lineTo(i*w/5,h);ctx.moveTo(0,i*h/5);ctx.lineTo(w,i*h/5);ctx.stroke();}
  const rect=(x,z,sx,sz,color)=>{ctx.fillStyle=color;ctx.fillRect(w/2+(x-sx/2)*scale,h/2+(z-sz/2)*scale,sx*scale,sz*scale);};
  rect(-13,-11,11,5,'#8e5945');rect(13,-13,10,5,'#65785e');rect(14,10,11,5,'#9b824c');rect(-14,13,9,5,'#65777b');rect(0,-2,7,2.2,'#777765');rect(-19,1,7,8,'#6f756d');
  for(const b of activeBots()){ctx.fillStyle='#ff604d';ctx.beginPath();ctx.arc(w/2+b.position.x*scale,h/2+b.position.z*scale,3,0,Math.PI*2);ctx.fill();}
  ctx.save();ctx.translate(w/2+player.x*scale,h/2+player.z*scale);ctx.rotate(-player.yaw);ctx.fillStyle='#d5ff3f';ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(-4,4);ctx.lineTo(4,4);ctx.closePath();ctx.fill();ctx.restore();
}

// UI actions and input.
document.querySelector('#start-button').addEventListener('click',startGame);
document.querySelector('#resume-button').addEventListener('click',resumeGame);
document.querySelector('#restart-button').addEventListener('click',()=>{resetGame();startGame();});
document.querySelector('#play-again-button').addEventListener('click',()=>{resetGame();startGame();});
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==canvas&&active)pauseGame();});
document.addEventListener('mousemove',e=>{if(!active||document.pointerLockElement!==canvas)return;player.yaw-=e.movementX*.0022;player.pitch-=e.movementY*.0022;player.pitch=THREE.MathUtils.clamp(player.pitch,-1.25,1.25);});
document.addEventListener('mousedown',e=>{if(e.button===0){mouseHeld=active;if(active&&document.pointerLockElement!==canvas)canvas.requestPointerLock?.();else if(active)shoot();}});
document.addEventListener('mouseup',e=>{if(e.button===0)mouseHeld=false;});
document.addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='KeyR')reload();if(e.code==='Escape'&&active){/* pointer lock event handles pause */}if(e.code==='Space')e.preventDefault();});
document.addEventListener('keyup',e=>keys[e.code]=false);
window.addEventListener('blur',()=>{Object.keys(keys).forEach(k=>keys[k]=false);});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));});

function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.04),t=clock.elapsedTime;
  if(active){roundTime-=dt;if(roundTime<=0){roundTime=0;endGame(false);}document.querySelector('#timer').textContent=formatTime(roundTime);if(player.reloading&&performance.now()>=player.reloadAt)finishReload();updatePlayer(dt);updateCamera();if(mouseHeld&&document.pointerLockElement===canvas)shoot();updateBots(dt,t);drawMinimap(t);
  for(let i=tracers.length-1;i>=0;i--){tracers[i].life-=dt;if(tracers[i].life<=0){scene.remove(tracers[i].line);tracers.splice(i,1);}else tracers[i].line.material.opacity=tracers[i].life/.09;}
  renderer.render(scene,camera);
}
updateCamera();animate();
