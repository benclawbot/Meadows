import * as THREE from 'three';
import { channel, clamp, FlightPath, flightSurface, randomFrom, smooth, terrain, waterHeight } from './flight.js';
import { nextRing } from './journey.js';

const fogColor = new THREE.Color(0xa4b2ab);
const sun = new THREE.Vector3(0.38, 0.20, -0.90).normalize();
const vertex = `
  varying vec3 world;
  void main() {
    world = (modelMatrix * vec4(position, 1.)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
  }
`;
const colorOutput = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;
const noise = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.-2.*f);
    return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+1.), f.x), f.y);
  }
  float fbm(vec2 p) {
    return noise(p)*.55 + noise(p*2.05)*.26 + noise(p*4.14)*.13 + noise(p*8.21)*.06;
  }
`;

function makeSky(clock, warmth, haze, skyTint) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { clock, warmth, haze, skyTint, light: { value: sun } },
    vertexShader: vertex,
    fragmentShader: `
      varying vec3 world;
      uniform vec3 light, haze, skyTint;
      uniform float clock, warmth;
      ${noise}
      void main() {
        vec3 dir = normalize(world - cameraPosition);
        float elevation = max(dir.y, 0.);
        float towardSun = max(0., dot(dir, light));
        vec3 zenith = mix(skyTint, skyTint * 1.20, warmth);
        vec3 horizon = mix(haze * 1.18, vec3(.73,.75,.58), warmth*.62);
        vec3 color = mix(horizon, zenith, smoothstep(-.045, .63, dir.y));
        color += vec3(.71,.40,.16) * pow(towardSun, 10.) * (.38 + warmth*.27);
        color += vec3(1.,.75,.39) * pow(towardSun, 72.) * .45;
        color += vec3(2.55,1.78,.88) * smoothstep(.99954,.99973,towardSun);
        vec2 cloudUV = dir.xz / (elevation + .18);
        cloudUV *= vec2(1.35, 2.25);
        cloudUV += vec2(clock * .0035, clock * .001);
        float cloud = smoothstep(.48, .76, fbm(cloudUV));
        cloud *= smoothstep(.015,.12,elevation) * (1.-smoothstep(.7,.95,elevation));
        color = mix(color, mix(vec3(.57,.66,.66),vec3(.93,.79,.52),pow(towardSun,4.)), cloud * .52);
        color = mix(haze, color, smoothstep(-.15,.08,dir.y));
        float grain = hash(gl_FragCoord.xy) - .5;
        gl_FragColor = vec4(color + grain*.004,1.);
        ${colorOutput}
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(340, 48, 28), material);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

