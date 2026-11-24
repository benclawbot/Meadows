import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { clamp } from './flight.js';
import { terrain, waterHeight } from './landscape.js';

export function makeWater(span, clock, haze, light, night, air, landscape, art, mobile) {
  const [deep, shallows] = landscape.water.map(hex => new THREE.Color(hex));
  const width = 384, height = 416;
  const area = new THREE.Vector4(-106, -172, 212, 214);
  const bed = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const z = area.y + (row + .5) * area.w / height;
    for (let col = 0; col < width; col++) {
      const x = area.x + (col + .5) * area.z / width;
      bed[row * width + col] = Math.round(clamp((waterHeight - terrain(x, z, landscape)) / 3.1, 0, 1) * 255);
    }
  }
  const relief = new THREE.DataTexture(bed, width, height, THREE.RedFormat);
  relief.minFilter = relief.magFilter = THREE.LinearFilter;
  relief.needsUpdate = true;
  const water = new Reflector(new THREE.PlaneGeometry(span, span), {
    textureWidth: mobile ? 320 : 608, textureHeight: mobile ? 260 : 416, multisample: 0, clipBias: .0005,
    shader: {
      name: 'Tidewater',
      uniforms: Reflector.ReflectorShader.uniforms,
      vertexShader: `
        uniform mat4 textureMatrix;
        varying vec4 mirrorUV;
        varying vec3 world;
        void main() {
          vec4 point = vec4(position, 1.);
          world = (modelMatrix * point).xyz;
          mirrorUV = textureMatrix * point;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
        }
      `,
      fragmentShader: `
        uniform float clock, night;
        uniform vec3 deep, shallows, haze, light;
        uniform vec4 air, bedArea;
        uniform sampler2D tDiffuse, depthMap, waves, stones, sand;
        varying vec4 mirrorUV;
        varying vec3 world;

        void main() {
          vec2 p = world.xz;
          vec3 eye = normalize(cameraPosition-world);
          vec2 bedUV = (p-bedArea.xy)/bedArea.zw;
          vec2 margin = min(bedUV,1.-bedUV);
          float depth = mix(1.,texture2D(depthMap,bedUV).r,smoothstep(0.,.027,min(margin.x,margin.y)));
          float meters = depth*3.1;
          float flow = clock*(.62+air.w*.45);
          mat2 turn = mat2(.76,.65,-.65,.76);
          vec2 swell = texture2D(waves,p*.053 + vec2(.008,-.013)*flow).rg*2.-1.;
          vec2 wind = texture2D(waves,turn*p*.197 + swell*.19 + vec2(.47,.23)-vec2(.013,.021)*flow).rg*2.-1.;
          vec2 chop = texture2D(waves,transpose(turn)*p*.638 + wind*.12 + vec2(.29,.84)+vec2(.018,-.024)*flow).rg*2.-1.;
          vec2 slope = swell*.47 + transpose(turn)*wind*.37 + turn*chop*.27;
          slope *= (.63+air.w*.57)*mix(.48,1.,smoothstep(.03,.34,meters));
          vec3 n = normalize(vec3(slope.x,1.,slope.y));
          float facing = clamp(dot(eye,n),0.,1.);
          float fresnel = .021 + .87*pow(1.-facing,5.);

          vec2 through = p + slope * min(1.2, meters*.53);
          vec3 gravel = texture2D(stones,through*.62).rgb;
          vec3 sediment = texture2D(sand,turn*through*.49).rgb;
          float grain = texture2D(waves,p*.11).r;
          vec3 bottom = mix(sediment,gravel,smoothstep(.30,.64,grain)) * mix(1.23,.20,night);
          float caustic = max(0.,.90-length(wind+chop)*4.9);
          bottom *= .79+caustic*.58*air.z;
          vec3 absorb = exp(-meters*(1.09+.46*(1.-facing))*vec3(2.9,1.29,1.03));
          vec3 transmitted = mix(mix(shallows*.68,deep,smoothstep(.21,2.25,meters)),bottom,absorb);

          vec2 projected = mirrorUV.xy/mirrorUV.w;
          vec2 distortion = vec2(slope.x,-slope.y)*(.019+.054*(1.-facing));
          vec3 mirror = texture2D(tDiffuse,clamp(projected+distortion,.003,.997)).rgb;
          vec3 color = mix(transmitted,mirror,fresnel);
          float sunRay = max(dot(reflect(-light,n),eye),0.);
          float sun = pow(sunRay,175.)*.46 + pow(sunRay,61.)*.045;
          color += mix(vec3(1.,.76,.42),vec3(.34,.53,.9),night)*sun*(.55+.45*grain);
          float d = length(cameraPosition-world);
          color = mix(color,haze,1.-exp(-d*d*air.x*air.x));
          gl_FragColor = vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    },
  });
  Object.assign(water.material.uniforms, {
    clock, haze, light, night, air, deep: { value: deep }, shallows: { value: shallows },
    bedArea: { value: area }, depthMap: { value: relief }, waves: { value: art.ripples },
    stones: { value: art.pebbles }, sand: { value: art.sand },
  });
  if (mobile) water.getRenderTarget().texture.type = THREE.UnsignedByteType;
  water.rotation.x = -Math.PI / 2;
  water.position.y = waterHeight;
  water.userData.depthTexture = relief;
  return water;
}
