import * as THREE from "three";
import { TABLE, type MatchState, type PlayerSettings, type Side, type SimEvent } from "@contracts/sim";
import { getSpinVisualProfile } from "./trajectory";

interface Avatar {
  group: THREE.Group;
  kit: THREE.MeshStandardMaterial;
  upperArm: THREE.Mesh;
  forearm: THREE.Mesh;
  elbow: THREE.Mesh;
  legs: [THREE.Mesh, THREE.Mesh];
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
  private ball: THREE.Mesh;
  private ballMaterial: THREE.MeshStandardMaterial;
  private spinRing: THREE.Mesh;
  private spinRingMaterial: THREE.MeshBasicMaterial;
  private paddles: [THREE.Group, THREE.Group];
  private paddleMaterials: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  private avatars: [Avatar, Avatar];
  private trail: THREE.Line;
  private trailPositions = new Float32Array(24 * 3);
  private particles: Particle[] = [];
  private judgeArm: THREE.Mesh;
  private judgeGesture = 0;
  private ownSide: Side = 0;
  private cameraTarget = new THREE.Vector3(0, 0.86, 0);
  private tempA = new THREE.Vector3();
  private tempB = new THREE.Vector3();
  private tempC = new THREE.Vector3();
  private tempDir = new THREE.Vector3();
  private pointerRaycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private pointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.48);
  private pointerPoint = new THREE.Vector3();
  private elapsed = 0;
  private titleMode = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;
    this.scene.background = new THREE.Color("#07151d");
    this.scene.fog = new THREE.Fog("#07151d", 8, 24);
    this.buildArena();
    this.buildTable();
    this.avatars = [this.createAvatar(0), this.createAvatar(1)];
    this.paddles = [this.createPaddle(0), this.createPaddle(1)];
    this.paddleMaterials = [
      this.paddles[0].userData.material as THREE.MeshStandardMaterial,
      this.paddles[1].userData.material as THREE.MeshStandardMaterial,
    ];
    this.ballMaterial = new THREE.MeshStandardMaterial({ color: "#f7fbff", roughness: 0.72, emissive: "#ffffff", emissiveIntensity: 0.11 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(TABLE.ballRadius, 24, 16), this.ballMaterial);
    // A modest visual-only scale makes the ball readable without changing collision physics.
    this.ball.scale.setScalar(1.24);
    this.ball.castShadow = true;
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE.ballRadius * 0.965, 0.00035, 6, 48),
      new THREE.MeshStandardMaterial({ color: "#d7dce0", roughness: 0.62, metalness: 0.02 }),
    );
    seam.rotation.x = Math.PI / 2;
    this.ball.add(seam);
    this.scene.add(this.ball);
    this.spinRingMaterial = new THREE.MeshBasicMaterial({
      color: "#ffb45e",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.spinRing = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE.ballRadius * 1.58, TABLE.ballRadius * 0.075, 6, 40),
      this.spinRingMaterial,
    );
    this.spinRing.visible = false;
    this.scene.add(this.spinRing);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: "#b8fff1", transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    this.createParticles();
    this.judgeArm = this.buildUmpire();
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  private buildArena(): void {
    const hemisphere = new THREE.HemisphereLight("#b8e9ef", "#071015", 1.35);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight("#fff1d6", 3.2);
    key.position.set(-3, 6, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    const rim = new THREE.SpotLight("#31d6c4", 45, 14, Math.PI / 5, 0.7, 1.4);
    rim.position.set(3.5, 4.5, -3);
    rim.target.position.set(0, 0.7, 0);
    this.scene.add(rim, rim.target);
    const warm = new THREE.SpotLight("#ffbd6e", 35, 12, Math.PI / 5, 0.8, 1.5);
    warm.position.set(-3.5, 4, 3);
    warm.target.position.set(0, 0.7, 0);
    this.scene.add(warm, warm.target);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: "#0b2930", roughness: 0.88, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 7.4), new THREE.MeshStandardMaterial({ color: "#103b41", roughness: 0.8 }));
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.004;
    court.receiveShadow = true;
    this.scene.add(court);
    const lineMat = new THREE.MeshBasicMaterial({ color: "#2f6969", transparent: true, opacity: 0.65 });
    for (const x of [-2.55, 2.55]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 7.2), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.008, 0);
      this.scene.add(line);
    }
    for (const z of [-3.55, 3.55]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 0.025), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.008, z);
      this.scene.add(line);
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: "#1c5257", transparent: true, opacity: 0.32, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(4.6 + i * 1.1, 4.62 + i * 1.1, 64), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.006;
      this.scene.add(ring);
    }
    const lightMat = new THREE.MeshBasicMaterial({ color: "#d9fff6" });
    for (const x of [-2.2, 2.2]) {
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.045, 0.26), lightMat);
      fixture.position.set(x, 4.2, 0);
      this.scene.add(fixture);
    }
  }

  private buildTable(): void {
    const topMat = new THREE.MeshStandardMaterial({ color: "#145979", roughness: 0.76, metalness: 0.01 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: "#d8e4e8", roughness: 0.45 });
    const frameMat = new THREE.MeshStandardMaterial({ color: "#17252c", roughness: 0.35, metalness: 0.65 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.width, 0.055, TABLE.length), topMat);
    top.position.y = TABLE.y - 0.0275;
    top.castShadow = true;
    top.receiveShadow = true;
    this.scene.add(top);
    const lineY = TABLE.y + 0.002;
    const addLine = (w: number, d: number, x: number, z: number) => {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.003, d), edgeMat);
      line.position.set(x, lineY, z);
      this.scene.add(line);
    };
    addLine(TABLE.width, 0.018, 0, TABLE.length / 2 - 0.009);
    addLine(TABLE.width, 0.018, 0, -TABLE.length / 2 + 0.009);
    addLine(0.018, TABLE.length, TABLE.width / 2 - 0.009, 0);
    addLine(0.018, TABLE.length, -TABLE.width / 2 + 0.009, 0);
    addLine(0.008, TABLE.length, 0, 0);
    for (const x of [-0.58, 0.58]) {
      for (const z of [-1.03, 1.03]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.7, 10), frameMat);
        leg.position.set(x, 0.35, z);
        leg.castShadow = true;
        this.scene.add(leg);
      }
    }
    for (const z of [-1.03, 1.03]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.045, 0.045), frameMat);
      brace.position.set(0, 0.34, z);
      this.scene.add(brace);
    }
    const netCanvas = document.createElement("canvas");
    netCanvas.width = 256;
    netCanvas.height = 64;
    const ctx = netCanvas.getContext("2d")!;
    ctx.strokeStyle = "rgba(235,248,250,.82)";
    ctx.lineWidth = 2;
    for (let x = 0; x <= 256; x += 12) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke(); }
    for (let y = 0; y <= 64; y += 10) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
    const texture = new THREE.CanvasTexture(netCanvas);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(1.83, TABLE.netHeight), new THREE.MeshStandardMaterial({ map: texture, transparent: true, opacity: 0.76, side: THREE.DoubleSide, roughness: 0.7 }));
    net.position.set(0, TABLE.y + TABLE.netHeight / 2, 0);
    this.scene.add(net);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.012, 0.012), edgeMat);
    tape.position.set(0, TABLE.y + TABLE.netHeight, 0);
    this.scene.add(tape);
    for (const x of [-0.88, 0.88]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.23, 12), frameMat);
      post.position.set(x, TABLE.y + 0.075, 0);
      this.scene.add(post);
    }
  }

  private createAvatar(side: Side): Avatar {
    const sign = side === 0 ? 1 : -1;
    const group = new THREE.Group();
    group.position.set(0, 0, sign * 1.96);
    const kit = new THREE.MeshStandardMaterial({ color: side === 0 ? "#27d3a2" : "#ef6a67", roughness: 0.75 });
    const skin = new THREE.MeshStandardMaterial({ color: side === 0 ? "#d9a37d" : "#b97955", roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: "#10232b", roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.36, 5, 10), kit);
    torso.position.y = 1.15;
    torso.scale.set(1.15, 1, 0.72);
    torso.castShadow = true;
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 12), skin);
    head.position.y = 1.62;
    head.castShadow = true;
    group.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.128, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.48), dark);
    hair.position.y = 1.635;
    group.add(hair);
    const createLeg = (index: number): THREE.Mesh => {
      const x = index === 0 ? -0.11 : 0.11;
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.42, 4, 8), dark);
      leg.position.set(x, 0.55, 0);
      leg.rotation.z = x * 0.35;
      leg.castShadow = true;
      group.add(leg);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.26), dark);
      shoe.position.set(x, 0.19, -sign * 0.05);
      shoe.castShadow = true;
      group.add(shoe);
      return leg;
    };
    const legs: [THREE.Mesh, THREE.Mesh] = [createLeg(0), createLeg(1)];
    this.scene.add(group);
    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.052, 1, 10), skin);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 1, 10), skin);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), skin);
    upperArm.castShadow = forearm.castShadow = elbow.castShadow = true;
    this.scene.add(upperArm, forearm, elbow);
    return { group, kit, upperArm, forearm, elbow, legs };
  }

  private createPaddle(side: Side): THREE.Group {
    const group = new THREE.Group();
    const rubber = new THREE.MeshStandardMaterial({ color: side === 0 ? "#ef476f" : "#222b35", roughness: 0.88 });
    const reverseRubber = new THREE.MeshStandardMaterial({ color: side === 0 ? "#20262d" : "#ef476f", roughness: 0.88 });
    const bladeSide = new THREE.MeshStandardMaterial({ color: "#a86d40", roughness: 0.78 });
    const wood = new THREE.MeshStandardMaterial({ color: "#b98250", roughness: 0.72 });
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.018, 32), [bladeSide, rubber, reverseRubber]);
    blade.rotation.x = Math.PI / 2;
    blade.scale.y = 1.08;
    blade.castShadow = true;
    group.add(blade);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.19, 0.035), wood);
    handle.castShadow = true;
    handle.position.y = -0.18;
    handle.rotation.z = side === 0 ? -0.08 : 0.08;
    group.add(handle);
    group.userData.material = rubber;
    this.scene.add(group);
    return group;
  }

  private buildUmpire(): THREE.Mesh {
    const group = new THREE.Group();
    group.position.set(-1.25, 0, 0);
    const uniform = new THREE.MeshStandardMaterial({ color: "#d5e6e8", roughness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: "#15242c", roughness: 0.65 });
    const skin = new THREE.MeshStandardMaterial({ color: "#c88e67", roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.28, 4, 8), uniform);
    body.position.y = 1.0;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10), skin);
    head.position.y = 1.4;
    group.add(head);
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.4), dark);
    chair.position.y = 0.72;
    group.add(chair);
    for (const x of [-0.16, 0.16]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8), dark);
      leg.position.set(x, 0.36, 0);
      group.add(leg);
    }
    this.scene.add(group);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.48, 8), skin);
    arm.position.set(-1.05, 1.06, 0);
    arm.rotation.z = -0.75;
    this.scene.add(arm);
    return arm;
  }

  private createParticles(): void {
    const geometry = new THREE.SphereGeometry(0.009, 5, 4);
    const material = new THREE.MeshBasicMaterial({ color: "#c9fff0", transparent: true, opacity: 0.8 });
    for (let i = 0; i < 28; i += 1) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.particles.push({ mesh, velocity: new THREE.Vector3(), life: 0 });
    }
  }

  handleEvent(event: SimEvent, eventId: number): void {
    if (!event.p) return;
    if (event.type === "point" || event.type === "game") this.judgeGesture = 1;
    if (!["hit", "bounce", "net", "serve"].includes(event.type)) return;
    for (let i = 0; i < 8; i += 1) {
      const particle = this.particles[(eventId * 8 + i) % this.particles.length];
      const angle = i * Math.PI * 0.25 + eventId * 0.73;
      particle.mesh.position.set(event.p.x, event.p.y, event.p.z);
      particle.velocity.set(Math.cos(angle) * 0.28, 0.18 + (i % 3) * 0.09, Math.sin(angle) * 0.28);
      particle.life = 0.32;
      particle.mesh.visible = true;
    }
  }

  setTitleMode(value: boolean): void {
    this.titleMode = value;
  }

  update(state: MatchState, ownSide: Side, settings: [PlayerSettings, PlayerSettings], dt: number, networked = false): void {
    this.elapsed += dt;
    this.ownSide = ownSide;
    this.tempA.set(state.ball.p.x, state.ball.p.y, state.ball.p.z);
    this.ball.position.copy(this.tempA);
    this.ball.rotation.x += state.ball.spin.x * dt;
    this.ball.rotation.y += state.ball.spin.y * dt;
    this.ball.rotation.z += state.ball.spin.z * dt;
    const spinVisual = getSpinVisualProfile(state.ball.spin);
    this.spinRing.position.copy(this.ball.position);
    this.spinRing.visible = state.phase === "rally" && spinVisual.strength > 0.045;
    this.spinRingMaterial.color.set(spinVisual.color);
    this.spinRingMaterial.opacity = spinVisual.strength * 0.52;
    const ringScale = 0.82 + spinVisual.strength * 0.72;
    this.spinRing.scale.setScalar(ringScale);
    if (this.spinRing.visible) {
      this.tempDir.set(state.ball.spin.x, state.ball.spin.y, state.ball.spin.z).normalize();
      this.spinRing.quaternion.setFromUnitVectors(Y_AXIS, this.tempDir);
      this.spinRing.rotateY(dt * (2.2 + spinVisual.strength * 5));
    }
    this.ballMaterial.emissiveIntensity = 0.11 + spinVisual.strength * 0.58;
    this.ballMaterial.color.set(settings[0].ball);
    this.ballMaterial.emissive.set(settings[0].ball);
    for (let side = 0 as Side; side <= 1; side = (side + 1) as Side) {
      const paddle = state.paddles[side];
      const group = this.paddles[side];
      this.tempB.set(paddle.x, paddle.y, paddle.z);
      if (networked && side === this.ownSide) group.position.lerp(this.tempB, Math.min(1, dt * 26));
      else group.position.copy(this.tempB);
      group.rotation.set((side === 0 ? -1 : 1) * paddle.vy * 0.20, (side === 0 ? -1 : 1) * paddle.vx * 0.08 + (side === 0 ? 0 : Math.PI), 0);
      this.paddleMaterials[side].color.set(settings[side].paddle);
      const avatar = this.avatars[side];
      avatar.kit.color.set(settings[side].kit);
      const sign = side === 0 ? 1 : -1;
      const bodyOffset = side === this.ownSide ? (this.ownSide === 0 ? -0.42 : 0.42) : 0;
      const moveBlend = 1 - Math.exp(-dt * 8.5);
      const bodyX = paddle.x * 0.68 + bodyOffset;
      const bodyZ = sign * (Math.abs(paddle.z) + 0.32);
      const avatarScale = side === this.ownSide ? 0.64 : 0.82;
      avatar.group.scale.setScalar(avatarScale);
      avatar.group.position.x += (bodyX - avatar.group.position.x) * moveBlend;
      avatar.group.position.z += (bodyZ - avatar.group.position.z) * moveBlend;
      avatar.group.rotation.z = -paddle.vx * 0.014;
      avatar.group.rotation.x = -paddle.vz * 0.012;
      const moveSpeed = Math.hypot(paddle.vx, paddle.vz);
      const footwork = Math.min(0.42, moveSpeed * 0.045);
      const gait = this.elapsed * (5 + Math.min(10, moveSpeed * 1.2));
      avatar.legs[0].rotation.z = -0.035 - paddle.vx * 0.012 - footwork * Math.sin(gait);
      avatar.legs[1].rotation.z = 0.035 - paddle.vx * 0.012 + footwork * Math.sin(gait);
      // Limbs are world-space meshes. Transform the shoulder from avatar-local
      // space so scale, body lean and lateral movement stay in sync.
      avatar.group.localToWorld(this.tempA.set(side === 0 ? 0.2 : -0.2, 1.38, sign * 0.07));
      this.tempB.set(paddle.x, paddle.y - 0.08, paddle.z);
      this.tempC.copy(this.tempA).lerp(this.tempB, 0.52);
      this.tempC.y -= 0.055;
      this.positionLimb(avatar.upperArm, this.tempA, this.tempC);
      this.positionLimb(avatar.forearm, this.tempC, this.tempB);
      avatar.elbow.position.copy(this.tempC);
    }
    for (let i = 23; i > 0; i -= 1) {
      this.trailPositions[i * 3] = this.trailPositions[(i - 1) * 3];
      this.trailPositions[i * 3 + 1] = this.trailPositions[(i - 1) * 3 + 1];
      this.trailPositions[i * 3 + 2] = this.trailPositions[(i - 1) * 3 + 2];
    }
    this.trailPositions[0] = state.ball.p.x;
    this.trailPositions[1] = state.ball.p.y;
    this.trailPositions[2] = state.ball.p.z;
    const trailMaterial = this.trail.material as THREE.LineBasicMaterial;
    trailMaterial.color.set(spinVisual.strength > 0.06 ? spinVisual.color : "#b8fff1");
    trailMaterial.opacity = 0.24 + Math.min(1, Math.hypot(state.ball.v.x, state.ball.v.y, state.ball.v.z) / 9) * 0.26;
    (this.trail.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    this.trail.visible = state.phase === "rally";
    for (const particle of this.particles) {
      if (particle.life <= 0) continue;
      particle.life -= dt;
      particle.velocity.y -= dt * 1.4;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.visible = particle.life > 0;
    }
    this.judgeGesture = Math.max(0, this.judgeGesture - dt * 0.8);
    this.judgeArm.rotation.z = -0.75 - Math.sin(this.judgeGesture * Math.PI) * 1.25;
    this.updateCamera(dt);
  }

  updateIdle(dt: number): void {
    this.elapsed += dt;
    const t = this.elapsed;
    this.ball.position.set(Math.sin(t * 0.8) * 0.5, 1.02 + Math.abs(Math.sin(t * 1.6)) * 0.45, Math.cos(t * 0.8) * 0.85);
    this.trail.visible = false;
    for (let side = 0 as Side; side <= 1; side = (side + 1) as Side) {
      const sign = side === 0 ? 1 : -1;
      this.paddles[side].position.set(Math.sin(t + side * 2) * 0.25, 1.15, sign * 1.4);
      this.avatars[side].group.rotation.y = Math.sin(t * 0.4 + side) * 0.08;
    }
    this.camera.position.set(3.25 + Math.sin(t * 0.18) * 0.35, 2.65, 3.55 + Math.cos(t * 0.18) * 0.25);
    this.camera.lookAt(0, 0.85, 0);
  }

  private positionLimb(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
    this.tempDir.subVectors(end, start);
    const length = this.tempDir.length();
    mesh.position.copy(start).addScaledVector(this.tempDir, 0.5);
    mesh.scale.set(1, length, 1);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, this.tempDir.normalize());
  }

  /** Convert viewport pointer coordinates into the racket plane in world space. */
  pointerToRacket(pointerX: number, pointerY: number, side: Side): { x: number; y: number } | null {
    this.pointerNdc.set(pointerX, pointerY);
    const sign = side === 0 ? 1 : -1;
    this.pointerPlane.constant = -sign * 1.48;
    this.pointerRaycaster.setFromCamera(this.pointerNdc, this.camera);
    if (!this.pointerRaycaster.ray.intersectPlane(this.pointerPlane, this.pointerPoint)) return null;
    return {
      x: THREE.MathUtils.clamp(this.pointerPoint.x, -0.98, 0.98),
      y: THREE.MathUtils.clamp(this.pointerPoint.y, 0.84, 1.7),
    };
  }

  private updateCamera(dt: number): void {
    if (this.titleMode) return;
    const sign = this.ownSide === 0 ? 1 : -1;
    const mobile = window.innerWidth < 700;
    this.tempA.set(0, mobile ? 2.7 : 2.72, sign * (mobile ? 4.55 : 4.45));
    this.camera.position.lerp(this.tempA, Math.min(1, dt * 5));
    this.cameraTarget.set(0, 0.92, -sign * 0.06);
    this.camera.lookAt(this.cameraTarget);
  }

  resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.fov = width < 700 ? 58 : 50;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 700 ? 1.35 : 1.75));
    this.renderer.setSize(width, height, false);
  };

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  getStats(): { calls: number; triangles: number } {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    const disposedTextures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
              disposedTextures.add(value);
              value.dispose();
            }
          }
          material.dispose();
        }
      }
    });
    this.renderer.dispose();
  }
}
