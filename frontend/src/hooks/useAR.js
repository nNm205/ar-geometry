import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { makeGeo, makeMaterial, makeEdges } from "../utils/geometry";
import { buildCustomGeometry } from "../utils/buildCustomGeometry";

import { useHandTracking } from "./useHandTracking";
import { getDistance } from "../utils/gestures";
import useViewerStore from "../store/useViewerStore";

// ── Phát hiện cử chỉ chụm ngón (Pinch) ──────────────────────────────────────
// Ngưỡng 0.08: đủ nhạy khi tay gần cam, không nhận nhầm tay mở bình thường
function isPinching(hand) {
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  return Math.sqrt(dx * dx + dy * dy) < 0.095;
}

// ── Phát hiện lòng bàn tay mở (Open Palm) ───────────────────────────────────
// Yêu cầu: KHÔNG đang pinch VÀ ít nhất 3 ngón tay duỗi thẳng
function isOpenPalm(hand) {
  if (isPinching(hand)) return false;
  // Ngón trỏ, giữa, áp út duỗi: tip.y < pip.y (trục Y của Mediapipe: 0=trên, 1=dưới)
  const indexExtended  = hand[8].y  < hand[6].y;
  const middleExtended = hand[12].y < hand[10].y;
  const ringExtended   = hand[16].y < hand[14].y;
  return indexExtended && middleExtended && ringExtended;
}

