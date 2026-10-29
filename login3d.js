// The sign-in screen's 3D globe: particles swirl together into a dotted Earth (real coastlines),
// flights arc out from Bangalore, the card tilts toward the mouse, and signing in sends shockwaves round it.
// Loaded only when the sign-in screen shows. Nothing here is real board data.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { feature } from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";

const BLR = [12.97, 77.59];
const DOT = 0.042;   // land dot size
const REST = 9.5;    // camera distance once the intro has flown in
const DEST = [[28.61, 77.21], [19.08, 72.88], [22.57, 88.36], [13.08, 80.27], [17.39, 78.49], [1.35, 103.82], [25.2, 55.27], [51.5, -0.12]];

/** Land / sea lookup from world-atlas coastlines, drawn flat onto a canvas. */
async function landMask(W = 1024, H = 512) {
  const topo = await (await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json")).json();
  const land = feature(topo, topo.objects.land), cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff";
  const polys = land.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates));
  for (const poly of polys) {
    g.beginPath();
    for (const ring of poly) {
      let last = null;
      ring.forEach(([lng, lat]) => {
        const x = (lng + 180) / 360 * W, y = (90 - lat) / 180 * H;
        if (last === null || Math.abs(lng - last) > 180) g.moveTo(x, y); else g.lineTo(x, y);   // don't smear across the date line
        last = lng;
      });
      g.closePath();
    }
    g.fill("evenodd");
  }
  const px = g.getImageData(0, 0, W, H).data;
  return (lat, lng) => px[(Math.min(H - 1, Math.floor((90 - lat) / 180 * H)) * W + Math.min(W - 1, Math.floor((lng + 180) / 360 * W))) * 4] > 128;
}

const ll = (lat, lng, r = 2) => {
  const a = (90 - lat) * Math.PI / 180, b = (lng + 180) * Math.PI / 180;
  return new THREE.Vector3(-r * Math.sin(a) * Math.cos(b), r * Math.cos(a), r * Math.sin(a) * Math.sin(b));
};
const toLL = (v) => [90 - Math.acos(v.y / v.length()) * 180 / Math.PI, ((Math.atan2(v.z, -v.x) * 180 / Math.PI - 180 + 540) % 360) - 180];
const fib = (n) => Array.from({ length: n }, (_, i) => {
  const y = 1 - i / (n - 1) * 2, r = Math.sqrt(1 - y * y), t = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r);
});
function arcCurve(a, b) {
  const A = ll(...a, 2.005), B = ll(...b, 2.005), M = A.clone().add(B).multiplyScalar(0.5);
  return new THREE.QuadraticBezierCurve3(A, M.normalize().multiplyScalar(2 + 0.45 * A.distanceTo(B) * 0.5), B);
}

/** A soft round dot, so points stay circles even when they fly right up to the camera. */
let dotTexture = null;
function roundDot() {
  if (dotTexture) return dotTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d"), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "#fff"); grd.addColorStop(0.55, "#fff"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return (dotTexture = new THREE.CanvasTexture(c));
}

/** Card tilt + glare, the staggered rise-in, and the Bangalore clock line. Works even without WebGL. */
function cardEffects({ stage, card, clock, status, still }) {
  const move = (e) => {
    const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const near = Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.5) / 1.6);
    card.style.transform = `rotateY(${(x - 0.5) * 14 * near}deg) rotateX(${(0.5 - y) * 12 * near}deg)`;
    card.style.setProperty("--gx", `${x * 100}%`);
    card.style.setProperty("--gy", `${y * 100}%`);
  };
  if (!still) addEventListener("pointermove", move);
  setTimeout(() => stage.classList.add("in"), still ? 0 : 900);
  const tick = () => {
    const now = new Date(), opt = { timeZone: "Asia/Kolkata" };
    clock.textContent = now.toLocaleTimeString("en-IN", { ...opt, hour: "numeric", minute: "2-digit" });
    const h = Number(now.toLocaleString("en-GB", { ...opt, hour: "2-digit", hour12: false }));
    const weekday = !["Sat", "Sun"].includes(now.toLocaleString("en-GB", { ...opt, weekday: "short" }));
    const [word, note] = h < 6 || h >= 23 ? ["quiet", "the roads are empty"]
      : weekday && ((h >= 8 && h < 11) || (h >= 17 && h < 21)) ? ["rush hour", "expect slow roads"]
      : ["moving", "traffic is flowing"];
    status.innerHTML = `It's <b>${word}</b> right now: ${note}. Sign in to see live times.`;   // fixed words only, no outside text
  };
  tick();
  const timer = setInterval(tick, 20000);
  return () => { clearInterval(timer); removeEventListener("pointermove", move); };
}

