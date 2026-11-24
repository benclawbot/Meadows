import * as THREE from 'three';
import { clamp, driftFromBloom, FlightPath, gustStrength, randomFrom, smooth } from './flight.js';
import { channel, flightSurface, groundBounds, groundCover, outerGroundHeight, sandRipples, terrain, terrainDetail, waterHeight } from './landscape.js';
import { makeWeather, weatherByLandscape } from './weather.js';
import { currentLeg } from './journey.js';
import { MeadowWake, readWake } from './meadow-wake.js';
import { estuarySkyGLSL, makeEstuaryLandmarks } from './estuary-art.js';

const fogColor = new THREE.Color(0xa4b2ab);
const moon = new THREE.Vector3(-0.32, 0.31, -0.88).normalize();
const horizonSpan = 1100;
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

function makeSky(clock, warmth, haze, skyTint, light, night, air, clouds, skyUniforms) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { clock, warmth, haze, skyTint, light, night, air, clouds, ...skyUniforms },
    vertexShader: vertex,
    fragmentShader: `
      varying vec3 world;
      uniform vec3 light, haze, skyTint;
      uniform vec4 air, clouds;
      uniform float clock, warmth, night;
      ${noise}
      ${estuarySkyGLSL}
      void main() {
        vec3 dir = normalize(world - cameraPosition);
        float elevation = max(dir.y, 0.);
        float towardSun = max(0., dot(dir, light));
        vec3 zenith = mix(skyTint, skyTint * 1.20, warmth);
        vec3 horizon = mix(haze * mix(1.30, 0.94, night), vec3(.73,.75,.58), warmth*.20*air.z*(1.-night));
        vec3 color = mix(horizon, zenith, smoothstep(-.045, .60, dir.y));
        color += mix(vec3(.39,.25,.13), vec3(.012,.023,.050), night)
          * pow(towardSun, 11.) * (.46 + warmth*.24) * air.z;
        color += mix(vec3(.9,.76,.51), vec3(.093,.15,.28), night) * pow(towardSun, 94.) * .28 * air.z;
        color += mix(vec3(1.8,1.55,1.05), vec3(1.30,1.63,2.10), night)
          * smoothstep(.99976,.99984,towardSun) * air.z;
        if (night > .5) {
          vec2 starUV = vec2(atan(dir.z, dir.x), dir.y) * 171.;
          vec2 cell = floor(starUV);
          vec2 center = vec2(hash(cell + 17.13), hash(cell + 38.07)) * .68 + .16;
          float spark = hash(cell);
          float star = (1.-smoothstep(.045,.105+spark*.078,length(fract(starUV)-center))) * step(.973,spark);
          color += mix(vec3(.32,.49,.77),vec3(.65,.54,.45),hash(cell+57.7))
            * star * smoothstep(.075,.39,elevation) * (1.-pow(towardSun,40.));
        }
        vec2 wind = vec2(.016,.004) * clock * air.w;
        vec2 drift = mat2(.94,-.34,.34,.94) * dir.xz;
        vec2 highUV = drift / (elevation + .31) * vec2(1.35, 7.1) - wind * .27;
        float highLayer = smoothstep(.48, .77, fbm(highUV * 1.4 + vec2(8.7,14.4)));
        highLayer *= smoothstep(.025,.18,elevation) * (1.-smoothstep(.69,.99,elevation));
        vec3 highTint = mix(mix(haze * 1.48,vec3(.91,.83,.68),pow(towardSun,3.)*air.z), skyTint*1.38, night);
        color = mix(color, highTint, highLayer * clouds.w);

        vec2 lowUV = drift / (elevation + .20) * vec2(clouds.x, clouds.y) - wind;
        lowUV += vec2(3.3,6.4);
        float cover = fbm(lowUV + (noise(lowUV*.59)-.5)*.52);
        float threshold = .69 - air.y*.31;
        float cloud = smoothstep(threshold-.075, threshold+.14, cover);
        cloud *= smoothstep(.008,.105,elevation) * (1.-smoothstep(.64,.98,elevation));
        float thickness = smoothstep(threshold, threshold+.27, cover);
        vec3 cloudEdge = mix(haze*1.36 + skyTint*.23,vec3(.86,.82,.70),air.z*.63);
        vec3 cloudBody = mix(haze * (.70+air.z*.54),cloudEdge, .28);
        vec3 cloudColor = mix(cloudEdge,cloudBody,thickness);
        cloudColor += mix(vec3(.16,.099,.054),vec3(.018,.029,.048),night)
          * pow(towardSun,5.) * air.z * (1.-thickness*.72);
        color = mix(color, mix(cloudColor,skyTint*(.55+.40*(1.-thickness)),night), cloud * clouds.z);
        float rain = noise(vec2(atan(dir.z,dir.x)*21. + elevation*4.4 - wind.x,elevation*2.9));
        rain *= smoothstep(.83,.95,air.y) * smoothstep(.013,.067,elevation) * (1.-smoothstep(.085,.28,elevation));
        color = mix(color,haze*.66,rain*.33);
        if (authoredSky > .5) {
          vec3 outlook = estuarySkyAt(dir);
          outlook *= mix(vec3(.76,.93,1.20), vec3(1.22,1.01,.75), pow(towardSun,5.));
          color = mix(color, outlook, .82);
          color += vec3(.46,.31,.16) * pow(towardSun,32.) * .47;
          color += vec3(1.34,.87,.48) * smoothstep(.99987,.99992,towardSun);
        }
        color = mix(haze, color, smoothstep(-.115,.047,dir.y));
        float grain = hash(gl_FragCoord.xy) - .5;
        gl_FragColor = vec4(color + grain*.004,1.);
        ${colorOutput}
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(260, 48, 28), material);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}

function makeGround(mobile, landscape, wakeUniforms, sculpt) {
  const { width, depth, centerZ } = groundBounds;
  const surface = sculpt?.geometry.clone() ?? new THREE.PlaneGeometry(width, depth, mobile ? 220 : 288, mobile ? 192 : 248);
  const position = surface.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const exposed = new Float32Array(position.count);
  const [dark, grass, dry, sand] = landscape.soil.map(hex => new THREE.Color(hex));
  const stone = new THREE.Color(landscape.stone[0]);
  const isAlpine = landscape.name === 'alpine';
  const isDunes = landscape.name === 'dunes';
  const hasCliffs = isDunes || isAlpine || landscape.name === 'coast';
  const horizonColor = isAlpine ? dry : grass;
  const color = new THREE.Color();
  if (!sculpt) {
    surface.rotateX(-Math.PI / 2);
    surface.translate(0, 0, centerZ);
    for (let i = 0; i < position.count; i++) {
      position.setY(i, terrain(position.getX(i), position.getZ(i), landscape));
    }
    surface.computeVertexNormals();
  }
  const normals = surface.attributes.normal;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    const height = position.getY(i);
    const cover = groundCover(x, z);
    const slope = 1 - normals.getY(i);
    const broad = 0.58 + 0.24 * Math.sin(x * 0.077 + z * 0.151) + 0.15 * Math.sin(z * 0.054 - x * 0.123);
    color.copy(dark).lerp(grass, 0.35 + cover * 0.55).lerp(dry, broad * (1 - 0.58 * cover));
    if (landscape.water && height < 0.48) color.lerp(sand, clamp((0.48 - height) / 1.38, 0, 1));
    if (isAlpine) color.copy(sand).lerp(dry, clamp(0.26 + height * 0.029 + cover * 0.54 - slope * 0.63, 0.12, 0.94));
    if (isDunes) color.lerp(dark, 0.11 * (1 + sandRipples(x, z)));
    exposed[i] = clamp((slope - (hasCliffs ? 0.105 : 0.18)) * (hasCliffs ? 2.1 : 1.9), 0, 0.92);
    color.lerp(stone, exposed[i] * (0.54 + (1 - cover) * 0.42));
    if (!landscape.water) {
      const detail = terrainDetail(x, z);
      color.lerp(horizonColor, 1 - detail);
      exposed[i] *= detail;
    }
    color.toArray(colors, i * 3);
  }
  surface.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  surface.setAttribute('exposed', new THREE.BufferAttribute(exposed, 1));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 });
  if (sculpt) {
    material.map = sculpt.material.map;
    material.normalMap = sculpt.material.normalMap;
    material.normalScale.set(.39, .39);
  }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, wakeUniforms);
    shader.vertexShader = 'attribute float exposed; varying vec4 land;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n land=vec4((modelMatrix*vec4(position,1.)).xyz,exposed);');
    shader.fragmentShader = 'varying vec4 land;\n' + noise + readWake + shader.fragmentShader;
    if (sculpt) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        vec3 groundPhoto = texture2D(map,vMapUv).rgb;
        float grit = dot(groundPhoto,vec3(.2126,.7152,.0722));
        diffuseColor.rgb *= .54 + grit*2.4;
        diffuseColor.rgb *= mix(vec3(1.),vec3(1.20,1.03,.82),land.w*.56);
      `);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float low = noise(land.xz*.56);
      float grain = noise(land.xz*14.)*.25 + noise(land.xz*4.8)*.32 + noise(land.xz*1.6)*.23 + low*.20;
      float bedding = land.y*3.57 + land.x*.21 + land.z*.056 + low*1.22;
      float strata = smoothstep(-.2,.57,sin(bedding)+.25*sin(bedding*3.1));
      float leafShadow = wakeAt(land.xz).z;
      diffuseColor.rgb *= (.71 + .57 * grain + (strata-.40)*land.w*(.12+.19*low)) * (1.-.10*leafShadow);
    `);
  };
  const ground = new THREE.Mesh(surface, material);
  ground.receiveShadow = !!sculpt;
  if (landscape.water) return { ground };
  const plain = new THREE.PlaneGeometry(horizonSpan, horizonSpan);
  plain.rotateX(-Math.PI / 2);
  // A slight offset keeps the horizon from overlapping the detailed ground in the depth buffer.
  plain.translate(0, outerGroundHeight - 0.06, 0);
  const plainColors = new Float32Array(12);
  for (let i = 0; i < 4; i++) horizonColor.toArray(plainColors, i * 3);
  plain.setAttribute('color', new THREE.BufferAttribute(plainColors, 3));
  plain.setAttribute('exposed', new THREE.BufferAttribute(new Float32Array(4), 1));
  const horizon = new THREE.Mesh(plain, material);
  horizon.renderOrder = 1;
  return { ground, horizon };
}

function makeWater(clock, warmth, haze, light, night, air, landscape, skyUniforms) {
  const [deep, shallows] = landscape.water.map(hex => new THREE.Color(hex));
  const width = 192, height = 208;
  const area = new THREE.Vector4(-106, -172, 212, 214);
  const bed = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const z = area.y + (row + 0.5) * area.w / height;
    for (let column = 0; column < width; column++) {
      const x = area.x + (column + 0.5) * area.z / width;
      bed[row * width + column] = Math.round(clamp((waterHeight - terrain(x, z, landscape)) / 3.1, 0, 1) * 255);
    }
  }
  const depth = new THREE.DataTexture(bed, width, height, THREE.RedFormat);
  depth.minFilter = depth.magFilter = THREE.LinearFilter;
  depth.needsUpdate = true;
  const plane = new THREE.PlaneGeometry(horizonSpan, horizonSpan);
  plane.rotateX(-Math.PI / 2);
  plane.translate(0, waterHeight, 0);
  const mesh = new THREE.Mesh(plane, new THREE.ShaderMaterial({
    uniforms: {
      clock, warmth, haze, light, night, air, ...skyUniforms, deep: { value: deep }, shallows: { value: shallows },
      depthMap: { value: depth }, reliefBounds: { value: area },
      swell: { value: landscape.name === 'coast' ? 0.65 : landscape.name === 'dunes' ? 0.38 : 0.17 },
    },
    vertexShader: vertex,
    fragmentShader: `
      uniform float clock, warmth, night, swell;
      uniform vec3 light, haze, deep, shallows;
      uniform vec4 air, reliefBounds;
      uniform sampler2D depthMap;
      varying vec3 world;
      ${noise}
      ${estuarySkyGLSL}
      void main() {
        vec3 eye = normalize(cameraPosition-world);
        vec2 p = world.xz;
        vec2 bedUV = (p-reliefBounds.xy)/reliefBounds.zw;
        vec2 border = min(bedUV,1.-bedUV);
        float depth = mix(1.,texture2D(depthMap,bedUV).r,smoothstep(0.,.027,min(border.x,border.y)));
        float ripple = noise(p*.14) * 2.6;
        float waveTime = clock * (.48 + air.w);
        float a = p.x*.66+p.y*1.72-waveTime*.62+ripple;
        float b = p.x*1.11-p.y*.82-waveTime*.43-ripple*.79;
        float foil = sin(p.x*.24+p.y*.61-waveTime+ripple*.48);
        float crossRipple = cos(p.x*2.33 + p.y*2.82 + 3.*ripple - waveTime*1.72);
        vec3 n = normalize(vec3(.032*cos(a)+.019*cos(b)+swell*.055*foil+crossRipple*.015,
          1.,.036*cos(a)-.018*cos(b)+crossRipple*.012));
        float f = pow(1.-abs(eye.y), 2.8);
        vec3 reflected = mix(shallows, haze, warmth*.25+.12);
        vec3 color = mix(mix(shallows*.68,deep,smoothstep(.04,.65,depth)), reflected, .10+.75*f);
        if (authoredSky > .5) {
          vec3 skyMirror = estuarySkyAt(reflect(-eye,n));
          float sandTexture = fbm(p*2.58);
          vec3 bedColor = mix(vec3(.11,.15,.067),vec3(.33,.29,.131),sandTexture);
          bedColor += vec3(.05,.078,.037) * pow(max(0.,sin(a+b*1.17)),7.);
          vec3 transmitted = mix(
            mix(bedColor,shallows,smoothstep(0.,.21,depth)), deep, smoothstep(.15,.79,depth));
          color = mix(transmitted,skyMirror, .08+.76*pow(1.-abs(eye.y),4.));
        }
        float reflection = max(dot(reflect(-light,n),eye),0.);
        float gloss = pow(reflection, mix(110.,152.,night));
        float glimmer = max(0., sin(a*1.42+sin(b*1.34)*1.8));
        color += mix(vec3(.88,.72,.49),vec3(.40,.62,1.02),night)
          * (gloss * 0.77 + pow(reflection,24.) * .16) * (0.38 + .62 * glimmer);
        color += mix(vec3(.031,.049,.049),vec3(.004,.009,.02),night)
          * pow(glimmer,5.) * (.25+.75*noise(p*.43));
        float foam = smoothstep(.42,.90, sin(depth*36. + foil*2.2 + waveTime*.77) * .60 + noise(p*2.6)*.62);
        foam *= (1.-smoothstep(.04,.25,depth)) * smoothstep(.005,.035,depth) * swell;
        color = mix(color, mix(vec3(.71,.78,.72),vec3(.084,.16,.27),night),foam*.53);
        float distanceToEye = length(cameraPosition-world);
        color = mix(color,haze,1.-exp(-distanceToEye*distanceToEye*air.x*air.x));
        gl_FragColor = vec4(color,1.);
        ${colorOutput}
      }
    `,
  }));
  mesh.userData.depthTexture = depth;
  return mesh;
}

function grassGeometry() {
  const positions = [], indices = [], grain = [];
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
        grain.push(0);
      }
    }
    for (let i = start; i < start + 8; i += 2) indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
  }
  const head = positions.length / 3;
  positions.push(-0.018, 0.30, 0.05, 0.016, 0.30, 0.05, 0.025, 1.13, 0.31, 0.005, 1.13, 0.31);
  positions.push(0.015, 0.97, 0.27, -0.046, 1.13, 0.29, 0.015, 1.34, 0.40, 0.067, 1.16, 0.33);
  positions.push(0.015, 0.97, 0.27, 0.03, 1.12, 0.27, 0.015, 1.34, 0.40, 0.01, 1.16, 0.37);
  grain.push(1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2);
  for (let i = head; i < head + 12; i += 4) indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('grain', new THREE.Float32BufferAttribute(grain, 1));
  geometry.setIndex(indices);
  return geometry;
}

function makeGrass(clock, warmth, haze, night, wakeUniforms, pulse, glades, mobile, landscape, air, fescue) {
  const rng = randomFrom(32160);
  const [base, tips, density, stature, spread] = landscape.plants;
  const blades = fescue?.clone() ?? grassGeometry();
  if (fescue) {
    const color = blades.attributes.color;
    const seed = new Float32Array(color.count);
    for (let i = 0; i < seed.length; i++) seed[i] = color.getX(i) > color.getY(i) ? 2 : 0;
    blades.setAttribute('grain', new THREE.BufferAttribute(seed, 1));
  }
  const tiles = new Map();
  const tileSize = 16;
  const cliffCountry = landscape.name === 'coast' || landscape.name === 'alpine' || landscape.name === 'dunes';
  function plant(x, z, near) {
    const y = terrain(x, z, landscape);
    if (landscape.water && y < waterHeight + 0.14) return;
    const cover = groundCover(x, z);
    if (rng() > (fescue ? 0.61 + cover * 0.39 : 0.44 + cover * 0.56)) return;
    if (cliffCountry && y > 2.7 && rng() < 0.92) {
      const slope = Math.hypot(terrain(x + 0.6, z, landscape) - y, terrain(x, z + 0.6, landscape) - y) / 0.6;
      if (slope > 0.93) return;
    }
    const reed = landscape.name === 'marsh' ? y < 0.54 && rng() < 0.61
      : landscape.name === 'meadow' && Math.abs(channel(x, z)) < 1.43 && z < 15 && rng() < 0.39;
    const height = reed ? 0.85 + rng() * 0.65 : 0.24 + rng() * (near ? 0.61 : 0.69) + cover * 0.13;
    const seed = reed || (cover > 0.59 && rng() < 0.27);
    const key = `${Math.floor(x / tileSize)},${Math.floor(z / tileSize)}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = { tuft: [], style: [], bounds: new THREE.Box3() };
      tiles.set(key, tile);
    }
    tile.tuft.push(x, y - 0.045, z, height * stature);
    tile.style.push(rng() * 6.283, (0.51 + rng() * 1.04) * spread, rng(), reed ? 2 : seed ? 1 : 0);
    tile.bounds.min.min(boundsPoint.set(x, y, z));
    tile.bounds.max.max(boundsPoint.set(x, y + height * stature * 1.4, z));
  }
  const boundsPoint = new THREE.Vector3();
  const foreground = fescue ? (mobile ? 28500 : 65700) : (mobile ? 18800 : 39700);
  for (let i = 0; i < foreground * density; i++) {
    plant((rng() - 0.5) * 98, 20 - rng() * 151, true);
  }
  for (let i = 0; i < (mobile ? 4300 : 8800) * density; i++) {
    plant((rng() - 0.5) * 177, 35 - rng() * 205, false);
  }
  if (fescue) {
    for (let i = 0; i < (mobile ? 3700 : 8600); i++) {
      plant(-22 + rng() * 46, 16 - rng() * 54, true);
    }
  }

  const glow = { value: new Float32Array(3) };
  const range = mobile ? 53 : 82;
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      clock, warmth, haze, night, pulse, glow, air, ...wakeUniforms,
      range: { value: fescue ? range : 250 },
      baseTint: { value: new THREE.Color(base) }, tipTint: { value: new THREE.Color(tips) },
      seedTint: { value: new THREE.Color(landscape.seedColor) },
      patches: { value: glades.map(glade => new THREE.Vector2(glade.x, glade.z)) },
    },
    vertexShader: `
      attribute vec4 tuft, style;
      attribute float grain;
      uniform float clock, range;
      uniform vec4 air;
      varying vec3 world;
      varying vec4 plant;
      varying vec2 surface;
      ${readWake}
      void main() {
        vec3 local = position;
        if (grain > .5 && style.w < .5) local = vec3(0.);
        float ca=cos(style.x), sa=sin(style.x);
        local.xz = mat2(ca, -sa, sa, ca)*local.xz * style.y;
        float distanceFade = 1.-smoothstep(range-18.,range,distance(tuft.xz,cameraPosition.xz));
        local.y *= tuft.w * distanceFade;
        float motion = clock * (.63 + air.w*.48);
        float wind = sin(tuft.x*.090 + tuft.z*.074 - motion*.94);
        wind += .34*sin(tuft.x*.192 - tuft.z*.156 - motion*1.31)
          + .085*sin(tuft.x*.44 + tuft.z*.27 - motion*1.88);
        vec3 wake = wakeAt(tuft.xz);
        float blade = min(1.25,position.y);
        vec2 breeze = vec2(.26,.15)*(wind+.38)*(.65+air.w*.42);
        local.xz += (breeze + wake.xy*(.94+style.z*.26)) * blade * blade * tuft.w * distanceFade;
        local.y *= 1. - .48*wake.z*min(1.,blade);
        world = tuft.xyz + local;
        plant = vec4(blade, style.z, step(1.5,style.w), wind);
        surface = vec2(grain, wake.z);
        gl_Position = projectionMatrix * viewMatrix * vec4(world,1.);
      }
    `,
    fragmentShader: `
      uniform float clock, warmth, night, glow[3];
      uniform vec3 haze, pulse, baseTint, tipTint, seedTint;
      uniform vec4 air;
      uniform vec2 patches[3];
      varying vec3 world;
      varying vec4 plant;
      varying vec2 surface;
      void main() {
        float restoration = 0.;
        for(int i=0; i<3; i++) restoration += glow[i]*exp(-dot(world.xz-patches[i],world.xz-patches[i])*.011);
        vec3 base = baseTint * (.40 + plant.y*.75);
        vec3 tip = tipTint * (.58 + plant.y*.48);
        tip = mix(tip,tipTint*.88 + vec3(.09,.08,.03),plant.z*.61);
        vec3 color = mix(base,tip,smoothstep(0.,.96,plant.x));
        color *= .79 + .26 * plant.y + .11*plant.w;
        color = mix(color,seedTint*(.87 + plant.y*.17),smoothstep(1.,1.65,surface.x)*.88);
        color *= 1. - surface.y*.18*(1. - plant.x*.63);
        color += tipTint*.26*surface.y*smoothstep(.37,1.,plant.x);
        color += tipTint*.25 * max(0.,plant.w+.1)*plant.x*plant.x;
        color += tipTint*.27*restoration*(.26+.74*plant.x);
        color += tipTint*.15*warmth*plant.x*air.z;
        float age = max(0.,clock-pulse.z);
        float ring = length(world.xz-pulse.xy)-age*6.0;
        float ripple = exp(-ring*ring*2.0-age*1.8) * plant.x;
        vec3 nightColor = color * vec3(.36,.45,.73) + vec3(.005,.018,.057) * restoration;
        color = mix(color, nightColor, night);
        color += mix(vec3(.18,.11,.025), vec3(.023,.12,.36),night) * ripple;
        float distanceToEye = distance(world,cameraPosition);
        color = mix(color,haze,1.-exp(-distanceToEye*distanceToEye*air.x*air.x));
        gl_FragColor = vec4(color,1.);
        ${colorOutput}
      }
    `,
  });
  const meshes = [...tiles.values()].map(({ tuft, style, bounds }) => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(blades.index);
    geometry.setAttribute('position', blades.attributes.position);
    geometry.setAttribute('grain', blades.attributes.grain);
    geometry.setAttribute('tuft', new THREE.InstancedBufferAttribute(new Float32Array(tuft), 4));
    geometry.setAttribute('style', new THREE.InstancedBufferAttribute(new Float32Array(style), 4));
    geometry.instanceCount = tuft.length / 4;
    geometry.boundingSphere = bounds.expandByScalar(3.5).getBoundingSphere(new THREE.Sphere());
    return new THREE.Mesh(geometry, material);
  });
  return { meshes, material, glow, range: fescue ? range : 250 };
}