export function useAR(
  canvasRef,
  shape,
  { size, opacity, wireframe, autoRotate, showConstraints = true },
  geometryData = null,
) {
  const sceneRef       = useRef(null);
  const cameraRef      = useRef(null);
  const rendererRef    = useRef(null);
  const meshRef        = useRef(null);
  const edgesRef       = useRef(null);
  const customGroupRef = useRef(null);
  const videoRef       = useRef(null);
  const streamRef      = useRef(null);

  // ── WebXR Refs & State ────────────────────────────────────────────────────
  const [xrSessionActive, setXrSessionActive] = useState(false);
  const xrHitTestSourceRef = useRef(null);
  const xrRefSpaceRef      = useRef(null);
  const reticleRef         = useRef(null);

  // ── Touch Gesture Refs ────────────────────────────────────────────────────
  const touchStartRef      = useRef({ x: 0, y: 0 });
  const touchStartDistRef  = useRef(0);
  const touchStartScaleRef = useRef(1);
  const isDraggingRef      = useRef(false);
  const touchActiveRef     = useRef(false);

  // ── Hand Gesture Refs ─────────────────────────────────────────────────────
  // Xoay: open palm momentum
  const prevWristRef     = useRef(null);
  const rotVelocityRef   = useRef({ x: 0, y: 0 });
  // Di chuyển: 1-tay pinch
  const prevPinchRef     = useRef(null);   // {x, y} vị trí wrist frame trước
  // Phóng to/Thu nhỏ: 2-tay pinch
  const prevDistRef      = useRef(null);   // khoảng cách 2 ngón trỏ frame trước
  // Trạng thái tay hiện tại (dùng ref để không trigger re-render)
  const handActiveRef    = useRef(false);
  // Target refs và velocity cho di chuyển / phóng to
  const dragVelocityRef   = useRef({ x: 0, y: 0 });
  const targetScaleRef    = useRef(1.0);

  // ── Constants ─────────────────────────────────────────────────────────────
  const ROT_SENSITIVITY   = 3.0;
  const ROT_DAMPING       = 0.80;
  const ROT_DEADZONE      = 0.003;
  const MOVE_SCALE        = 11.0;  // Tăng để kéo nhanh/dài hơn theo ý user
  const DRAG_DAMPING      = 0.75;  // Hệ số tắt dần cho kéo (0.75 phản hồi cực nhạy, dừng tốt)
  const SCALE_SCALE       = 3.5;   // hệ số nhạy zoom
  const SCALE_DEADZONE    = 0.003;
  const SCALE_MIN         = 0.3;
  const SCALE_MAX         = 6.0;

  const arAnchored = useViewerStore((state) => state.arAnchored);
  const arAnchoredRef = useRef(arAnchored);
  useEffect(() => { arAnchoredRef.current = arAnchored; }, [arAnchored]);

  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState(null);
  // handDetected chỉ dùng để điều khiển auto-rotate UI, KHÔNG ảnh hưởng gesture logic
  const [handDetected, setHandDetected] = useState(false);

  // ── WebXR Depth Occlusion Refs & State ────────────────────────────────────
  const depthTextureRef   = useRef(new THREE.Texture());
  const xrWebGLBindingRef = useRef(null);
  const occlusionUniformsRef = useRef({
    uDepthTexture:     { value: depthTextureRef.current },
    uDepthMatrix:      { value: new THREE.Matrix4() },
    uRawValueToMeters: { value: 0.0 },
    uIsFloatFormat:    { value: 0.0 }, // 0.0 = luminance-alpha, 1.0 = float32
    uDepthEnabled:     { value: 0.0 },
  });

  // Khởi tạo thuộc tính texture cho depth để tránh warning trong WebGL
  useEffect(() => {
    const tex = depthTextureRef.current;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
  }, []);

  // ── Hàm trang trí vật liệu cho Depth Occlusion ─────────────────────────────
  const decorateMaterial = (material) => {
    if (!material || material.hasDepthOcclusion) return;
    material.hasDepthOcclusion = true;

    material.defines = material.defines || {};
    material.defines.USE_DEPTH_OCCLUSION = "";

    material.onBeforeCompile = (shader) => {
      // Đăng ký uniforms chia sẻ
      shader.uniforms.uDepthTexture     = occlusionUniformsRef.current.uDepthTexture;
      shader.uniforms.uDepthMatrix      = occlusionUniformsRef.current.uDepthMatrix;
      shader.uniforms.uRawValueToMeters = occlusionUniformsRef.current.uRawValueToMeters;
      shader.uniforms.uIsFloatFormat    = occlusionUniformsRef.current.uIsFloatFormat;
      shader.uniforms.uDepthEnabled     = occlusionUniformsRef.current.uDepthEnabled;

      // Vertex shader: truyền vDepthMeters và vScreenUV sang fragment shader
      if (!shader.vertexShader.includes("varying float vDepthMeters;")) {
        shader.vertexShader = `
          #ifdef USE_DEPTH_OCCLUSION
          varying float vDepthMeters;
          varying vec2 vScreenUV;
          #endif
        ` + shader.vertexShader;
      }
      shader.vertexShader = shader.vertexShader.replace(
        "#include <mvPosition_vertex>",
        `#include <mvPosition_vertex>
        #ifdef USE_DEPTH_OCCLUSION
        vDepthMeters = -mvPosition.z;
        vec4 clipPosition = projectionMatrix * mvPosition;
        vScreenUV = clipPosition.xy / clipPosition.w * 0.5 + 0.5;
        #endif`
      );

      // Fragment shader: tiêm code khai báo
      shader.fragmentShader = `
        #ifdef USE_DEPTH_OCCLUSION
        uniform sampler2D uDepthTexture;
        uniform mat4 uDepthMatrix;
        uniform float uRawValueToMeters;
        uniform float uIsFloatFormat;
        uniform float uDepthEnabled;
        varying float vDepthMeters;
        varying vec2 vScreenUV;
        #endif
      ` + shader.fragmentShader;

      // Fragment shader: tiêm code xử lý discard tại main()
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        `void main() {
        #ifdef USE_DEPTH_OCCLUSION
        if (uDepthEnabled > 0.5) {
          vec2 normViewCoords = vScreenUV;
          vec2 depthTexCoord = (uDepthMatrix * vec4(normViewCoords, 0.0, 1.0)).xy;
          if (depthTexCoord.x >= 0.0 && depthTexCoord.x <= 1.0 && depthTexCoord.y >= 0.0 && depthTexCoord.y <= 1.0) {
            vec4 depthSample = texture2D(uDepthTexture, depthTexCoord);
            float realDepthMeters = 0.0;
            if (uIsFloatFormat > 0.5) {
              // Đối với định dạng float32, giá trị thô nằm trực tiếp ở kênh R
              realDepthMeters = depthSample.r * uRawValueToMeters;
            } else {
              // Đối với định dạng luminance-alpha, giải nén 16-bit từ kênh R và A
              vec2 packedDepth = depthSample.ra;
              float rawDepth = dot(packedDepth, vec2(255.0, 256.0 * 255.0));
              realDepthMeters = rawDepth * uRawValueToMeters;
            }
            
            // Loại bỏ pixel nếu vật ảo xa hơn thực tế 3cm
            if (vDepthMeters > realDepthMeters + 0.03) {
              discard;
            }
          }
        }
        #endif`
      );
    };
  };

  const decorateAllMaterials = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.traverse((child) => {
      if (child.isMesh || child.isLine || child.isPoints || child.isSprite) {
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => decorateMaterial(mat));
          } else {
            decorateMaterial(child.material);
          }
        }
      }
    });
  };

  // ── Initialize Scene, Camera, Renderer ───────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;

    const width  = canvasRef.current.clientWidth;
    const height = canvasRef.current.clientHeight;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 2.5;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.xr.enabled = true;
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);
    const ptLight = new THREE.PointLight(0xffffff, 0.3);
    ptLight.position.set(-5, -5, 5);
    scene.add(ptLight);

    // Reticle cho WebXR
    const reticleGeo = new THREE.RingGeometry(0.1, 0.12, 32);
    reticleGeo.rotateX(-Math.PI / 2);
    const reticle = new THREE.Mesh(reticleGeo, new THREE.MeshBasicMaterial({
      color: 0x3B82F6, side: THREE.DoubleSide, transparent: true, opacity: 0.6,
    }));
    reticle.visible = false;
    reticle.matrixAutoUpdate = false;
    scene.add(reticle);
    reticleRef.current = reticle;
    decorateAllMaterials();

    const onSessionStart = () => {
      setXrSessionActive(true);
      renderer.setPixelRatio(1.0);
      decorateAllMaterials();
    };
    const onSessionEnd = () => {
      setXrSessionActive(false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      xrHitTestSourceRef.current = null;
      xrRefSpaceRef.current = null;
      xrWebGLBindingRef.current = null;
      const properties = renderer.properties.get(depthTextureRef.current);
      if (properties) {
        properties.__webglTexture = undefined;
      }
      occlusionUniformsRef.current.uDepthEnabled.value = 0.0;
      if (reticleRef.current) reticleRef.current.visible = false;
    };
    renderer.xr.addEventListener("sessionstart", onSessionStart);
    renderer.xr.addEventListener("sessionend",   onSessionEnd);

    const handleResize = () => {
      if (!canvasRef.current) return;
      const w = canvasRef.current.clientWidth;
      const h = canvasRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.xr.removeEventListener("sessionstart", onSessionStart);
      renderer.xr.removeEventListener("sessionend",   onSessionEnd);
      renderer.dispose();
    };
  }, []);

  // ── Touch Controls (Cam sau / WebXR) ─────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getTarget = () => customGroupRef.current || meshRef.current;

    const onTouchStart = (e) => {
      const tagName = e.target.tagName?.toLowerCase();
      if (tagName === "button" || tagName === "select" || tagName === "input" ||
          e.target.closest(".no-gesture")) {
        touchActiveRef.current = false;
        return;
      }
      if (!canvas.contains(e.target) && !xrSessionActive) {
        touchActiveRef.current = false;
        return;
      }
      touchActiveRef.current = true;
      isDraggingRef.current  = false;

      if (e.touches.length === 1) {
        touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
        const target = getTarget();
        if (target) touchStartScaleRef.current = target.scale.x;
      }
    };

    const onTouchMove = (e) => {
      if (!touchActiveRef.current) return;
      const target = getTarget();
      if (!target) return;

      if (e.touches.length === 1) {
        const curX = e.touches[0].clientX;
        const curY = e.touches[0].clientY;
        const dx = curX - touchStartRef.current.x;
        const dy = curY - touchStartRef.current.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) isDraggingRef.current = true;

        if (xrSessionActive && !arAnchoredRef.current) {
          const tempCamQ = new THREE.Quaternion();
          cameraRef.current.getWorldQuaternion(tempCamQ);
          const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(tempCamQ);
          right.y = 0; right.normalize();
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(tempCamQ);
          forward.y = 0; forward.normalize();
          target.position.addScaledVector(right,    dx * 0.0015);
          target.position.addScaledVector(forward, -dy * 0.0015);
          const edges = customGroupRef.current ? null : edgesRef.current;
          if (edges) edges.position.copy(target.position);
        } else {
          target.rotation.y += dx * 0.007;
          if (!xrSessionActive) target.rotation.x += dy * 0.007;
          const edges = customGroupRef.current ? null : edgesRef.current;
          if (edges) edges.rotation.copy(target.rotation);
        }
        touchStartRef.current = { x: curX, y: curY };

      } else if (e.touches.length === 2) {
        isDraggingRef.current = true;
        const dx   = e.touches[0].clientX - e.touches[1].clientX;
        const dy   = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (touchStartDistRef.current > 0) {
          const ratio    = dist / touchStartDistRef.current;
          const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX,
            touchStartScaleRef.current * ratio));
          target.scale.setScalar(newScale);
          const edges = customGroupRef.current ? null : edgesRef.current;
          if (edges) edges.scale.copy(target.scale);
        }
      }
    };

    const onTouchEnd = () => { touchActiveRef.current = false; };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove",  onTouchMove,  { passive: true });
    window.addEventListener("touchend",   onTouchEnd,   { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove",  onTouchMove);
      window.removeEventListener("touchend",   onTouchEnd);
    };
  }, [xrSessionActive]);

  // ── Cập nhật hình học 3D ──────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current)        { scene.remove(meshRef.current);        meshRef.current = null; }
    if (edgesRef.current)       { scene.remove(edgesRef.current);       edgesRef.current = null; }
    if (customGroupRef.current) { scene.remove(customGroupRef.current); customGroupRef.current = null; }

    if (geometryData) {
      const group = buildCustomGeometry(geometryData, {
        opacity,
        scaleFactor: xrSessionActive ? size * 0.18 : size,
        showPoints: true,
        showConstraints,
        show3DLabels: xrSessionActive,
      });
      if (xrSessionActive) group.visible = false;
      scene.add(group);
      customGroupRef.current = group;
      return;
    }

    if (!shape) return;

    const geometry  = makeGeo(shape.geo);
    const material  = makeMaterial(shape.color, wireframe, opacity);
    const mesh      = new THREE.Mesh(geometry, material);
    const targetSize = xrSessionActive ? size * 0.18 : size;
    mesh.scale.set(targetSize, targetSize, targetSize);
    if (xrSessionActive) mesh.visible = false;
    scene.add(mesh);
    meshRef.current = mesh;

    const edges = makeEdges(geometry, 0xffffff);
    edges.scale.set(targetSize, targetSize, targetSize);
    if (xrSessionActive) edges.visible = false;
    scene.add(edges);
    edgesRef.current = edges;

    decorateAllMaterials();
  }, [geometryData, shape, size, opacity, wireframe, showConstraints, xrSessionActive]);

  // ── WebXR Select Listener ─────────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const onSelect = () => {
      if (isDraggingRef.current) { isDraggingRef.current = false; return; }
      const reticle = reticleRef.current;
      const obj     = customGroupRef.current || meshRef.current;
      const edges   = customGroupRef.current ? null : edgesRef.current;
      if (reticle && reticle.visible && obj) {
        if (obj.visible && arAnchoredRef.current) return;
        obj.position.setFromMatrixPosition(reticle.matrix);
        obj.visible = true;
        const camPos = new THREE.Vector3();
        cameraRef.current.getWorldPosition(camPos);
        camPos.y = obj.position.y;
        obj.lookAt(camPos);
        if (edges) { edges.visible = true; edges.position.copy(obj.position); edges.rotation.copy(obj.rotation); }
        if (reticle.material) {
          const old = reticle.material.color.getHex();
          reticle.material.color.setHex(0x10ffa0);
          setTimeout(() => { if (reticle.material) reticle.material.color.setHex(old); }, 300);
        }
      }
    };

    const sessionStartListener = () => {
      const session = renderer.xr.getSession();
      if (session) session.addEventListener("select", onSelect);
    };
    renderer.xr.addEventListener("sessionstart", sessionStartListener);

    return () => {
      renderer.xr.removeEventListener("sessionstart", sessionStartListener);
      const session = renderer.xr.getSession();
      if (session) session.removeEventListener("select", onSelect);
    };
  }, [geometryData, shape]);

  const xrSessionActiveRef = useRef(xrSessionActive);
  useEffect(() => { xrSessionActiveRef.current = xrSessionActive; }, [xrSessionActive]);

  const autoRotateRef = useRef(autoRotate);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);

  // ── Animation Loop (60 FPS) ───────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const animate = (time, frameFromWebGL) => {
      const obj   = customGroupRef.current || meshRef.current;
      const edges = customGroupRef.current ? null : edgesRef.current;

      // WebXR Hit Test
      if (xrSessionActiveRef.current) {
        const frame         = frameFromWebGL || (renderer.xr && typeof renderer.xr.getFrame === "function" ? renderer.xr.getFrame() : null);
        const hitTestSource = xrHitTestSourceRef.current;
        const refSpace      = (renderer.xr && typeof renderer.xr.getReferenceSpace === "function" ? renderer.xr.getReferenceSpace() : null) || xrRefSpaceRef.current;
        if (frame && hitTestSource && refSpace) {
          const hits = frame.getHitTestResults(hitTestSource);
          if (hits.length > 0) {
            const pose = hits[0].getPose(refSpace);
            if (pose && reticleRef.current) {
              reticleRef.current.visible = !arAnchoredRef.current;
              reticleRef.current.matrix.fromArray(pose.transform.matrix);
              if (reticleRef.current.material) {
                reticleRef.current.material.opacity = 0.6;
              }
            }
          } else {
            if (reticleRef.current) reticleRef.current.visible = false;
          }
        }

        // ── WebXR Depth Occlusion ──
        const session = frame ? frame.session : null;
        if (frame && session && refSpace) {
          // Kiểm tra xem thiết bị và trình duyệt có hỗ trợ depth sensing trong session không
          if (!session.depthUsage || !session.depthDataFormat) {
            const statusEl = document.getElementById("xr-depth-status");
            if (statusEl) {
              statusEl.innerText = "• Depth: Thiết bị không hỗ trợ cảm biến";
            }
            occlusionUniformsRef.current.uDepthEnabled.value = 0.0;
          } else {
            const pose = frame.getViewerPose(refSpace);
            if (pose && pose.views && pose.views.length > 0) {
              const view = pose.views[0];

              if (!xrWebGLBindingRef.current && typeof window.XRWebGLBinding !== "undefined") {
                try {
                  const gl = renderer.getContext();
                  xrWebGLBindingRef.current = new window.XRWebGLBinding(session, gl);
                } catch (e) {
                  console.error("Failed to create XRWebGLBinding:", e);
                  const statusEl = document.getElementById("xr-depth-status");
                  if (statusEl) {
                    statusEl.innerText = `• Depth Lỗi: Không thể khởi tạo binding`;
                  }
                }
              }

              if (xrWebGLBindingRef.current) {
                try {
                  const depthInfo = xrWebGLBindingRef.current.getDepthInformation(view);
                  if (depthInfo && depthInfo.texture) {
                    // Link raw WebGLTexture to our Three.js texture properties
                    const properties = renderer.properties.get(depthTextureRef.current);
                    properties.__webglTexture = depthInfo.texture;

                    // Update uniforms
                    occlusionUniformsRef.current.uRawValueToMeters.value = depthInfo.rawValueToMeters;
                    occlusionUniformsRef.current.uDepthMatrix.value.fromArray(depthInfo.normDepthBufferFromNormView.matrix);
                    occlusionUniformsRef.current.uIsFloatFormat.value = (session.depthDataFormat === "float32") ? 1.0 : 0.0;
                    occlusionUniformsRef.current.uDepthEnabled.value = 1.0;

                    // Update trạng thái hiển thị
                    const statusEl = document.getElementById("xr-depth-status");
                    if (statusEl) {
                      const fmt = session.depthDataFormat === "float32" ? "Float32" : "Luminance-Alpha";
                      statusEl.innerText = `• Depth: Hoạt động (${fmt}, scale: ${depthInfo.rawValueToMeters.toFixed(4)})`;
                    }

                    // Debug log một lần khi độ sâu hoạt động
                    if (!window.__depthSensingLogged) {
                      window.__depthSensingLogged = true;
                      console.log("WebXR Depth Sensing active! Format:", session.depthDataFormat, "Usage:", session.depthUsage, "Scale factor:", depthInfo.rawValueToMeters);
                    }
                  } else {
                    const statusEl = document.getElementById("xr-depth-status");
                    if (statusEl) {
                      statusEl.innerText = "• Depth: Sensor đang tải dữ liệu...";
                    }
                    occlusionUniformsRef.current.uDepthEnabled.value = 0.0;
                  }
                } catch (err) {
                  const statusEl = document.getElementById("xr-depth-status");
                  if (statusEl) {
                    if (err.message.includes("Depth sensing feature is not supported") ||
                        err.message.includes("not supported by the session")) {
                      statusEl.innerText = "• Depth: Thiết bị không hỗ trợ cảm biến độ sâu";
                    } else {
                      statusEl.innerText = `• Depth Lỗi: ${err.message}`;
                    }
                  }
                  if (!window.__depthSensingErrorLogged) {
                    window.__depthSensingErrorLogged = true;
                    console.error("Failed to retrieve WebXR depth information:", err);
                  }
                  occlusionUniformsRef.current.uDepthEnabled.value = 0.0;
                }
              } else {
                const statusEl = document.getElementById("xr-depth-status");
                if (statusEl) {
                  statusEl.innerText = "• Depth Lỗi: Thiếu XRWebGLBinding";
                }
                occlusionUniformsRef.current.uDepthEnabled.value = 0.0;
              }
            } else {
              const statusEl = document.getElementById("xr-depth-status");
              if (statusEl) {
                statusEl.innerText = "• Depth: Không tìm thấy views";
              }
              occlusionUniformsRef.current.uDepthEnabled.value = 0.0;
            }
          }
        } else {
          const statusEl = document.getElementById("xr-depth-status");
          if (statusEl) {
            statusEl.innerText = `• Depth: Đang chờ frame hoạt động... (f:${!!frame}, s:${!!session}, r:${!!refSpace})`;
          }
          occlusionUniformsRef.current.uDepthEnabled.value = 0.0;
        }
      } else {
        if (reticleRef.current) reticleRef.current.visible = false;
        occlusionUniformsRef.current.uDepthEnabled.value = 0.0;
      }

      // Auto rotate khi không có tay
      if (obj && autoRotateRef.current && !handActiveRef.current && !xrSessionActiveRef.current) {
        obj.rotation.x += 0.005;
        obj.rotation.y += 0.008;
        if (edges) { edges.rotation.x += 0.005; edges.rotation.y += 0.008; }
      }

      // Momentum xoay (open palm)
      const rv = rotVelocityRef.current;
      if (obj && (Math.abs(rv.x) > 0.0001 || Math.abs(rv.y) > 0.0001)) {
        obj.rotation.x += rv.x;
        obj.rotation.y += rv.y;
        if (edges) { edges.rotation.x += rv.x; edges.rotation.y += rv.y; }
        rv.x *= ROT_DAMPING; if (Math.abs(rv.x) < 0.0001) rv.x = 0;
        rv.y *= ROT_DAMPING; if (Math.abs(rv.y) < 0.0001) rv.y = 0;
      }

      // ── Cập nhật di chuyển bằng Velocity (60 FPS) ──
      if (obj && !xrSessionActiveRef.current) {
        const dv = dragVelocityRef.current;
        if (Math.abs(dv.x) > 0.0001 || Math.abs(dv.y) > 0.0001) {
          obj.position.x += dv.x;
          obj.position.y += dv.y;
          if (edges) edges.position.copy(obj.position);
          
          dv.x *= DRAG_DAMPING; if (Math.abs(dv.x) < 0.0001) dv.x = 0;
          dv.y *= DRAG_DAMPING; if (Math.abs(dv.y) < 0.0001) dv.y = 0;
        }
      }

      // ── Lerp mượt 60 FPS: Scale (Phóng to/Thu nhỏ) ──
      if (obj) {
        const LERP_SCALE = 0.45;
        const scaleDiff = targetScaleRef.current - obj.scale.x;
        if (Math.abs(scaleDiff) > 0.001) {
          const newScale = obj.scale.x + scaleDiff * LERP_SCALE;
          obj.scale.setScalar(newScale);
          if (edges) edges.scale.copy(obj.scale);
        }
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    renderer.setAnimationLoop(animate);
    return () => { renderer.setAnimationLoop(null); };
  }, []);

  // ── Hand Tracking Callback ────────────────────────────────────────────────
  useHandTracking(videoRef, cameraActive && !xrSessionActive, (results) => {
    const landmarks = results.multiHandLandmarks;

    // Không có tay: reset toàn bộ trạng thái gesture
    if (!landmarks || landmarks.length === 0) {
      if (handActiveRef.current) {
        handActiveRef.current = false;
        setHandDetected(false);
        prevWristRef.current = null;
        prevPinchRef.current = null;
        prevDistRef.current  = null;
        rotVelocityRef.current = { x: 0, y: 0 };
        dragVelocityRef.current = { x: 0, y: 0 };
        const obj = customGroupRef.current || meshRef.current;
        if (obj) {
          targetScaleRef.current = obj.scale.x;
        }
      }
      return;
    }

    // Có tay
    if (!handActiveRef.current) {
      handActiveRef.current = true;
      setHandDetected(true);
    }

    const getTarget = () => customGroupRef.current || meshRef.current;
    const target = getTarget();

    const activeHands = landmarks.map(hand => ({
      landmarks: hand,
      isPinching: isPinching(hand),
      isOpenPalm: isOpenPalm(hand),
    }));

    const pinchingHands = activeHands.filter(h => h.isPinching);
    const openPalmHands = activeHands.filter(h => h.isOpenPalm);

    // ════════════════════════════════════════════════
    // Trạng thái 1: PHÓNG TO / THU NHỎ (Có ít nhất 2 tay pinch)
    // ════════════════════════════════════════════════
    if (pinchingHands.length >= 2 && target) {
      // Reset 1-tay drag & rotate
      prevPinchRef.current = null;
      prevWristRef.current = null;
      dragVelocityRef.current = { x: 0, y: 0 };

      const hand1 = pinchingHands[0].landmarks;
      const hand2 = pinchingHands[1].landmarks;

      // Dùng khoảng cách giữa 2 ngón trỏ (index tip = landmark 8)
      const tip1 = hand1[8];
      const tip2 = hand2[8];
      const dist = getDistance(tip1, tip2);

      if (prevDistRef.current !== null) {
        const delta = dist - prevDistRef.current;
        if (Math.abs(delta) > SCALE_DEADZONE) {
          const newTarget = Math.max(SCALE_MIN, Math.min(SCALE_MAX,
            targetScaleRef.current + delta * SCALE_SCALE));
          targetScaleRef.current = newTarget;
        }
      } else {
        targetScaleRef.current = target.scale.x;
      }
      prevDistRef.current = dist;

    // ════════════════════════════════════════════════
    // Trạng thái 2: DI CHUYỂN (Chỉ có duy nhất 1 tay pinch)
    // ════════════════════════════════════════════════
    } else if (pinchingHands.length === 1 && target) {
      // Reset 2-tay zoom & rotate
      prevDistRef.current = null;
      prevWristRef.current = null;

      const hand  = pinchingHands[0].landmarks;
      const wrist = hand[0];

      if (prevPinchRef.current !== null) {
        const dx =  wrist.x - prevPinchRef.current.x;
        const dy = -wrist.y + prevPinchRef.current.y;
        
        const dragSensitivity = MOVE_SCALE * (1.0 - DRAG_DAMPING);
        dragVelocityRef.current.x += dx * dragSensitivity;
        dragVelocityRef.current.y += dy * dragSensitivity;
        
        const MAX_DRAG_VEL = 0.5;
        dragVelocityRef.current.x = Math.max(-MAX_DRAG_VEL, Math.min(MAX_DRAG_VEL, dragVelocityRef.current.x));
        dragVelocityRef.current.y = Math.max(-MAX_DRAG_VEL, Math.min(MAX_DRAG_VEL, dragVelocityRef.current.y));
      } else {
        dragVelocityRef.current = { x: 0, y: 0 };
      }
      prevPinchRef.current = { x: wrist.x, y: wrist.y };

    // ════════════════════════════════════════════════
    // Trạng thái 3: XOAY (Không có tay pinch, có ít nhất 1 tay mở)
    // ════════════════════════════════════════════════
    } else if (pinchingHands.length === 0 && openPalmHands.length >= 1 && target) {
      // Reset 1-tay drag & 2-tay zoom
      prevPinchRef.current = null;
      prevDistRef.current = null;
      dragVelocityRef.current = { x: 0, y: 0 };

      const hand  = openPalmHands[0].landmarks;
      const wrist = hand[0];

      if (prevWristRef.current !== null) {
        const dx = wrist.x - prevWristRef.current.x;
        const dy = wrist.y - prevWristRef.current.y;
        if (Math.abs(dx) > ROT_DEADZONE || Math.abs(dy) > ROT_DEADZONE) {
          rotVelocityRef.current.y += dx * ROT_SENSITIVITY;
          rotVelocityRef.current.x += dy * ROT_SENSITIVITY;
          rotVelocityRef.current.y  = Math.max(-0.15, Math.min(0.15, rotVelocityRef.current.y));
          rotVelocityRef.current.x  = Math.max(-0.15, Math.min(0.15, rotVelocityRef.current.x));
        }
      }
      prevWristRef.current = { x: wrist.x, y: wrist.y };

    // ════════════════════════════════════════════════
    // Trạng thái 4: KHÔNG CÓ CỬ CHỈ HỢP LỆ (Không pinch, không open palm)
    // ════════════════════════════════════════════════
    } else {
      if (prevDistRef.current !== null && target) {
        targetScaleRef.current = target.scale.x;
      }
      if (prevPinchRef.current !== null) {
        dragVelocityRef.current = { x: 0, y: 0 };
      }
      
      prevPinchRef.current = null;
      prevDistRef.current  = null;
      prevWristRef.current = null;
    }
  });

  // ── Toggle Camera ─────────────────────────────────────────────────────────
  const toggleCamera = async () => {
    try {
      if (cameraActive) {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        setCameraActive(false);
        setError(null);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setError(null);
    } catch (err) {
      setError(err.name === "NotAllowedError"
        ? "Bạn cần cấp quyền camera"
        : "Không thể truy cập camera: " + err.message);
      setCameraActive(false);
    }
  };

  // ── Toggle WebXR ──────────────────────────────────────────────────────────
  const toggleXR = async () => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (renderer.xr.isPresenting) {
      const session = renderer.xr.getSession();
      if (session) await session.end();
      return;
    }

    try {
      setError(null);
      if (cameraActive) await toggleCamera();

      if (!canvasRef.current || !canvasRef.current.parentElement)
        throw new Error("Không tìm thấy canvas wrapper element.");

      const session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["local", "local-floor", "dom-overlay", "depth-sensing"],
        depthSensing: {
          usagePreference: ["gpu-optimized", "cpu-optimized"],
          dataFormatPreference: ["luminance-alpha", "float32"],
        },
        domOverlay: { root: canvasRef.current.parentElement },
      });

      await renderer.xr.setSession(session);

      const viewerSpace   = await session.requestReferenceSpace("viewer");
      const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
      xrHitTestSourceRef.current = hitTestSource;

      const refSpace = await session.requestReferenceSpace("local");
      xrRefSpaceRef.current = refSpace;

      session.addEventListener("end", () => {
        xrHitTestSourceRef.current = null;
        xrRefSpaceRef.current      = null;
      });
    } catch (err) {
      console.error("Lỗi khi mở phiên WebXR:", err);
      setError("Không hỗ trợ quét sàn WebXR trên trình duyệt này: " + err.message);
    }
  };

  return {
    cameraActive,
    toggleCamera,
    xrSessionActive,
    toggleXR,
    error,
    videoRef,
    cameraRef,
    customGroupRef,
    meshRef,
  };
}