/**
 * Start the sign-in screen. Returns { warp(done), reset(), stop() }. warp() plays the sign-in transition
 * and then calls done(); if the 3D scene couldn't start, it calls done() straight away.
 */
export function mountLogin({ canvas, stage, card, clock, status }) {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stopCard = cardEffects({ stage, card, clock, status, still });
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: innerWidth >= 760, alpha: true });
  } catch {
    return { warp: (done) => done(), stop: stopCard };   // no WebGL: the card still works on the plain background
  }
  const LIGHT = innerWidth < 760 || (navigator.deviceMemory || 8) < 4;   // phones get fewer dots
  const ACC = new THREE.Color(getComputedStyle(stage).getPropertyValue("--accent").trim() || "#38e1ff");
  renderer.setPixelRatio(Math.min(devicePixelRatio, LIGHT ? 1.5 : 2));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const globe = new THREE.Group();
  scene.add(globe);
  const face = new THREE.Quaternion().setFromUnitVectors(ll(...BLR).normalize(), new THREE.Vector3(0.18, 0.32, 1).normalize());

  // dark core + soft white halo (Globe 1's look)
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.985, 64, 64), new THREE.MeshBasicMaterial({ color: 0x060607, transparent: true }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(2.18, 64, 64), new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, depthWrite: false,
    vertexShader: "varying vec3 n; void main(){ n = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    uniforms: { uA: { value: 0.45 } },
    fragmentShader: "uniform float uA; varying vec3 n; void main(){ float i = pow(max(0.,.62 - dot(n, vec3(0,0,1.))), 3.); gl_FragColor = vec4(vec3(1.), i*uA); }",
  }));
  globe.add(core, halo);
  const wave = new THREE.Mesh(new THREE.SphereGeometry(2.02, 96, 96), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uDir: { value: ll(...BLR).normalize() }, uR: { value: new THREE.Vector3(-9, -9, -9) }, uC: { value: ACC }, uA: { value: 0 } },
    vertexShader: "varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: "uniform vec3 uDir, uC, uR; uniform float uA; varying vec3 p;"
      + "float ring(float a, float r){ float d = abs(a-r); return 1.4*smoothstep(.22,0.,d) + .5*smoothstep(.7,0.,d)*step(a,r); }"
      + "void main(){ float a = acos(clamp(dot(p,uDir),-1.,1.)); float band = ring(a,uR.x) + .8*ring(a,uR.y) + .6*ring(a,uR.z); gl_FragColor = vec4(uC, min(1.,band)*uA); }",
  }));
  wave.visible = false;
  globe.add(wave);
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), new THREE.MeshBasicMaterial({ color: ACC }));
  pin.position.copy(ll(...BLR, 2.01));
  globe.add(pin);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 48), new THREE.MeshBasicMaterial({ color: ACC, transparent: true, side: THREE.DoubleSide }));
  ring.position.copy(ll(...BLR, 2.012));
  ring.lookAt(ll(...BLR, 3));
  globe.add(ring);
  const flights = DEST.map((d, k) => {
    const curve = arcCurve(BLR, d);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(80)), new THREE.LineBasicMaterial({ color: ACC, transparent: true, opacity: 0 }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 10), new THREE.MeshBasicMaterial({ color: ACC, transparent: true, opacity: 0 }));
    globe.add(line, head);
    return { curve, line, head, t: k / DEST.length, delay: k * 0.15 };
  });

  // particles: start scattered, swirl together into the land dots (Globe 3's intro); faint sea dots fade in
  let dots = null, sea = null, born = 0;
  landMask().then((isLand) => {
    const land = [], water = [];
    fib(LIGHT ? 8000 : 18000).forEach((v) => (isLand(...toLL(v)) ? land : water).push(v.multiplyScalar(2)));
    const home = land, from = home.map(() => new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 10));
    const pos = new Float32Array(home.length * 3), geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const col = new Float32Array(home.length * 3).fill(0.95), toBLR = ll(...BLR).normalize();
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const ang = Float32Array.from(home, (v) => Math.acos(Math.max(-1, Math.min(1, v.clone().normalize().dot(toBLR)))));
    const mat = new THREE.PointsMaterial({ size: DOT, vertexColors: true, transparent: true, opacity: 0.95, map: roundDot(), alphaTest: 0.4 });
    globe.add(new THREE.Points(geo, mat));
    sea = new THREE.Points(new THREE.BufferGeometry().setFromPoints(water.filter((_, i) => i % 7 === 0)),
      new THREE.PointsMaterial({ size: 0.017, color: 0x6e6d68, transparent: true, opacity: 0, map: roundDot(), alphaTest: 0.4 }));
    globe.add(sea);
    dots = { home, from, pos, geo, mat, col, ang };
    born = clock3.getElapsedTime();
  }).catch(() => {});   // coastlines didn't load: the halo, pin and flights still show

  // drag to spin; signing in plays the transition below
  let drag = null, warpT = 0, warping = false, onWarped = null, lastT = 0;
  const spin = new THREE.Vector2(), vel = new THREE.Vector2();
  const down = (e) => { if (!e.target.closest(".stage")) drag = [e.clientX, e.clientY]; };
  const up = () => { drag = null; };
  const dragMove = (e) => {
    if (!drag) return;
    vel.set((e.clientY - drag[1]) * 0.004, (e.clientX - drag[0]) * 0.004);
    spin.add(vel);
    drag = [e.clientX, e.clientY];
  };
  addEventListener("pointerdown", down);
  addEventListener("pointerup", up);
  addEventListener("pointermove", dragMove);
  const layout = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    globe.position.set(innerWidth > 760 ? -2.1 : 0, innerWidth > 760 ? 0 : 1.15, 0);   // phones: big globe filling the top
  };
  addEventListener("resize", layout);
  layout();

  const clock3 = new THREE.Clock(), tmp = new THREE.Vector3(), up3 = new THREE.Vector3(0, 1, 0);
  renderer.setAnimationLoop(() => {
    const t = clock3.getElapsedTime(), ease = still ? 1 : 1 - Math.pow(1 - Math.min(1, t / 2.6), 4);
    if (!drag) { vel.multiplyScalar(0.92); spin.multiplyScalar(0.985); }
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(spin.x, spin.y + (1 - ease) * 5 + (still ? 0 : Math.sin(t * 0.15) * 0.06), 0));
    globe.quaternion.copy(q.multiply(face));

    if (dots) {
      const a = still ? 1 : Math.min(1, (t - born) / 3.2), k = 1 - Math.pow(1 - a, 3);
      if (a < 1 || !dots.done) {
        for (let i = 0; i < dots.home.length; i++) {
          tmp.copy(dots.from[i]).lerp(dots.home[i], k);
          if (k < 1) tmp.applyAxisAngle(up3, (1 - k) * 3);   // swirl while gathering
          dots.pos[i * 3] = tmp.x; dots.pos[i * 3 + 1] = tmp.y; dots.pos[i * 3 + 2] = tmp.z;
        }
        dots.geo.attributes.position.needsUpdate = true;
        dots.done = a >= 1;
      }
      sea.material.opacity = 0.5 * k;
      const shown = t - born - 2.6;   // flights draw in once Earth has formed
      flights.forEach((f) => {
        const o = Math.max(0, Math.min(1, (shown - f.delay) * 1.5));
        f.line.material.opacity = 0.6 * o;
        f.head.material.opacity = o;
        f.t = (f.t + 0.004) % 1;
        f.head.position.copy(f.curve.getPoint(f.t));
      });
    }
    const s = 1 + (t * 0.7 % 1) * 3;
    ring.scale.setScalar(s);
    ring.material.opacity = 1 - (s - 1) / 3;
    pin.scale.setScalar(1 + Math.sin(t * 4) * 0.3);

    const dist = REST + (1 - ease) * 11.5;   // fly in from far away
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    const dt = Math.min(0.05, t - lastT);
    lastT = t;
    if (warping) transition(dt);
    renderer.render(scene, camera);
  });

  // The sign-in transition (about 1.6 s, ending on black): two shockwaves spread out from Bangalore,
  // the land dots light up in the accent colour behind the first one, and the globe whips into a spin
  // round Bangalore and blows apart into flying dots.
  const LENGTH = 1.6, SECOND_WAVE = 0.3 / LENGTH;   // second wave 0.3 s behind the first
  const BREAK = SECOND_WAVE + 0.05;   // spin and scatter start just after the second wave leaves
  const lit = ACC.clone().lerp(new THREE.Color(1, 1, 1), 0.15);
  const blrAxis = ll(...BLR).normalize(), whirlQ = new THREE.Quaternion();
  let whirl = 0, scatter = null;   // spin angle so far; each dot's random fling direction
  function transition(dt) {
    warpT = Math.min(1, warpT + dt / LENGTH);
    const brk = Math.max(0, (warpT - BREAK) / (1 - BREAK));
    whirl += Math.pow(brk, 1.6) * 60 * dt;   // spin speed ramps up to about 10 turns a second
    globe.quaternion.multiply(whirlQ.setFromAxisAngle(blrAxis, whirl));   // spin round Bangalore, along the pulse rings
    core.material.opacity = 1 - Math.min(1, brk * 3);   // the planet empties out as it breaks apart
    halo.material.uniforms.uA.value = 0.45 * (1 - Math.min(1, brk * 3));
    if (brk > 0) {
      pin.visible = ring.visible = false;
      flights.forEach((f) => { f.line.material.opacity = f.head.material.opacity = 0; });
      if (sea) sea.material.opacity = 0;
    }
    const fade = Math.max(0, (warpT - 0.6) / 0.4);
    const radius = (start) => (warpT < start ? -9 : Math.pow((warpT - start) / (1 - start), 0.8) * Math.PI * 1.05);
    wave.visible = true;
    wave.material.uniforms.uR.value.set(radius(0), radius(SECOND_WAVE), -9);
    wave.material.uniforms.uA.value = 1 - fade;
    if (dots) {
      const R = radius(0);
      for (let i = 0; i < dots.ang.length; i++) {
        const m = Math.max(0, Math.min(1, (R - dots.ang[i]) / 0.25));   // 0 ahead of the wave, 1 once it has passed
        dots.col[i * 3] = 0.95 + (lit.r - 0.95) * m; dots.col[i * 3 + 1] = 0.95 + (lit.g - 0.95) * m; dots.col[i * 3 + 2] = 0.95 + (lit.b - 0.95) * m;
      }
      dots.geo.attributes.color.needsUpdate = true;
      if (brk > 0) {
        scatter = scatter || dots.home.map(() => new THREE.Vector3().randomDirection().multiplyScalar(0.4 + Math.random() * 1.2));
        const fly = Math.pow(brk, 1.4) * 7;
        for (let i = 0; i < dots.home.length; i++) {
          tmp.copy(dots.home[i]).multiplyScalar(1 + fly * 0.35).addScaledVector(scatter[i], fly);
          dots.pos[i * 3] = tmp.x; dots.pos[i * 3 + 1] = tmp.y; dots.pos[i * 3 + 2] = tmp.z;
        }
        dots.geo.attributes.position.needsUpdate = true;
        dots.mat.size = DOT + brk * 0.03;
      }
    }
    canvas.style.opacity = String(1 - fade);   // the page behind is black
    if (warpT >= 1 && onWarped) { const done = onWarped; onWarped = null; done(); }
  }

  return {
    warp(done) {
      if (still) return done();
      warping = true; warpT = 0; onWarped = done;
    },
    /** Put everything back (for replaying a transition, or coming back with the Back button). */
    reset() {
      warping = false; warpT = 0; onWarped = null;
      canvas.style.opacity = "1";
      wave.visible = false;
      whirl = 0;
      core.material.opacity = 1; halo.material.uniforms.uA.value = 0.45; pin.visible = ring.visible = true;
      if (dots) { dots.mat.size = DOT; dots.mat.opacity = 0.95; dots.done = false; dots.col.fill(0.95); dots.geo.attributes.color.needsUpdate = true; }
    },
    stop() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      stopCard();
      removeEventListener("pointerdown", down);
      removeEventListener("pointerup", up);
      removeEventListener("pointermove", dragMove);
      removeEventListener("resize", layout);
    },
  };
}
