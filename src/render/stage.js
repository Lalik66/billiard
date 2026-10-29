// Renderer, scene, post-processing (bloom + vignette), quality presets, venue loading.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildTable, disposeGroup } from './table.js';
import { venueById, envScene } from './venues.js';
import { BallSet } from './balls.js';
import { Cue } from './cue.js';
import { Guide } from './guide.js';
import { CameraRig } from './camera.js';

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.32 }, grain: { value: 0.018 }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; uniform float grain; uniform float time; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv-0.5; float v = 1.0 - dot(d,d)*strength*2.6;
      c.rgb *= clamp(v, 0.0, 1.0); c.rgb += (rnd(vUv*731.0)-0.5)*grain; gl_FragColor = c; }`,
};

export class Stage {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    // Allow the browser to restore the GL context after a loss (GPU reset, tab
    // backgrounding); without preventDefault the context stays lost forever.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000');
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.03, 200);
    this.rig = new CameraRig(this.camera);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.balls = new BallSet(this.scene);
    this.cue = new Cue(this.scene);
    this.guide = new Guide(this.scene);
    this.overlay = new THREE.Group(); // markers (pocket call, ball in hand, zones)
    this.scene.add(this.overlay);
    this.quality = 'high';
    this.venue = null;
    this.venueObj = null;
    this.tableObj = null;
    this.time = 0;
    this.composer = null;
    this.fps = 60;
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    if (window.ResizeObserver) new ResizeObserver(this._resize).observe(container);
    this.setQuality('high');
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const pr = q === 'low' ? Math.min(dpr, 1) : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.balls.setShadowOpacity(q === 'low' ? 1 : 0.6);
    this.buildComposer();
    if (this.venue) this.setVenue(this.venue.id, true);
    this.resize();
  }

  buildComposer() {
    if (this.composer) {
      // EffectComposer.dispose() only frees its own render targets and copyPass,
      // not the passes we added, so dispose those explicitly to avoid leaking the
      // bloom pass's render targets (11 HalfFloat RTs) on every quality change.
      this.renderPass?.dispose?.();
      this.bloom?.dispose?.();
      this.outputPass?.dispose?.();
      this.vignette?.dispose?.();
      this.composer.dispose?.();
      this.composer = this.renderPass = this.bloom = this.outputPass = this.vignette = null;
    }
    if (this.quality === 'low') return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.quality === 'high' ? 4 : 2 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    const bloomScale = this.quality === 'high' ? 0.5 : 0.35;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bloomScale, size.y * bloomScale), 0.32, 0.4, 0.97);
    this.composer.addPass(this.bloom);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);
  }

  setVenue(id, force = false) {
    const v = venueById(id);
    if (!force && this.venue && this.venue.id === v.id) return;
    if (this.venueObj) {
      this.scene.remove(this.venueObj.group);
      disposeGroup(this.venueObj.group);
    }
    if (this.tableObj) {
      this.scene.remove(this.tableObj.group);
      this.tableObj.dispose();
    }
    this.venue = v;
    this.tableObj = buildTable(v.table);
    this.scene.add(this.tableObj.group);
    this.venueObj = v.build({ quality: this.quality });
    this.scene.add(this.venueObj.group);
    // reflections
    if (this.envRT) this.envRT.dispose();
    // envScene() builds a throwaway scene; fromScene() does not dispose it, so
    // free its geometries/materials after baking the environment map.
    const es = envScene(v);
    this.envRT = this.pmrem.fromScene(es, 0.03);
    disposeGroup(es);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = v.env.intensity;
    this.balls.setEnvIntensity(1.6);
    this.renderer.toneMappingExposure = v.exposure;
    if (this.quality === 'low') {
      for (const l of this.venueObj.lights) l.castShadow = false;
    }
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.2 ? 60 : 45;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  update(dt) {
    this.time += dt;
    // fade hanging lamps etc. when the camera rises above them
    if (this.venueObj && this.venueObj.occluders) {
      const camY = this.camera.position.y;
      for (const o of this.venueObj.occluders) {
        const wp = o.getWorldPosition(this._tmpV || (this._tmpV = new THREE.Vector3()));
        let low = Infinity;
        o.traverse((c) => {
          if (c.isMesh) low = Math.min(low, c.getWorldPosition(this._tmpV2 || (this._tmpV2 = new THREE.Vector3())).y);
        });
        const target = camY > low - 0.08 ? 0 : 1;
        o.userData.fade = o.userData.fade ?? 1;
        o.userData.fade += (target - o.userData.fade) * Math.min(1, dt * 6);
        const f = o.userData.fade;
        o.traverse((c) => {
          if (c.isMesh && c.material) {
            c.material.opacity = f;
            c.visible = f > 0.02;
          }
        });
        void wp;
      }
    }
    if (this.venueObj) {
      this.venueObj.update(this.time, dt);
      if (this.venueObj.glowUpdate && this.tableObj.glowMats.length) this.venueObj.glowUpdate(this.tableObj.glowMats, this.time);
    }
  }

  render() {
    if (this.composer) {
      this.vignette.uniforms.time.value = this.time % 10;
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
  }
}