function makeGround(mobile) {
  const surface = new THREE.PlaneGeometry(360, 312, mobile ? 220 : 288, mobile ? 192 : 248);
  surface.rotateX(-Math.PI / 2);
  surface.translate(0, 0, -88);
  const position = surface.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const dry = new THREE.Color(0x8e8a57);
  const grass = new THREE.Color(0x516c43);
  const dark = new THREE.Color(0x3d5a42);
  const sand = new THREE.Color(0xae9e78);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const height = terrain(x, z);
    position.setY(i, height);
    const broad = 0.5 + 0.25 * Math.sin(x * 0.20 + z * 0.16) + 0.14 * Math.cos(x * 0.33 - z * 0.23);
    const small = 0.50 + 0.24 * Math.sin(x * 0.92 + z * 0.74) + 0.23 * Math.cos(z * 1.42 - x * 0.32);
    color.copy(dark).lerp(grass, small).lerp(dry, broad * 0.61);
    if (height < 0.52) color.lerp(sand, clamp((0.52 - height) / 1.46, 0, 1));
    color.toArray(colors, i * 3);
  }
  surface.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  surface.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 land;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n land=position.xz;');
    shader.fragmentShader = 'varying vec2 land;\n' + noise + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float grain = noise(land*19.) * .41 + noise(land*5.2)*.36 + noise(land*1.73)*.23;
      diffuseColor.rgb *= .77 + .41 * grain;
    `);
  };
  return new THREE.Mesh(surface, material);
}

function makeWater(clock, warmth, haze) {
  const plane = new THREE.PlaneGeometry(890, 850);
  plane.rotateX(-Math.PI / 2);
  plane.translate(0, waterHeight, -85);
  return new THREE.Mesh(plane, new THREE.ShaderMaterial({
    uniforms: { clock, warmth, haze, light: { value: sun } },
    vertexShader: vertex,
    fragmentShader: `
      uniform float clock, warmth;
      uniform vec3 light, haze;
      varying vec3 world;
      ${noise}
      void main() {
        vec3 eye = normalize(cameraPosition-world);
        vec2 p = world.xz;
        float ripple = noise(p*.14) * 2.6;
        float a = p.x*.66+p.y*1.72-clock*.62+ripple;
        float b = p.x*1.11-p.y*.82-clock*.43-ripple*.79;
        vec3 n = normalize(vec3(.040*cos(a)+.027*cos(b),1.,.047*cos(a)-.021*cos(b)));
        float f = pow(1.-abs(eye.y), 2.8);
        vec3 deep = vec3(.045,.18,.18);
        vec3 reflected = mix(vec3(.20,.35,.35),vec3(.40,.48,.39),warmth);
        vec3 color = mix(deep, reflected, .28+.70*f);
        float gloss = pow(max(dot(reflect(-light,n),eye),0.),110.);
        float glimmer = max(0., sin(a*1.42+sin(b*1.34)*1.8));
        color += (vec3(1.2,.86,.40)*gloss * (0.38 + .62 * glimmer));
        color += vec3(.031,.049,.049) * pow(glimmer,5.) * (.25+.75*noise(p*.43));
        float distanceToEye = length(cameraPosition-world);
        color = mix(color,haze,1.-exp(-distanceToEye*distanceToEye*.000090));
        gl_FragColor = vec4(color,1.);
        ${colorOutput}
      }
    `,
  }));
}

function grassGeometry() {
  const positions = [], indices = [];
  const rng = randomFrom(52);
  for (let blade = 0; blade < 4; blade++) {
    const start = positions.length / 3;
    const x = (rng() - 0.5) * 0.36, z = (rng() - 0.5) * 0.29;
    const tip = (rng() - 0.4) * 0.40, height = 0.59 + rng() * 0.41, width = 0.027 + rng() * 0.039;
    const facing = rng() * Math.PI;
    for (const [y, taper] of [[0, 1], [0.31, 0.83], [0.58, 0.65], [0.81, 0.43], [1, 0.025]]) {
      for (const side of [-1, 1]) {
        positions.push(
          x + Math.cos(facing) * width * taper * side + tip * y * y,
          height * y,
          z + Math.sin(facing) * width * taper * side + 0.15 * y * y,
        );
      }
    }
    for (let i = start; i < start + 8; i += 2) indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function makeGrass(clock, warmth, haze, wake, pulse, glades, mobile) {
  const rng = randomFrom(32160);
  const geometry = grassGeometry();
  const tuft = [];
  const style = [];
  function plant(x, z, near) {
    const y = terrain(x, z);
    if (y < waterHeight + 0.14) return;
    const reed = Math.abs(channel(x, z)) < 1.37 && z < 15 && rng() < 0.36;
    const height = reed ? 0.83 + rng() * 0.81 : 0.25 + rng() * (near ? 0.49 : 0.62);
    tuft.push(x, y - 0.045, z, height);
    style.push(rng() * 6.283, 0.56 + rng() * 1.03, rng(), reed ? 1 : 0);
  }
  const foreground = mobile ? 14200 : 29000;
  for (let i = 0; i < foreground; i++) {
    plant((rng() - 0.5) * 98, 20 - rng() * 151, true);
  }
  for (let i = 0; i < (mobile ? 3700 : 6500); i++) {
    plant((rng() - 0.5) * 177, 35 - rng() * 205, false);
  }
  geometry.setAttribute('tuft', new THREE.InstancedBufferAttribute(new Float32Array(tuft), 4));
  geometry.setAttribute('style', new THREE.InstancedBufferAttribute(new Float32Array(style), 4));
  geometry.instanceCount = tuft.length / 4;

  const glow = { value: new Float32Array(3) };
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      clock, warmth, haze, wake, pulse, glow,
      patches: { value: glades.map(glade => new THREE.Vector2(glade.x, glade.z)) },
    },
    vertexShader: `
      attribute vec4 tuft, style;
      uniform float clock;
      uniform vec3 wake;
      varying vec3 world;
      varying vec4 plant;
      void main() {
        vec3 local = position;
        float ca=cos(style.x), sa=sin(style.x);
        local.xz = mat2(ca, -sa, sa, ca)*local.xz * style.y;
        local.y *= tuft.w;
        float wind = sin(tuft.x*.16 + tuft.z*.11 - clock*1.67);
        wind += .44*sin(tuft.x*.36 - tuft.z*.27 - clock*2.17);
        vec2 away = tuft.xz - wake.xz;
        float wakeWeight = exp(-dot(away,away)*.48) * wake.y;
        local.xz += (vec2(.22,.14)*(wind+.50) + away*wakeWeight*.42) * position.y*position.y * tuft.w;
        world = tuft.xyz + local;
        plant = vec4(position.y, style.z, style.w, wind);
        gl_Position = projectionMatrix * viewMatrix * vec4(world,1.);
      }
    `,
    fragmentShader: `
      uniform float clock, warmth, glow[3];
      uniform vec3 haze, pulse;
      uniform vec2 patches[3];
      varying vec3 world;
      varying vec4 plant;
      void main() {
        float restoration = 0.;
        for(int i=0; i<3; i++) restoration += glow[i]*exp(-dot(world.xz-patches[i],world.xz-patches[i])*.011);
        vec3 base = mix(vec3(.057,.092,.042),vec3(.21,.25,.082),plant.y*.8);
        vec3 tip = mix(vec3(.20,.28,.105),vec3(.41,.43,.172),plant.y);
        tip = mix(tip,vec3(.52,.50,.27),plant.z*.61);
        vec3 color = mix(base,tip,smoothstep(0.,.96,plant.x));
        color *= .81 + .24 * plant.y + .10*plant.w;
        color += vec3(.13,.123,.042) * max(0.,plant.w+.1)*plant.x*plant.x;
        color += vec3(.08,.10,.025)*restoration*(.26+.74*plant.x);
        color += vec3(.10,.057,.009)*warmth*plant.x;
        float age = max(0.,clock-pulse.z);
        float ring = length(world.xz-pulse.xy)-age*6.0;
        color += vec3(.18,.11,.025) * exp(-ring*ring*2.0-age*1.8) * plant.x;
        float distanceToEye = distance(world,cameraPosition);
        color = mix(color,haze,1.-exp(-distanceToEye*distanceToEye*.000090));
        gl_FragColor = vec4(color,1.);
        ${colorOutput}
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, glow };
}