function makeRocks(landscape, mobile) {
  const rng = randomFrom(870);
  const [color, scale, profile, elongation] = landscape.stone;
  const stone = new THREE.Color(color);
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, flatShading: true }),
    mobile ? 82 : 105,
  );
  const dummy = new THREE.Object3D();
  const shade = new THREE.Color();
  let placed = 0;
  for (let i = 0; i < rocks.count + 40 && placed < rocks.count; i++) {
    const z = 12 - rng() * 120;
    const x = i < 60 ? (rng() - 0.5) * 99 : 14 + rng() * 28;
    const size = scale * (i < 15 ? 0.8 + rng() * 1.6 : 0.12 + rng() * 0.81);
    const height = terrain(x, z, landscape);
    const slope = Math.hypot(terrain(x + size, z, landscape) - height, terrain(x, z + size, landscape) - height) / size;
    if (slope > 0.82) continue;
    dummy.position.set(x, height - size * (0.18 + 0.31 * slope), z);
    dummy.rotation.set(rng() * 0.6, rng() * 7, rng() * 0.35);
    dummy.scale.set(size, size * profile * (0.68 + rng() * 0.58), size * elongation * (0.66 + rng() * 0.45));
    dummy.updateMatrix();
    rocks.setMatrixAt(placed, dummy.matrix);
    shade.copy(stone).multiplyScalar(0.66 + rng() * 0.57);
    rocks.setColorAt(placed++, shade);
  }
  rocks.count = placed;
  return rocks;
}

