/**
 * The live globe. Day and night follow the real sun right now; cities light up
 * on the night side. Each arc runs from the server doing the checks to a
 * monitored site's data centre: every check sends a pulse along it, and an
 * outage sends a shockwave out from where the site lives.
 * Plain Three.js in one isolated, lazily loaded component. It pauses when off
 * screen and holds still for visitors who prefer reduced motion.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CITIES } from "../cities";
import land from "../land.json";
import type { LiveEvent, Place, Status } from "../types";

export interface GlobeTarget { id: number; name: string; status: Status; lat: number; lon: number }

export function toVec(lat: number, lon: number, r = 1) {
  const phi = ((90 - lat) * Math.PI) / 180, theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Where the sun is overhead right now (declination and hour angle, good to about a degree). */
export function subsolarPoint(date = new Date()) {
  const dayOfYear = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000;
  const lat = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return { lat, lon: -15 * (hours - 12) };
}

function arcPoints(a: THREE.Vector3, b: THREE.Vector3, n = 80) {
  const angle = a.angleTo(b), lift = 0.05 + 0.2 * (angle / Math.PI);
  const q = new THREE.Quaternion(), axis = new THREE.Vector3().crossVectors(a, b).normalize(), out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    q.setFromAxisAngle(axis, angle * (i / n));
    out.push(a.clone().applyQuaternion(q).multiplyScalar(1.002 + lift * Math.sin(Math.PI * (i / n))));
  }
  return out;
}
const along = (pts: THREE.Vector3[], f: number, out: THREE.Vector3) => {
  const x = Math.min(Math.max(f, 0), 1) * (pts.length - 1), k = Math.floor(x);
  return out.lerpVectors(pts[k], pts[Math.min(k + 1, pts.length - 1)], x - k);
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

// dots that fade by side of the planet: land (dim at night) and city lights (night only)
const DOT_VERT = `
  uniform vec3 uSun; uniform float uSize; uniform float uDay; uniform float uNight; uniform float uRatio;
  attribute float aSize;
  varying float vA;
  void main() {
    float d = dot(normalize(position), uSun);
    vA = mix(uNight, uDay, smoothstep(-0.18, 0.18, d));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * aSize * uRatio / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const DOT_FRAG = `
  uniform vec3 uColor; varying float vA;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(uColor, vA * smoothstep(0.5, 0.18, r));
  }`;

export default function Globe({ targets, origin, subscribe, onSelect, focusId = null, inset = 0 }: {
  targets: GlobeTarget[];
  origin: Place | null;
  subscribe: (cb: (e: LiveEvent) => void) => () => void;
  onSelect: (id: number | null) => void;
  focusId?: number | null;
  inset?: number; // fraction of the width to keep clear: positive on the right, negative on the left
}) {
  const host = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const api = useRef<{ setStatus(t: GlobeTarget[]): void; focus(id: number | null): void } | null>(null);
  const [hover, setHover] = useState<{ name: string; status: Status; x: number; y: number } | null>(null);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    const el = host.current!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.prepend(renderer.domElement);
    Object.assign(renderer.domElement.style, { touchAction: "pan-y", display: "block" });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    const home = origin ? toVec(origin.lat - 12, origin.lon + 35) : toVec(30, -40);
    camera.position.copy(home.clone().multiplyScalar(5));
    const controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(controls, { enableZoom: false, enablePan: false, enableDamping: true, rotateSpeed: 0.5, autoRotate: !reduce, autoRotateSpeed: 0.35 });

    const C = { day: new THREE.Color(), night: new THREE.Color(), dot: new THREE.Color(), city: new THREE.Color(), glow: new THREE.Color(), arc: new THREE.Color(), up: new THREE.Color(), down: new THREE.Color(), idle: new THREE.Color() };
    const readColors = () => {
      C.day.set(css("--globe-day")); C.night.set(css("--globe-night")); C.dot.set(css("--globe-dot")); C.city.set(css("--globe-city"));
      C.glow.set(css("--globe-glow")); C.arc.set(css("--globe-arc")); C.up.set(css("--up")); C.down.set(css("--down")); C.idle.set(css("--muted"));
    };
    readColors();
    const owned: { dispose(): void }[] = [];
    const own = <T extends { dispose(): void }>(x: T) => { owned.push(x); return x; };
    const sun = new THREE.Vector3();
    const setSun = () => { const s = subsolarPoint(); sun.copy(toVec(s.lat, s.lon)).normalize(); };
    setSun();
    const sunTimer = setInterval(setSun, 60_000);

    // the planet: lit by the real sun
    const bodyMat = own(new THREE.ShaderMaterial({
      uniforms: { uDay: { value: C.day }, uNight: { value: C.night }, uSun: { value: sun } },
      vertexShader: `varying vec3 vN; void main() { vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uDay; uniform vec3 uNight; uniform vec3 uSun; varying vec3 vN;
        void main() { float k = smoothstep(-0.12, 0.22, dot(vN, uSun)); gl_FragColor = vec4(mix(uNight, uDay, k), 1.0); }`,
    }));
    scene.add(new THREE.Mesh(own(new THREE.SphereGeometry(1, 96, 96)), bodyMat));

    // a thin atmosphere around the edge
    const glowMat = own(new THREE.ShaderMaterial({
      uniforms: { uGlow: { value: C.glow }, uStrength: { value: 0.9 } }, side: THREE.BackSide, transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uGlow; uniform float uStrength; varying vec3 vN; void main() { float i = pow(0.62 - dot(vN, vec3(0.0, 0.0, 1.0)), 3.2); gl_FragColor = vec4(uGlow, clamp(i, 0.0, 1.0) * uStrength); }`,
    }));
    scene.add(new THREE.Mesh(own(new THREE.SphereGeometry(1.13, 64, 64)), glowMat));

    const ratio = () => renderer.getPixelRatio() * (el.clientHeight || 600) / 600;
    const dots = (coords: number[], r: number, size: number, sizeJitter: number, color: THREE.Color, day: number, night: number, additive: boolean) => {
      const pos = new Float32Array((coords.length / 2) * 3), sizes = new Float32Array(coords.length / 2);
      for (let i = 0; i < coords.length; i += 2) {
        toVec(coords[i], coords[i + 1], r).toArray(pos, (i / 2) * 3);
        sizes[i / 2] = 1 + (Math.sin(i * 12.9898) * 0.5 + 0.5) * sizeJitter;
      }
      const g = own(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
      const m = own(new THREE.ShaderMaterial({
        uniforms: { uSun: { value: sun }, uColor: { value: color }, uSize: { value: size }, uDay: { value: day }, uNight: { value: night }, uRatio: { value: ratio() } },
        vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
      scene.add(new THREE.Points(g, m));
      return m;
    };
    const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
    glowMat.uniforms.uStrength.value = dark() ? 0.9 : 0.45; // a pale haze on light backgrounds
    const landMat = dots(land as number[], 1.002, 9.5, 0, C.dot, 0.62, 0.42, false);
    const cityMat = dots(CITIES.flat(), 1.004, 13, 1.4, C.city, 0, dark() ? 0.95 : 0.85, dark());

    // the server doing the checks
    const o = origin ? toVec(origin.lat, origin.lon) : null;
    const originMat = own(new THREE.MeshBasicMaterial({ color: C.dot }));
    const haloMat = own(new THREE.MeshBasicMaterial({ color: C.dot, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    const halo = new THREE.Mesh(own(new THREE.RingGeometry(0.85, 1, 48)), haloMat);
    if (o) {
      const om = new THREE.Mesh(own(new THREE.SphereGeometry(0.02, 16, 16)), originMat);
      om.position.copy(o.clone().multiplyScalar(1.006));
      scene.add(om);
      halo.position.copy(o.clone().multiplyScalar(1.008));
      halo.lookAt(o.clone().multiplyScalar(2));
      scene.add(halo);
    }

    // one arc, marker and hit area per site
    const arcs = new Map<number, { pts: THREE.Vector3[]; mat: THREE.LineBasicMaterial }>();
    const markers = new Map<number, THREE.Mesh>();
    const hits: THREE.Mesh[] = [];
    const markerGeo = own(new THREE.SphereGeometry(0.018, 16, 16)), hitGeo = own(new THREE.SphereGeometry(0.075, 8, 8));
    const hitMat = own(new THREE.MeshBasicMaterial({ visible: false }));
    const colorOf = (s: Status) => (s === "down" ? C.down : s === "up" ? C.up : C.idle);
    for (const t of targetsRef.current) {
      const p = toVec(t.lat, t.lon);
      if (o) {
        const pts = arcPoints(o, p);
        const mat = own(new THREE.LineBasicMaterial({ color: t.status === "down" ? C.down : C.arc, transparent: true, opacity: t.status === "down" ? 0.75 : 0.32 }));
        scene.add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(pts)), mat));
        arcs.set(t.id, { pts, mat });
      }
      const mk = new THREE.Mesh(markerGeo, own(new THREE.MeshBasicMaterial({ color: colorOf(t.status) })));
      mk.position.copy(p.clone().multiplyScalar(1.006));
      scene.add(mk);
      markers.set(t.id, mk);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.copy(mk.position);
      hit.userData.id = t.id;
      scene.add(hit);
      hits.push(hit);
    }
    const focusRing = new THREE.Mesh(own(new THREE.RingGeometry(0.8, 1, 48)), own(new THREE.MeshBasicMaterial({ color: C.dot, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })));
    focusRing.visible = false;
    scene.add(focusRing);

    // comets: a check flying out along its arc, with a fading tail
    const TAIL = 18;
    const cometMat = (color: THREE.Color) => own(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone() }, uRatio: { value: ratio() } }, transparent: true, depthWrite: false,
      blending: dark() ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute float aA; uniform float uRatio; varying float vA; void main() { vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (4.0 + 12.0 * aA) * uRatio / -mv.z * 2.4; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main() { float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(uColor, vA * smoothstep(0.5, 0.1, r)); }`,
    }));
    const comets: { pts: THREE.Vector3[]; points: THREE.Points; start: number; id: number; ok: boolean }[] = [];
    const waves: { mesh: THREE.Mesh; start: number; size: number; dur: number }[] = [];
    const shockwave = (id: number, big: boolean) => {
      const mk = markers.get(id);
      if (!mk) return;
      const mesh = new THREE.Mesh(own(new THREE.RingGeometry(0.86, 1, 64)), own(new THREE.MeshBasicMaterial({ color: C.down, transparent: true, side: THREE.DoubleSide, depthWrite: false })));
      mesh.position.copy(mk.position);
      mesh.lookAt(mk.position.clone().multiplyScalar(2));
      scene.add(mesh);
      waves.push({ mesh, start: performance.now(), size: big ? 0.32 : 0.11, dur: big ? 2200 : 1100 });
    };
    const flash = new Map<number, number>();
    const off = subscribe((e) => {
      if (e.type === "incident_opened") { shockwave(e.monitor_id, true); return; }
      if (e.type !== "check") return;
      const ok = e.ok ?? e.detail === "up";
      const arc = arcs.get(e.monitor_id);
      if (!arc || reduce || document.hidden) { flash.set(e.monitor_id, performance.now()); if (!ok) shockwave(e.monitor_id, false); return; }
      const g = own(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TAIL * 3), 3));
      const a = new Float32Array(TAIL);
      for (let i = 0; i < TAIL; i++) a[i] = Math.pow(1 - i / TAIL, 1.6);
      g.setAttribute("aA", new THREE.BufferAttribute(a, 1));
      const pts = new THREE.Points(g, cometMat(ok ? C.up : C.down));
      pts.frustumCulled = false;
      scene.add(pts);
      comets.push({ pts: arc.pts, points: pts, start: performance.now(), id: e.monitor_id, ok });
    });

    // flying the camera to a site
    let fly: { from: THREE.Vector3; to: THREE.Vector3; start: number } | null = null;
    let focused: number | null = null;
    const distance = () => camera.position.length();
    api.current = {
      setStatus(ts) {
        for (const t of ts) {
          const mk = markers.get(t.id);
          if (mk) (mk.material as THREE.MeshBasicMaterial).color.copy(colorOf(t.status));
          const arc = arcs.get(t.id);
          if (arc) { arc.mat.color.copy(t.status === "down" ? C.down : C.arc); arc.mat.opacity = t.status === "down" ? 0.75 : 0.32; }
        }
      },
      focus(id) {
        focused = id;
        controls.autoRotate = !reduce && id === null;
        const mk = id === null ? null : markers.get(id);
        focusRing.visible = !!mk;
        if (!mk) { if (label.current) label.current.style.opacity = "0"; return; }
        focusRing.position.copy(mk.position);
        focusRing.lookAt(mk.position.clone().multiplyScalar(2));
        focusRing.scale.setScalar(0.045);
        // look at the site from a little south, so it sits above the middle
        const to = mk.position.clone().normalize().applyAxisAngle(new THREE.Vector3(1, 0, 0).cross(mk.position).normalize(), -0.18).normalize();
        fly = { from: camera.position.clone().normalize(), to, start: performance.now() };
        if (reduce) { camera.position.copy(to.multiplyScalar(distance())); fly = null; }
      },
    };

    // pointer: hover labels and clicks (drags rotate instead)
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let downAt = { x: 0, y: 0 };
    const pick = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(hits)[0];
      return hit && hit.point.clone().normalize().dot(camera.position.clone().normalize()) > 0.2 ? (hit.object.userData.id as number) : null;
    };
    const onMove = (ev: PointerEvent) => {
      const id = pick(ev), t = id ? targetsRef.current.find((x) => x.id === id) : null, r = el.getBoundingClientRect();
      renderer.domElement.style.cursor = t ? "pointer" : "grab";
      setHover(t && t.id !== focused ? { name: t.name, status: t.status, x: ev.clientX - r.left, y: ev.clientY - r.top } : null);
      if (focused === null) controls.autoRotate = !reduce && !t;
    };
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 5) return;
      selectRef.current(pick(ev));
    };
    const onLeave = () => { setHover(null); if (focused === null) controls.autoRotate = !reduce; };
    const cv = renderer.domElement;
    cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointerup", onUp); cv.addEventListener("pointerleave", onLeave);

    // size: keep the whole globe and its arcs in view, shifted left if panels sit on the right
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      Object.assign(cv.style, { width: "100%", height: "100%" });
      camera.aspect = w / h;
      const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const usable = w * (1 - inset);
      const d = Math.max(1.42 / half, 1.42 / (half * (usable / h)));
      camera.position.setLength(d);
      camera.setViewOffset(w, h, (w * inset) / 2, 0, w, h);
      camera.updateProjectionMatrix();
      for (const m of [landMat, cityMat]) m.uniforms.uRatio.value = ratio();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let visible = true;
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
    io.observe(el);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => { readColors(); glowMat.uniforms.uStrength.value = dark() ? 0.9 : 0.45; api.current?.setStatus(targetsRef.current); };
    scheme.addEventListener("change", onScheme);

    const tmp = new THREE.Vector3(), proj = new THREE.Vector3();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      if (fly) {
        const t = Math.min(1, (now - fly.start) / 1400), d = distance();
        camera.position.copy(fly.from.clone().lerp(fly.to, ease(t)).normalize().multiplyScalar(d));
        if (t >= 1) fly = null;
      }
      controls.update();
      if (o) {
        const p = (now % 2600) / 2600;
        halo.scale.setScalar(reduce ? 0.04 : 0.03 + 0.07 * p);
        haloMat.opacity = reduce ? 0.4 : 0.55 * (1 - p);
      }
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i], t = (now - c.start) / 1300;
        if (t >= 1.25) {
          scene.remove(c.points);
          c.points.geometry.dispose(); (c.points.material as THREE.Material).dispose();
          comets.splice(i, 1);
          continue;
        }
        if (t >= 1 && !flash.has(c.id)) { flash.set(c.id, now); if (!c.ok) shockwave(c.id, false); }
        const head = ease(Math.min(t, 1)), attr = c.points.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let k = 0; k < TAIL; k++) along(c.pts, head - k * 0.014, tmp).toArray(attr.array as Float32Array, k * 3);
        attr.needsUpdate = true;
        const fade = t > 1 ? 1 - (t - 1) * 4 : 1;
        (c.points.material as THREE.ShaderMaterial).uniforms.uColor.value.multiplyScalar(1); // colour fixed per comet
        c.points.visible = fade > 0;
      }
      for (const [id, at] of flash) {
        const mk = markers.get(id), t = (now - at) / 700;
        if (!mk || t >= 1) { mk?.scale.setScalar(1); flash.delete(id); continue; }
        mk.scale.setScalar(1 + 1.6 * Math.sin(Math.PI * t));
      }
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i], t = (now - w.start) / w.dur;
        if (t >= 1) { scene.remove(w.mesh); waves.splice(i, 1); continue; }
        w.mesh.scale.setScalar(0.02 + w.size * ease(t));
        (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
      }
      if (focusRing.visible) focusRing.scale.setScalar(0.04 + 0.012 * Math.sin(now / 300));
      // the focused site's name, pinned to its spot on screen
      const mk = focused !== null ? markers.get(focused) : null;
      if (label.current && mk) {
        proj.copy(mk.position).project(camera);
        const front = mk.position.clone().normalize().dot(camera.position.clone().normalize()) > 0.1;
        label.current.style.opacity = front ? "1" : "0";
        label.current.style.transform = `translate(${((proj.x + 1) / 2) * el.clientWidth}px, ${((1 - proj.y) / 2) * el.clientHeight}px) translate(-50%, -150%)`;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); clearInterval(sunTimer); off();
      ro.disconnect(); io.disconnect(); scheme.removeEventListener("change", onScheme);
      cv.removeEventListener("pointermove", onMove); cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointerup", onUp); cv.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      for (const c of comets) { c.points.geometry.dispose(); (c.points.material as THREE.Material).dispose(); }
      owned.forEach((d) => d.dispose());
      renderer.dispose(); cv.remove();
      api.current = null;
    };
    // rebuilt only when the set of sites, the origin or the layout changes
  }, [targets.map((t) => `${t.id}:${t.lat}:${t.lon}`).join(","), origin?.lat, origin?.lon, inset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.current?.setStatus(targets); }, [targets]);
  useEffect(() => { api.current?.focus(focusId); }, [focusId, targets.length]);
  const focusedName = targets.find((t) => t.id === focusId)?.name;

  return (
    <div ref={host} className="relative h-full w-full cursor-grab overflow-hidden active:cursor-grabbing" aria-hidden="true">
      <div ref={label} className="pointer-events-none absolute left-0 top-0 rounded-md bg-ink px-2 py-1 text-[12px] font-medium whitespace-nowrap text-bg opacity-0 transition-opacity duration-200">{focusedName}</div>
      {hover && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[140%] rounded-lg border border-line bg-surface px-3 py-1.5 text-sm whitespace-nowrap shadow-[0_8px_24px_-12px_rgb(16_22_29/0.35)]" style={{ left: hover.x, top: hover.y }}>
          <span className="font-medium">{hover.name}</span>
          <span className={hover.status === "down" ? "text-down" : "text-up"}> {hover.status === "down" ? "down" : "up"}</span>
        </div>
      )}
    </div>
  );
}