function makeRocks() {
  const rng = randomFrom(870);
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, flatShading: true }),
    105,
  );
  const dummy = new THREE.Object3D();
  const shade = new THREE.Color();
  for (let i = 0; i < rocks.count; i++) {
    const z = 12 - rng() * 120;
    const x = i < 60 ? (rng() - 0.5) * 99 : 14 + rng() * 28;
    const size = i < 10 ? 0.9 + rng() * 1.8 : 0.12 + rng() * 0.74;
    dummy.position.set(x, Math.max(waterHeight - 0.10, terrain(x, z)) - size * 0.15, z);
    dummy.rotation.set(rng() * 1.5, rng() * 7, rng() * 0.8);
    dummy.scale.set(size, size * (0.4 + rng() * 0.4), size * (0.66 + rng() * 0.45));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    shade.setHSL(0.12 + rng() * 0.04, 0.06 + rng() * 0.12, 0.26 + rng() * 0.21);
    rocks.setColorAt(i, shade);
  }
  return rocks;
}

function softDot() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, '#fffefa');
  gradient.addColorStop(0.12, 'rgba(255,250,226,.85)');
  gradient.addColorStop(0.37, 'rgba(255,242,201,.22)');
  gradient.addColorStop(1, 'rgba(255,242,201,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function makeFlowers(count, dot) {
  const group = new THREE.Group();
  const stems = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.015, 0.029, 1, 8, 2),
    new THREE.MeshStandardMaterial({ color: 0x516438, roughness: 1 }), count,
  );
  const blossoms = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.74, emissive: 0x888888, emissiveIntensity: 0.075,
    }), count * 5,
  );
  const hearts = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xd3a85b, roughness: 0.83, emissive: 0xaa7344, emissiveIntensity: 0.31 }),
    count,
  );
  const highlights = new THREE.BufferGeometry();
  highlights.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const glints = new THREE.Points(highlights, new THREE.PointsMaterial({
    color: 0xffecbf, map: dot, transparent: true, opacity: 0.72, depthWrite: false, size: 0.86,
  }));
  const bud = new THREE.Color();
  function recolor(flowers) {
    for (let i = 0; i < count; i++) {
      bud.setHex(flowers[i].color);
      for (let petal = 0; petal < 5; petal++) {
        blossoms.setColorAt(i * 5 + petal, bud);
      }
    }
    blossoms.instanceColor.needsUpdate = true;
  }
  for (const mesh of [stems, blossoms, hearts, glints]) mesh.frustumCulled = false;
  group.add(stems, blossoms, hearts, glints);
  return { group, stems, blossoms, hearts, glints, recolor };
}

function makePetalTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');
  // The mesh already forms the silhouette. Shade its whole UV surface.
  const fill = ctx.createLinearGradient(0, 32, 128, 78);
  fill.addColorStop(0, '#f0f0f0');
  fill.addColorStop(0.44, '#ffffff');
  fill.addColorStop(1, '#f3f3f3');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 128, 192);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.065)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(64, 181);
  ctx.quadraticCurveTo(63, 98, 64, 12);
  ctx.stroke();
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 7; i++) {
    const y = 35 + i * 19;
    const spread = 13 + Math.sin(i * 0.7) * 5;
    ctx.beginPath();
    ctx.moveTo(64, y + 14);
    ctx.quadraticCurveTo(64 - spread * 0.35, y + 4, 64 - spread, y - 4);
    ctx.moveTo(64, y + 14);
    ctx.quadraticCurveTo(64 + spread * 0.35, y + 4, 64 + spread, y - 4);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makePetals() {
  const geometry = new THREE.PlaneGeometry(2, 2, 16, 24);
  const points = geometry.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const y = points.getY(i);
    const x = points.getX(i) * (0.23 + 0.73 * Math.sin((y + 1) * 1.44));
    points.setXYZ(i, x + y * y * 0.16, y, 0.30 * x * x + y * 0.28 + y * y * 0.18);
  }
  const material = new THREE.MeshBasicMaterial({
    map: makePetalTexture(), side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, 68);
  mesh.frustumCulled = false;
  mesh.count = 1;
  return mesh;
}

export function createMeadowView(canvas, journey, mobile, reduced) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0xa4b2ab);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.07;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(fogColor, 0.0095);
  const camera = new THREE.PerspectiveCamera(53, 1, 0.065, 355);
  const clock = { value: 0 }, warmth = { value: 0 }, haze = { value: fogColor.clone() };
  const skyTint = { value: new THREE.Color() };
  const wake = { value: new THREE.Vector3() };
  const pulse = { value: new THREE.Vector3(0, 0, -20) };
  const grass = makeGrass(clock, warmth, haze, wake, pulse, journey.meadow.glades, mobile);
  const ambient = new THREE.HemisphereLight(0xe5f1ff, 0x6a6740, 1.75);
  const sunlight = new THREE.DirectionalLight(0xffe4ab, 2.15);
  sunlight.position.copy(sun).multiplyScalar(56);
  const dot = softDot();
  const flowers = makeFlowers(journey.meadow.flowers.length, dot);
  const petals = makePetals();
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dot, color: 0xffecbf, opacity: 0.95, depthWrite: false, toneMapped: false,
  }));
  const ringGeometry = new THREE.TorusGeometry(1, 0.025, 8, 72);
  const rings = Array.from({ length: 5 }, () => new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
  })));
  const winds = new THREE.BufferGeometry();
  const windPoints = new Float32Array(108);
  winds.setAttribute('position', new THREE.BufferAttribute(windPoints, 3));
  const wisps = new THREE.Points(winds, new THREE.PointsMaterial({
    color: 0xf9eaca, size: 0.20, map: dot, transparent: true, opacity: 0.51, depthWrite: false, fog: true,
  }));
  wisps.frustumCulled = false;
  scene.add(makeSky(clock, warmth, haze, skyTint), makeGround(mobile), makeWater(clock, warmth, haze), grass.mesh,
    makeRocks(), flowers.group, petals, wisps, marker, ...rings, ambient, sunlight);

  const dummy = new THREE.Object3D();
  const target = new THREE.Vector3();
  const eye = new THREE.Vector3(8, 5.35, 14);
  const look = new THREE.Vector3(-0.8, 1.8, -24);
  const warmFog = new THREE.Color(0xc1b89d);
  const levelFog = new THREE.Color();
  let path = new FlightPath();
  const petalShape = randomFrom(62023);
  const flutter = Array.from({ length: 68 }, () => ({
    phase: petalShape() * Math.PI * 2,
    rate: 1.8 + petalShape() * 2.05,
    lean: (petalShape() - 0.5) * 1.10,
    size: 0.72 + petalShape() * 0.49,
    born: -20,
  }));
  const pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0 };
  const tint = new THREE.Color();
  petals.setColorAt(0, tint.setHex(0xffedd4));
  let lightStage = 0, lastWidth = 0, lastHeight = 0, reposition = true;

  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height || (width === lastWidth && height === lastHeight)) return;
    lastWidth = width;
    lastHeight = height;
    const limit = mobile ? 1.22 : 1.55;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, limit, Math.sqrt(2200000 / (width * height))));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width < height ? 66 : 51;
    camera.updateProjectionMatrix();
  }

  function drawFlowers(time, destination) {
    const { meadow } = journey;
    const highlights = flowers.glints.geometry.attributes.position;
    const { blossoms, hearts, stems } = flowers;
    for (let i = 0; i < meadow.flowers.length; i++) {
      const flower = meadow.flowers[i];
      const base = terrain(flower.x, flower.z);
      const stem = 0.58 + 0.31 * (0.5 + 0.5 * Math.sin(i * 5.13));
      const sway = Math.sin(time * 1.56 + flower.x * 0.18 + flower.z * 0.15) * 0.15;
      const height = base + stem;
      dummy.rotation.set(sway * 0.28, 0, -sway);
      dummy.position.set(flower.x + sway * 0.21, base + stem / 2, flower.z);
      dummy.scale.set(1, stem, 1);
      dummy.updateMatrix();
      stems.setMatrixAt(i, dummy.matrix);
      const opening = flower.growth;
      const sx = flower.x + sway * 0.46;
      dummy.position.set(sx, height + 0.015, flower.z);
      dummy.scale.set(0.082 + opening * 0.038, 0.097 - opening * 0.041, 0.082 + opening * 0.038);
      dummy.updateMatrix();
      hearts.setMatrixAt(i, dummy.matrix);
      for (let p = 0; p < 5; p++) {
        const angle = p * Math.PI * 2 / 5 + i * 1.39;
        const span = 0.077 + 0.165 * opening;
        dummy.position.set(sx + Math.sin(angle) * span, height + 0.104 - 0.041 * opening,
          flower.z + Math.cos(angle) * span);
        dummy.rotation.set(0, angle, 0, 'YXZ');
        dummy.rotateX(-0.79 + opening * 0.68 + sway * 0.33);
        dummy.scale.set(0.078 + opening * 0.038, 0.036, 0.134 + opening * 0.092);
        dummy.updateMatrix();
        blossoms.setMatrixAt(i * 5 + p, dummy.matrix);
      }
      const visible = flower.glade === destination?.glade && !flower.bloomed;
      highlights.setXYZ(i, sx, visible ? height + 0.27 + 0.08 * Math.sin(time * 1.8 + i) : -20, flower.z);
    }
    for (const mesh of [blossoms, hearts, stems]) mesh.instanceMatrix.needsUpdate = true;
    highlights.needsUpdate = true;
  }

  function drawFlight(flight, time, dt, total, destination, active) {
    const y = flightSurface(flight.x, flight.z) + flight.height;
    const forwardX = Math.sin(flight.heading), forwardZ = -Math.cos(flight.heading);
    if (active) path.add(flight.x, y, flight.z);
    dummy.position.set(flight.x, y + Math.sin(time * 2.9) * 0.066, flight.z);
    dummy.rotation.set(-0.75 + flight.rise * 0.35 + Math.sin(time * 3.25) * 0.28,
      flight.heading + Math.sin(time * 2.25) * 0.23, Math.cos(time * 2.02) * 0.53, 'YXZ');
    dummy.scale.set(0.21, 0.28, 0.22);
    dummy.updateMatrix();
    petals.setMatrixAt(0, dummy.matrix);
    petals.count = 1;

    const size = Math.min(67, total * 4);
    const acceleration = clamp((flight.speed - 3.65) / (7.3 - 3.65), 0, 1);
    const width = 1 - acceleration * 0.48;
    for (let i = 1; i <= size; i++) {
      const petal = flutter[i];
      const individual = time * petal.rate + petal.phase;
      const spacing = i * 0.34 + Math.sin(individual * 0.59) * 0.08;
      if (!path.sample(spacing, pose)) break;
      // Age shifts the shared wave down the ribbon, while each petal flutters at its own rate.
      const wave = time * 2.05 - spacing * 1.45;
      // Give the ribbon a broader orbit around its leading petal, then draw it
      // in as the flight gathers speed.
      const spread = Math.min(0.96, i * 0.049) * width;
      const spiral = time * 1.15 - spacing * 0.58 + petal.phase;
      const orbit = (0.16 + spread * 0.66) * width;
      const side = spread * (Math.sin(wave) * 0.49 + Math.sin(individual) * 0.22 + petal.lean * 0.36)
        + Math.cos(spiral) * orbit;
      const lift = spread * (Math.cos(wave * 0.91) * 0.27 + Math.cos(individual * 1.12) * 0.18)
        + Math.sin(spiral) * orbit * 0.58;
      const rightX = Math.cos(pose.heading), rightZ = Math.sin(pose.heading);
      dummy.position.set(pose.x + rightX * side, pose.y + lift, pose.z + rightZ * side);
      dummy.rotation.set(-0.97 + pose.pitch * 0.53 + Math.sin(individual) * 0.53,
        pose.heading + petal.lean * 0.59 + Math.cos(wave + petal.phase) * 0.36,
        petal.lean + Math.cos(individual * 0.72) * 0.70 + Math.sin(wave) * 0.22 + spiral * 0.72, 'YXZ');
      const appear = clamp((time - petal.born) / 0.48, 0, 1);
      const scale = Math.max(0.076, 0.164 - i * 0.0010) * petal.size
        * appear * appear * (3 - 2 * appear);
      dummy.scale.set(scale * 0.83, scale * 1.29, scale);
      dummy.updateMatrix();
      petals.setMatrixAt(i, dummy.matrix);
      petals.count++;
    }
    petals.instanceMatrix.needsUpdate = true;
    wake.value.set(flight.x, active ? 1 : 0, flight.z);

    const wx = destination ? destination.x - flight.x : forwardX * 10;
    const wz = destination ? destination.z - flight.z : forwardZ * 10;
    const distance = Math.hypot(wx, wz) || 1;
    for (let i = 0; i < 36; i++) {
      const flow = ((time * 0.19 + i * 0.618) % 1) * (active ? Math.min(distance, 14) : 22) + 1.0;
      const lateral = Math.sin(i * 12.17 + time * 0.47) * (1.3 + flow * 0.15);
      const x = flight.x + wx / distance * flow + wz / distance * lateral;
      const z = flight.z + wz / distance * flow - wx / distance * lateral;
      windPoints[i * 3] = x;
      const low = Math.max(terrain(x, z), waterHeight) + 1.05;
      const height = destination?.y === undefined ? low : THREE.MathUtils.lerp(y, destination.y, Math.min(1, flow / distance));
      windPoints[i * 3 + 1] = Math.max(low, height) + Math.sin(i * 3.8 + time * 1.18) * 0.44;
      windPoints[i * 3 + 2] = z;
    }
    winds.attributes.position.needsUpdate = true;

    if (active) {
      const overview = clamp((flight.height - 4) / 38, 0, 1);
      const trailing = (lastWidth < lastHeight ? 5.8 : 5.0) + overview * 2.65;
      const cx = flight.x - forwardX * trailing;
      const cz = flight.z - forwardZ * trailing;
      target.set(cx, Math.max(y + 1.56 + overview * 2.35, terrain(cx, cz) + 2.35), cz);
      eye.lerp(target, reposition ? 1 : 1 - Math.exp(-5.2 * dt));
      target.set(flight.x + forwardX * 11, y - 0.25 - overview * 7.1 + flight.rise * 1.6,
        flight.z + forwardZ * 11);
      look.lerp(target, reposition ? 1 : 1 - Math.exp(-4.8 * dt));
      reposition = false;
    } else {
      const sway = reduced ? 0 : Math.sin(time * 0.19);
      eye.set(7.45 + sway * 0.31, 4.85 + sway * 0.14, 13.75);
      look.set(3.6, 1.56, -25);
    }
    camera.position.copy(eye);
    camera.lookAt(look);
    if (!reduced && active) camera.rotateZ(flight.steer * -0.027);
  }

  function reset(nextJourney) {
    journey = nextJourney;
    path = new FlightPath();
    pulse.value.z = -20;
    lightStage = 0;
    reposition = true;
    const { level, meadow } = journey;
    levelFog.setHex(level.haze);
    skyTint.value.setHex(level.sky);
    sunlight.color.setHex(level.light);
    flowers.recolor(meadow.flowers);
    const patches = grass.mesh.material.uniforms.patches.value;
    meadow.glades.forEach((glade, i) => patches[i].set(glade.x, glade.z));
    rings.forEach((mesh, i) => {
      const ring = journey.rings[i];
      mesh.visible = false;
      if (!ring) return;
      mesh.position.set(ring.x, ring.y, ring.z);
      mesh.scale.setScalar(ring.radius);
      mesh.rotation.y = ring.heading;
      mesh.material.color.setHex(level.ringColor);
    });
  }

  reset(journey);
  return {
    draw(flight, time, dt, total, destination, progress, active) {
      resize();
      clock.value = time;
      const { meadow } = journey;
      lightStage = smooth(lightStage, progress, dt, 0.32);
      warmth.value = lightStage;
      haze.value.copy(levelFog).lerp(warmFog, lightStage * 0.36);
      scene.fog.color.copy(haze.value);
      sunlight.intensity = 2.05 + lightStage * 0.42;
      for (let i = 0; i < meadow.glades.length; i++) {
        const glade = meadow.glades[i];
        glade.glow = smooth(glade.glow, glade.lit ? 1 : 0, dt, 0.76);
        grass.glow.value[i] = glade.glow;
      }
      marker.visible = active && destination?.glade !== undefined;
      if (marker.visible) {
        marker.position.set(destination.x, terrain(destination.x, destination.z) + 1.55, destination.z);
        marker.scale.setScalar(1.3 + (reduced ? 0 : Math.sin(time * 2.1) * 0.14));
        marker.material.color.setHex(destination.color);
      }
      const ring = active && nextRing(journey);
      rings.forEach((mesh, i) => {
        mesh.visible = Boolean(ring && i >= journey.passed && i <= journey.passed + 1 && journey.rings[i]);
        if (mesh.visible) mesh.material.opacity = i === journey.passed ? 0.86 : 0.24;
      });
      drawFlowers(time, destination);
      drawFlight(flight, time, dt, total, destination, active);
      renderer.render(scene, camera);
    },
    bloom(total, flower, time) {
      pulse.value.set(flower.x, flower.z, time);
      const first = 1 + (total - 1) * 4;
      const end = Math.min(first + 4, flutter.length);
      if (first >= end) return;
      tint.setHex(flower.color);
      for (let i = first; i < end; i++) {
        flutter[i].born = time + (i - first) * 0.037;
        petals.setColorAt(i, tint);
      }
      petals.instanceColor.needsUpdate = true;
    },
    reset,
  };
}