function makeOutcrops(landscape) {
  const rng = randomFrom(5317);
  const sides = 13;
  const rings = [[-0.20, 1.04], [0.04, 1], [0.25, 0.96], [0.29, 0.92], [0.47, 0.91],
    [0.53, 0.84], [0.70, 0.83], [0.78, 0.78], [0.93, 0.74], [1, 0.46], [1.02, 0]];
  const radial = Array.from({ length: sides }, () => [0.82 + rng() * 0.30, rng() - 0.5]);
  const positions = [], colors = [], indices = [];
  for (const [layer, [y, radius]] of rings.entries()) {
    for (let side = 0; side < sides; side++) {
      const [scale, roughness] = radial[side];
      const angle = (side + roughness * 0.47) / sides * Math.PI * 2 + y * 0.24;
      positions.push(Math.cos(angle) * scale * radius + y * 0.21,
        y + roughness * radius * 0.13, Math.sin(angle) * scale * radius - y * 0.13);
      const seam = layer === 3 || layer === 5 || layer === 7 ? 0.79 : 1;
      const tone = seam * (0.85 + y * 0.13 + roughness * 0.22 + rng() * 0.10);
      colors.push(tone, tone, tone);
      if (layer) {
        const point = layer * sides + side, next = layer * sides + (side + 1) % sides;
        indices.push(point - sides, point, next, point - sides, next, next - sides);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, rock, landscape.outcrops.length);
  const dummy = new THREE.Object3D();
  const tone = new THREE.Color();
  landscape.outcrops.forEach(([x, z, width, height, length, turn], i) => {
    const center = terrain(x, z, landscape);
    const foot = Math.min(center, terrain(x - width * 0.51, z, landscape), terrain(x + width * 0.51, z, landscape),
      terrain(x, z - length * 0.51, landscape), terrain(x, z + length * 0.51, landscape));
    dummy.position.set(x, (center + foot) * 0.5 - 0.16, z);
    dummy.rotation.set((rng() - 0.5) * 0.17, turn, (rng() - 0.5) * 0.24);
    dummy.scale.set(width, height, length);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, tone.setHex(landscape.stone[0]).multiplyScalar(0.79 + rng() * 0.36));
  });
  return mesh;
}

function makeGustMotes(mobile, haze, night) {
  const rng = randomFrom(68417);
  const particles = Array.from({ length: mobile ? 48 : 87 }, () => [rng() * 42, rng() * 37, rng(), rng()]);
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(particles.length * 6), 3);
  const strength = new THREE.BufferAttribute(new Float32Array(particles.length * 2), 1);
  positions.setUsage(THREE.DynamicDrawUsage);
  strength.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positions);
  geometry.setAttribute('strength', strength);
  const material = new THREE.ShaderMaterial({
    uniforms: { haze, night, gust: { value: 0 } },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute float strength;
      varying float visibility;
      void main() {
        visibility = strength;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.);
      }
    `,
    fragmentShader: `
      uniform vec3 haze;
      uniform float night, gust;
      varying float visibility;
      void main() {
        vec3 tint = mix(mix(haze,vec3(.78,.78,.65),.74),vec3(.26,.44,.72),night);
        gl_FragColor = vec4(tint,visibility*gust*.68);
        ${colorOutput}
      }
    `,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.frustumCulled = false;
  const wrap = (value, span) => value - Math.floor(value / span) * span;
  return {
    mesh,
    draw(eye, forwardX, forwardZ, speed, time, landscape) {
      const energy = clamp((speed - 0.12) / 0.88, 0, 1);
      mesh.visible = energy > 0;
      if (!mesh.visible) return;
      material.uniforms.gust.value = energy;
      const cx = eye.x + forwardX * 13, cz = eye.z + forwardZ * 13;
      for (let i = 0; i < particles.length; i++) {
        const [px, pz, elevation, shimmer] = particles[i];
        const ox = wrap(px + time * 0.48 - cx, 42) - 21;
        const oz = wrap(pz - time * 0.26 - cz, 37) - 18.5;
        const x = cx + ox, z = cz + oz;
        const y = eye.y + (elevation - 0.57) * 5.1;
        const floor = flightSurface(x, z, landscape);
        const depth = (x - eye.x) * forwardX + (z - eye.z) * forwardZ;
        const fade = clamp(Math.min(21 - Math.abs(ox), 18.5 - Math.abs(oz)) / 3.2, 0, 1)
          * clamp((y - floor - 0.35) / 1.12, 0, 1) * clamp((depth - 1.2) / 2.9, 0, 1)
          * (1 - clamp((depth - 15) / 17, 0, 1));
        const length = (0.24 + shimmer * 0.49) * (0.45 + speed * 0.85);
        positions.setXYZ(i * 2, x, y, z);
        positions.setXYZ(i * 2 + 1, x - forwardX * length, y + shimmer * 0.033, z - forwardZ * length);
        strength.setX(i * 2, fade * (0.34 + shimmer * 0.46));
        strength.setX(i * 2 + 1, 0);
      }
      positions.needsUpdate = strength.needsUpdate = true;
    },
  };
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

function makeFlowers(count, dot, petal) {
  const group = new THREE.Group();
  const stems = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.015, 0.029, 1, 8, 2),
    new THREE.MeshStandardMaterial({ color: 0x516438, roughness: 1 }), count,
  );
  const blossoms = new THREE.InstancedMesh(
    petal,
    new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.68, side: THREE.DoubleSide, emissive: 0x888888, emissiveIntensity: 0.075,
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
  const fill = ctx.createLinearGradient(30, 192, 85, 18);
  fill.addColorStop(0, '#b3b3b3');
  fill.addColorStop(0.38, '#e6e6e6');
  fill.addColorStop(0.84, '#ffffff');
  fill.addColorStop(1, '#f6f6f6');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 128, 192);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.11)';
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
  texture.flipY = false;
  texture.anisotropy = 4;
  return texture;
}

function makePetals(petal) {
  const geometry = petal.clone().rotateX(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    map: makePetalTexture(), side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, 68);
  mesh.frustumCulled = false;
  mesh.count = 1;
  return mesh;
}

export function createMeadowView(canvas, journey, mobile, reduced, art) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0xa4b2ab);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.07;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(fogColor, 0.0095);
  const camera = new THREE.PerspectiveCamera(53, 1, 0.065, 355);
  const clock = { value: 0 }, warmth = { value: 0 }, haze = { value: fogColor.clone() };
  const skyTint = { value: new THREE.Color() };
  const night = { value: 0 };
  const light = { value: new THREE.Vector3() };
  const air = { value: new THREE.Vector4() };
  const clouds = { value: new THREE.Vector4() };
  const skyUniforms = { estuaryPanorama: { value: art.panorama }, authoredSky: { value: 0 } };
  const wake = new MeadowWake();
  const wakeTexture = new THREE.DataTexture(wake.pixels, wake.size, wake.size);
  wakeTexture.minFilter = wakeTexture.magFilter = THREE.LinearFilter;
  wakeTexture.needsUpdate = true;
  const wakeUniforms = {
    wakeMap: { value: wakeTexture }, wakeBounds: { value: new THREE.Vector3(0, 0, wake.span) },
  };
  const pulse = { value: new THREE.Vector3(0, 0, -20) };
  let grass, weather, landscape, horizon;
  const scenery = new THREE.Group();
  const ambient = new THREE.HemisphereLight(0xe5f1ff, 0x6a6740, 1.75);
  const sunlight = new THREE.DirectionalLight(0xffe4ab, 2.15);
  Object.assign(sunlight.shadow.camera, { left: -52, right: 52, top: 62, bottom: -62, far: 175 });
  sunlight.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  sunlight.shadow.normalBias = .055;
  sunlight.shadow.bias = -.00015;
  const dot = softDot();
  const flowers = makeFlowers(journey.meadow.flowers.length, dot, art.petal);
  const petals = makePetals(art.petal);
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dot, color: 0xffecbf, opacity: 0.95, depthWrite: false, toneMapped: false,
  }));
  const ringGeometry = new THREE.TorusGeometry(1, 0.025, 8, 72);
  const rings = Array.from({ length: 2 }, () => new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
  })));
  const winds = new THREE.BufferGeometry();
  const windPoints = new Float32Array(108);
  winds.setAttribute('position', new THREE.BufferAttribute(windPoints, 3));
  const wisps = new THREE.Points(winds, new THREE.PointsMaterial({
    color: 0xf9eaca, size: 0.20, map: dot, transparent: true, opacity: 0.51, depthWrite: false, fog: true,
  }));
  wisps.frustumCulled = false;
  const sky = makeSky(clock, warmth, haze, skyTint, light, night, air, clouds, skyUniforms);
  scene.add(sky, scenery, flowers.group, petals, wisps, marker, ...rings, ambient, sunlight, sunlight.target);
  const gustMotes = reduced ? null : makeGustMotes(mobile, haze, night);
  if (gustMotes) scene.add(gustMotes.mesh);

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
    origin: new THREE.Vector3(),
  }));
  const pose = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, gust: 0, turn: 0 };
  const ribbonPoint = new THREE.Vector3();
  const tint = new THREE.Color();
  let lightStage = 0, lastWidth = 0, lastHeight = 0, baseFov = 51, reposition = true;

  function resize() {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height || (width === lastWidth && height === lastHeight)) return;
    lastWidth = width;
    lastHeight = height;
    const limit = mobile ? 1.22 : 1.55;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, limit, Math.sqrt(2200000 / (width * height))));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    baseFov = width < height ? 66 : 51;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }

  function drawFlowers(time, destination) {
    const { meadow, level } = journey;
    const highlights = flowers.glints.geometry.attributes.position;
    const { blossoms, hearts, stems } = flowers;
    for (let i = 0; i < meadow.flowers.length; i++) {
      const flower = meadow.flowers[i];
      const base = flightSurface(flower.x, flower.z, landscape);
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
      const guide = flower.glade === destination?.glade && !flower.bloomed;
      const glintY = level.night ? height + 0.06 : height + 0.27 + 0.08 * Math.sin(time * 1.8 + i);
      highlights.setXYZ(i, sx, level.night || guide ? glintY : -20, flower.z);
    }
    for (const mesh of [blossoms, hearts, stems]) mesh.instanceMatrix.needsUpdate = true;
    highlights.needsUpdate = true;
  }

  function drawFlight(flight, time, dt, total, destination, active) {
    const y = flightSurface(flight.x, flight.z, landscape) + flight.height;
    const forwardX = Math.sin(flight.heading), forwardZ = -Math.cos(flight.heading);
    const speed = gustStrength(flight.speed);
    if (active) {
      path.add(flight.x, y, flight.z, speed);
      if (wake.update(flight, y - terrain(flight.x, flight.z, landscape), time)) {
        wakeTexture.needsUpdate = true;
        wakeUniforms.wakeBounds.value.set(wake.x, wake.z, wake.span);
      }
    }
    const surge = clamp(flight.acceleration / 17, 0, 1);
    dummy.position.set(flight.x, y + Math.sin(time * 2.9) * 0.066, flight.z);
    dummy.rotation.set(-0.75 - speed * 0.23 + flight.rise * 0.35 + Math.sin(time * 3.25) * 0.28,
      flight.heading + Math.sin(time * 2.25) * 0.23, Math.cos(time * 2.02) * 0.53, 'YXZ');
    dummy.scale.set(0.21, 0.28, 0.22);
    dummy.updateMatrix();
    petals.setMatrixAt(0, dummy.matrix);
    petals.count = 1;

    const size = Math.min(67, total * 4);
    const ribbonLength = path.tip ? path.tip.distance - path.points.at(-1).distance : 0;
    for (let i = 1; i <= size; i++) {
      const petal = flutter[i];
      const individual = time * petal.rate * .79 + petal.phase;
      if (!path.sample(Math.min(i * .33, ribbonLength), pose)) break;
      // Each part of the ribbon inherits the gust that passed through it.
      const spacing = Math.min(ribbonLength, i * (.31 + pose.gust * .125) + Math.sin(individual * .47) * .063);
      path.sample(spacing, pose);
      const width = 1 - pose.gust * .48;
      const wave = time * 1.62 - spacing * 1.18;
      const spread = Math.min(.98, i * .048) * width;
      const spiral = time * .93 - spacing * .57 + petal.phase;
      const orbit = (.12 + spread * .64) * width;
      const bank = clamp(pose.turn * 2.9, -.83, .83);
      const side = spread * (Math.sin(wave) * .51 + Math.sin(individual) * .22 + petal.lean * .36 - bank * 1.12)
        + Math.cos(spiral) * orbit;
      const lift = spread * (Math.cos(wave * .91) * .29 + Math.cos(individual * 1.12) * .16)
        + Math.sin(spiral) * orbit * .54 + bank * side * .30;
      const rightX = Math.cos(pose.heading), rightZ = Math.sin(pose.heading);
      ribbonPoint.set(pose.x + rightX * side, pose.y + lift, pose.z + rightZ * side);
      const age = time - petal.born;
      const joining = age / (1.02 + petal.size * .35);
      driftFromBloom(petal.origin, ribbonPoint, joining, .60 + petal.size * .32, dummy.position);
      dummy.position.y = Math.max(dummy.position.y, flightSurface(dummy.position.x, dummy.position.z, landscape) + .14);
      dummy.rotation.set(-0.97 + pose.pitch * 0.53 + Math.sin(individual) * 0.53,
        pose.heading + petal.lean * 0.59 + Math.cos(wave + petal.phase) * 0.36,
        petal.lean + Math.cos(individual * .72) * .69 + Math.sin(spiral) * .65 + bank * .54, 'YXZ');
      const appear = clamp(age / .21, 0, 1);
      const near = THREE.MathUtils.smoothstep(dummy.position.distanceTo(eye), .9, 2.5);
      const scale = Math.max(0.072, 0.149 - i * 0.0010) * petal.size
        * appear * appear * (3 - 2 * appear) * near;
      dummy.scale.set(scale * 0.83, scale * 1.29, scale);
      dummy.updateMatrix();
      petals.setMatrixAt(i, dummy.matrix);
      petals.count++;
    }
    petals.instanceMatrix.needsUpdate = true;
    const wx = destination ? destination.x - flight.x : forwardX * 10;
    const wz = destination ? destination.z - flight.z : forwardZ * 10;
    const distance = Math.hypot(wx, wz) || 1;
    for (let i = 0; i < 36; i++) {
      const flow = ((time * 0.19 + i * 0.618) % 1) * (active ? Math.min(distance, 14) : 22) + 1.0;
      const lateral = Math.sin(i * 12.17 + time * 0.47) * (1.3 + flow * 0.15);
      const x = flight.x + wx / distance * flow + wz / distance * lateral;
      const z = flight.z + wz / distance * flow - wx / distance * lateral;
      windPoints[i * 3] = x;
      const low = flightSurface(x, z, landscape) + 1.05;
      const height = destination?.y === undefined ? low : THREE.MathUtils.lerp(y, destination.y, Math.min(1, flow / distance));
      windPoints[i * 3 + 1] = Math.max(low, height) + Math.sin(i * 3.8 + time * 1.18) * 0.44;
      windPoints[i * 3 + 2] = z;
    }
    winds.attributes.position.needsUpdate = true;

    if (active) {
      const overview = clamp((flight.height - 4) / 38, 0, 1);
      const motion = reduced ? 0 : speed;
      const trailing = (lastWidth < lastHeight ? 5.8 : 5.0) + overview * 2.65 + motion * 1.6;
      const cx = flight.x - forwardX * trailing;
      const cz = flight.z - forwardZ * trailing;
      const minHeight = flightSurface(cx, cz, landscape) + 1.95;
      const offsetY = 1.12 + overview * 2.35 - motion * 0.58 * (1 - overview);
      target.set(cx, Math.max(y + offsetY, minHeight), cz);
      eye.lerp(target, reposition ? 1 : 1 - Math.exp(-5.7 * dt));
      eye.y = Math.max(eye.y, flightSurface(eye.x, eye.z, landscape) + 1.60);
      const ahead = 12 + speed * 5;
      target.set(flight.x + forwardX * ahead, y - 0.24 - overview * 7.1 + flight.rise * 1.65,
        flight.z + forwardZ * ahead);
      look.lerp(target, reposition ? 1 : 1 - Math.exp(-(5.0 + motion * 1.2) * dt));
      const fov = smooth(camera.fov, baseFov + (reduced ? 0 : motion * 8.5 + surge * 3.2), dt, 5.6);
      if (Math.abs(fov - camera.fov) > 0.012) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      reposition = false;
    } else {
      const sway = reduced ? 0 : Math.sin(time * 0.19);
      const introX = flight.x + 5.5 + sway * 0.34 - forwardX * 3.2;
      const introZ = flight.z - forwardZ * 4.0;
      eye.set(introX, flightSurface(introX, introZ, landscape) + 4.0 + sway * 0.16, introZ);
      look.set(flight.x + forwardX * 26 + 3.4, y + 0.69, flight.z + forwardZ * 26);
    }
    camera.position.copy(eye);
    sky.position.copy(eye);
    horizon.position.set(eye.x, 0, eye.z);
    camera.lookAt(look);
    if (!reduced && active) camera.rotateZ(flight.steer * (-0.029 - speed * 0.058));
    gustMotes?.draw(eye, forwardX, forwardZ, active ? speed : 0, time, landscape);
  }

  function reset(nextJourney) {
    journey = nextJourney;
    path = new FlightPath();
    wake.reset();
    wakeTexture.needsUpdate = true;
    pulse.value.z = -20;
    lightStage = 0;
    reposition = true;
    const { level, meadow } = journey;
    if (landscape !== level.landscape) {
      const materials = new Set();
      for (const mesh of scenery.children) {
        mesh.geometry.dispose();
        materials.add(mesh.material);
        mesh.userData.depthTexture?.dispose();
        if (mesh.isInstancedMesh) mesh.dispose();
      }
      materials.forEach(material => material.dispose());
      scenery.clear();
      landscape = level.landscape;
      const authored = landscape.name === 'meadow';
      const [fog, cloud, sunlightStrength, wind] = landscape.atmosphere;
      scene.fog.density = fog;
      air.value.set(fog, cloud, sunlightStrength, wind);
      clouds.value.fromArray(landscape.clouds);
      skyUniforms.authoredSky.value = authored ? 1 : 0;
      grass = makeGrass(clock, warmth, haze, night, wakeUniforms, pulse, meadow.glades, mobile, landscape, air,
        authored ? art.grass : undefined);
      const { ground, horizon: plain } = makeGround(mobile, landscape, wakeUniforms, authored ? art.ground : undefined);
      horizon = plain ?? makeWater(clock, warmth, haze, light, night, air, landscape, skyUniforms);
      scenery.add(ground, horizon, ...grass.meshes,
        makeRocks(landscape, mobile), makeOutcrops(landscape));
      if (authored) {
        const landmarks = makeEstuaryLandmarks(art, clock, mobile);
        for (const landmark of landmarks) {
          landmark.castShadow = true;
          landmark.receiveShadow = true;
        }
        scenery.add(...landmarks);
      }
      weather = makeWeather(weatherByLandscape[landscape.name], landscape, dot, mobile, reduced);
      if (weather) scenery.add(weather.mesh);
    }
    grass.glow.value.fill(0);
    levelFog.setHex(level.haze);
    skyTint.value.setHex(level.sky);
    night.value = level.night ? 1 : 0;
    const authored = landscape.name === 'meadow';
    const sunHeight = landscape.name === 'dunes' ? .071 : authored ? .215 : .46;
    if (level.night) light.value.copy(moon);
    else light.value.set(landscape.name === 'dunes' ? -.37 : authored ? .48 : .45, sunHeight, -.86).normalize();
    sunlight.target.position.set(0, 0, authored ? -43 : 0);
    sunlight.position.copy(light.value).multiplyScalar(authored ? 67 : 56).add(sunlight.target.position);
    sunlight.castShadow = authored;
    renderer.shadowMap.needsUpdate = authored;
    renderer.toneMappingExposure = authored ? 1.04 : 1.07;
    sunlight.color.setHex(level.light);
    ambient.color.setHex(level.night ? 0xa6caff : 0xe5f1ff);
    ambient.groundColor.setHex(level.night ? 0x2a384b : landscape.soil[0]);
    ambient.intensity = level.night ? .78 : authored ? 1.06 : 1.75;
    flowers.blossoms.material.emissive.setHex(level.night ? 0x275eff : 0x888888);
    flowers.blossoms.material.emissiveIntensity = level.night ? 0.58 : 0.075;
    flowers.hearts.material.color.setHex(level.night ? 0x8ad9ff : 0xd3a85b);
    flowers.hearts.material.emissive.setHex(level.night ? 0x409bff : 0xaa7344);
    flowers.hearts.material.emissiveIntensity = level.night ? 0.72 : 0.31;
    flowers.glints.material.color.setHex(level.night ? 0x438aff : 0xffecbf);
    flowers.glints.material.size = level.night ? 1.18 : 0.86;
    flowers.glints.material.blending = level.night ? THREE.AdditiveBlending : THREE.NormalBlending;
    flowers.glints.material.toneMapped = !level.night;
    flowers.glints.material.needsUpdate = true;
    wisps.material.color.setHex(level.night ? 0x9bd7ff : 0xf9eaca);
    petals.setColorAt(0, tint.setHex(level.night ? 0x9edcff : 0xffedd4));
    petals.instanceColor.needsUpdate = true;
    flowers.recolor(meadow.flowers);
    const patches = grass.material.uniforms.patches.value;
    meadow.glades.forEach((glade, i) => patches[i].set(glade.x, glade.z));
    rings.forEach(mesh => {
      mesh.visible = false;
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
      haze.value.copy(levelFog).lerp(warmFog, lightStage * landscape.atmosphere[4]);
      scene.fog.color.copy(haze.value);
      sunlight.intensity = night.value ? .68
        : .52 + air.value.z * ((skyUniforms.authoredSky.value > .5 ? 2.03 : 1.55) + lightStage * .42);
      for (let i = 0; i < meadow.glades.length; i++) {
        const glade = meadow.glades[i];
        glade.glow = smooth(glade.glow, glade.lit ? 1 : 0, dt, 0.76);
        grass.glow.value[i] = glade.glow;
      }
      marker.visible = active && destination?.glade !== undefined;
      if (marker.visible) {
        marker.position.set(destination.x, flightSurface(destination.x, destination.z, landscape) + 1.55, destination.z);
        marker.scale.setScalar(1.3 + (reduced ? 0 : Math.sin(time * 2.1) * 0.14));
        marker.material.color.setHex(destination.color);
      }
      const leg = currentLeg(journey);
      rings.forEach((mesh, i) => {
        const ring = active && leg?.rings[leg.passed + i];
        mesh.visible = Boolean(ring);
        if (!ring) return;
        mesh.position.set(ring.x, ring.y, ring.z);
        mesh.scale.setScalar(ring.radius);
        mesh.rotation.y = ring.heading;
        mesh.material.opacity = i === 0 ? 0.86 : 0.24;
      });
      drawFlowers(time, destination);
      drawFlight(flight, time, dt, total, destination, active);
      if (skyUniforms.authoredSky.value > .5) {
        for (const mesh of grass.meshes) {
          const { center, radius } = mesh.geometry.boundingSphere;
          mesh.visible = Math.hypot(center.x - eye.x, center.z - eye.z) < grass.range + radius;
        }
      }
      weather?.draw(camera, time);
      renderer.render(scene, camera);
    },
    bloom(total, flower, time) {
      pulse.value.set(flower.x, flower.z, time);
      const first = (total - 1) * 4;
      tint.setHex(flower.color);
      for (let part = 0; part < 4; part++) {
        const i = 1 + (first + part) % (flutter.length - 1);
        const petal = flutter[i];
        petal.born = time + part * .045;
        petal.origin.set(flower.x + Math.cos(petal.phase) * .11,
          flower.y ?? flightSurface(flower.x, flower.z, landscape) + .80,
          flower.z + Math.sin(petal.phase) * .11);
        petals.setColorAt(i, tint);
      }
      petals.instanceColor.needsUpdate = true;
    },
    reset,
  };
}
