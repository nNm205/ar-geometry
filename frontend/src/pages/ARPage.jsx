import { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";

import Navbar from "../components/layout/Navbar";
import { ARControls } from "../components/ar/ARControls";
import MathRenderer from "../components/ui/MathRenderer";

import useViewerStore from "../store/useViewerStore";
import { useAR } from "../hooks/useAR";
import { computeLabelPositions } from "../utils/buildCustomGeometry";

function AcademicStepperLoader() {
  const steps = [
    { id: 1, name: "Trích xuất đề bài (OCR)", desc: "Nhận diện chữ viết và ký hiệu toán học" },
    { id: 2, name: "Phân tích ràng buộc hình học", desc: "AI xác định cấu trúc đa diện và giả thiết" },
    { id: 3, name: "Giải hệ tọa độ 3D không gian", desc: "Engine tính toán các đỉnh phụ và mặt thiết diện" },
    { id: 4, name: "Kết xuất sơ đồ hình học & Lời giải", desc: "Dựng mesh Three.js và biên dịch LaTeX" },
  ];

  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timers = [];
    for (let i = 1; i <= steps.length; i++) {
      const t = setTimeout(() => {
        setActiveStep(i);
      }, i * 1400);
      timers.push(t);
    }
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <div style={styles.stepperContainer}>
      <div style={styles.stepperHeader}>
        <span style={styles.stepperHeaderTitle}>TIẾN TRÌNH PHÂN TÍCH</span>
        <span style={styles.stepperHeaderProgress}>
          {activeStep === steps.length ? "Hoàn tất" : `Đang chạy: ${activeStep + 1}/${steps.length}`}
        </span>
      </div>
      <div style={styles.stepperList}>
        {steps.map((step, idx) => {
          const isCompleted = activeStep > idx;
          const isActive = activeStep === idx;
          
          let statusColor = "var(--text3)";
          let iconContent = idx + 1;
          let iconBg = "rgba(255, 255, 255, 0.02)";
          let iconBorder = "1px solid var(--border)";
          let nameColor = "var(--text3)";
          let descColor = "var(--text3)";

          if (isCompleted) {
            statusColor = "var(--green)";
            iconContent = "✓";
            iconBg = "rgba(34, 197, 94, 0.1)";
            iconBorder = "1px solid var(--green)";
            nameColor = "var(--text)";
            descColor = "var(--text2)";
          } else if (isActive) {
            statusColor = "var(--cyan)";
            iconBg = "rgba(59, 130, 246, 0.1)";
            iconBorder = "1px solid var(--cyan)";
            nameColor = "var(--text)";
            descColor = "var(--text2)";
          }

          return (
            <div key={step.id} style={styles.stepperRow}>
              <div
                style={{
                  ...styles.stepperIcon,
                  background: iconBg,
                  border: iconBorder,
                  color: statusColor,
                }}
              >
                {iconContent}
              </div>
              <div style={styles.stepperContent}>
                <div style={{ ...styles.stepperName, color: nameColor }}>
                  {step.name}
                  {isActive && <span style={styles.stepperSpinner} />}
                </div>
                <div style={{ ...styles.stepperDesc, color: descColor }}>{step.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ARPage() {
  const canvasRef = useRef(null);
  const labelContainerRef = useRef(null);
  const rafIdRef = useRef(null);

  const {
    currentShape,
    size,
    opacity,
    wireframe,
    autoRotate,
    mode,
    geometryData,
    showEdgeLengths,
    showConstraints,
    isLoading,
    apiError,
    arAnchored,
    toggleArAnchored,
  } = useViewerStore();

  const {
    cameraActive,
    toggleCamera,
    xrSessionActive,
    toggleXR,
    error,
    videoRef,
    cameraRef,
    customGroupRef,
  } = useAR(
    canvasRef,
    currentShape,
    { size, opacity, wireframe, autoRotate, showConstraints },
    mode === "custom" ? geometryData : null,
  );

  // ── Dữ liệu label 3D (tọa độ world-space, tính 1 lần khi geometry đổi) ──
  const [labelData, setLabelData] = useState({ vertexLabels: [], edgeLabels: [] });

  useEffect(() => {
    if (mode === "custom" && geometryData) {
      setLabelData(computeLabelPositions(geometryData, size));
    } else {
      setLabelData({ vertexLabels: [], edgeLabels: [] });
    }
  }, [geometryData, mode, size]);

  // rAF loop: Project 3D vertex positions → 2D screen mỗi frame
  // QUAN TRỌNG: Phải dùng group.localToWorld() để lấy world-space position
  // sau khi group đã xoay — nếu không labels sẽ đứng yên khi hình xoay.
  const updateLabelPositions = useCallback(() => {
    const camera = cameraRef?.current;
    const group = customGroupRef?.current; // Group đang xoay trong scene
    const container = labelContainerRef.current;
    const canvas = canvasRef.current;
    if (!camera || !container || !canvas) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    container.querySelectorAll("[data-pos]").forEach((el) => {
      try {
        const raw = el.dataset.pos;
        if (!raw) return;
        const [x, y, z] = raw.split(",").map(Number);

        // Tạo vector ở LOCAL space của group (tọa độ gốc của đỉnh)
        const vec = new THREE.Vector3(x, y, z);

        // Chuyển từ LOCAL space → WORLD space theo rotation/position/scale hiện tại
        // Đây là bước then chốt: group.localToWorld() dùng matrixWorld của group
        if (group) {
          group.localToWorld(vec);
        }

        // Project WORLD space → NDC [-1,1] bằng camera Three.js thật
        vec.project(camera);

        // NDC → pixel coordinates
        const px = (vec.x + 1) / 2 * w;
        const py = (-vec.y + 1) / 2 * h; // flip Y axis

        // Ẩn label khi vertex nằm phía sau camera (z ndc > 1)
        const visible = vec.z < 1;
        el.style.display = visible ? "block" : "none";
        el.style.left = `${px}px`;
        el.style.top = `${py}px`;
      } catch (_) {}
    });
  }, [cameraRef, customGroupRef]);

  // Chạy loop khi ở custom mode và có label data
  useEffect(() => {
    if (mode !== "custom" || labelData.vertexLabels.length === 0) return;

    const loop = () => {
      updateLabelPositions();
      rafIdRef.current = requestAnimationFrame(loop);
    };
    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [mode, labelData, updateLabelPositions]);

  useEffect(() => {
    if (canvasRef.current) canvasRef.current.focus();
  }, []);

  return (
    <div style={styles.pageContainer}>
      <Navbar cameraActive={cameraActive} xrSessionActive={xrSessionActive} />

      <div style={styles.workspaceWrapper}>
        <div style={styles.layout} className="ar-layout">
          {/* ── CỬA SỔ LỜI GIẢI (BÊN TRÁI) ─────────────────────────── */}
          <div style={styles.solutionCard}>
            <div style={styles.solutionHeader}>
              <span style={styles.solutionTitleIcon}>📝</span>
              <span style={styles.solutionTitle}>Lời giải & Chứng minh</span>
            </div>

            <div style={styles.solutionBody}>
              {isLoading ? (
                <AcademicStepperLoader />
              ) : apiError ? (
                <div style={styles.solutionError}>
                  <div style={styles.errorIcon}>⚠️</div>
                  <div style={styles.errorTitle}>Lỗi xử lý hệ thống</div>
                  <p style={styles.errorText}>{apiError}</p>
                </div>
              ) : mode === "custom" && geometryData ? (
                <>
                  {/* Đề bài OCR */}
                  {geometryData.problem && (
                    <div style={styles.problemBox}>
                      <div style={styles.boxLabel}>VĂN BẢN ĐỀ BÀI (OCR)</div>
                      <div style={styles.problemTextScanned}>{geometryData.problem}</div>
                    </div>
                  )}

                  {/* Lời giải toán chi tiết */}
                  {geometryData.solution ? (
                    <div style={styles.solutionContentBox}>
                      <div style={styles.boxLabel}>LỜI GIẢI CHI TIẾT TỪNG BƯỚC</div>
                      <MathRenderer text={geometryData.solution} />
                    </div>
                  ) : (
                    <div style={styles.noSolutionBox}>
                      <span style={{ fontSize: "28px", marginBottom: "10px" }}>💡</span>
                      <div style={{ fontWeight: 600 }}>Chưa có lời giải chi tiết.</div>
                      <p style={{ fontSize: "12px", color: "var(--text3)", marginTop: "4px" }}>
                        Hãy tải lên ảnh đề bài hình học của bạn để AI tự động trích xuất lời giải.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div style={styles.emptyStateBox}>
                  <span style={{ fontSize: "36px", marginBottom: "12px" }}>📐</span>
                  <div style={{ fontWeight: 600, color: "var(--text)" }}>Bản giải toán hình học không gian</div>
                  <p style={{ fontSize: "13px", color: "var(--text3)", marginTop: "6px", maxWidth: "300px" }}>
                    Hãy tải ảnh đề bài lên hoặc chọn bài toán để xem lời giải chi tiết và dựng mô hình 3D tương tác.
                  </p>
                </div>
              )}
            </div>
          </div>

        {/* ── CỬA SỔ VẼ HÌNH 3D (Ở GIỮA/PHẢI) ────────────────────── */}
        <div style={styles.viewerCard}>
          <div style={styles.viewerHeader}>
            <div>
              <div style={styles.shapeName}>
                {mode === "custom"
                  ? geometryData?.label || "Hình vẽ 3D tương tác"
                  : currentShape?.name}
              </div>
              <div style={styles.shapeInfo}>
                {mode === "custom"
                  ? "Interactive Geometry View"
                  : "AR Hand Tracking Active"}
              </div>
            </div>

            <div style={styles.statusWrap}>
              <div
                style={{
                  ...styles.statusDot,
                  background: cameraActive ? "var(--green)" : "#666",
                }}
              />
              <span style={styles.statusText}>
                {cameraActive ? "Camera Active" : "Camera Off"}
              </span>
            </div>
          </div>

          <div style={{ ...styles.canvasWrapper, background: cameraActive ? "transparent" : "#f8fafc" }}>
            {/* CAMERA VIDEO */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={styles.video}
            />

            {/* THREE.js WebGL canvas */}
            <canvas ref={canvasRef} style={styles.canvas} />

            {/* ── HTML Label Overlay (vertex names + edge lengths) ── */}
            {mode === "custom" && !xrSessionActive && (
              <div ref={labelContainerRef} style={styles.labelContainer}>
                {/* Vertex labels */}
                {labelData.vertexLabels.map((lbl) => (
                  <div
                    key={`v-${lbl.name}`}
                    data-pos={`${lbl.position.x},${lbl.position.y},${lbl.position.z}`}
                    style={{
                      ...styles.vertexLabel,
                      background: lbl.isHighlighted
                        ? "#EF4444"
                        : "rgba(15, 23, 42, 0.95)",
                      borderColor: lbl.isHighlighted ? "#FCA5A5" : "rgba(255, 255, 255, 0.8)",
                      color: "#ffffff",
                    }}
                  >
                    {lbl.name}
                  </div>
                ))}

                {/* Edge length labels */}
                {showEdgeLengths && labelData.edgeLabels.map((lbl) => (
                  <div
                    key={`e-${lbl.name}`}
                    data-pos={`${lbl.position.x},${lbl.position.y},${lbl.position.z}`}
                    style={styles.edgeLabel}
                  >
                    {lbl.label}
                  </div>
                ))}
              </div>
            )}

            {/* ── Floating Canvas interaction tip ── */}
            {geometryData && !cameraActive && !xrSessionActive && (
              <div style={styles.canvasTip}>
                💡 Kéo chuột để xoay · Cuộn để thu phóng
              </div>
            )}

            {/* ── Placeholder khi camera chưa bật & chưa load hình ──────────────── */}
            {!cameraActive && !xrSessionActive && !geometryData && (
              <div style={styles.overlay}>
                <div style={styles.overlayBox}>
                  <div style={styles.overlayIcon}>📐</div>
                  <h3 style={styles.overlayTitle}>Không gian Hình học 3D</h3>
                  <p style={styles.overlayDesc}>
                    Hãy tải ảnh đề bài lên hoặc chọn bài toán mẫu để dựng mô hình 3D tương tác.
                  </p>
                </div>
              </div>
            )}

            {/* ── WebXR HUD Overlay (chỉ hiện khi đang chạy WebXR) ── */}
            {xrSessionActive && (
              <div style={styles.xrHud}>
                <div style={styles.xrHudTop}>
                  <button
                    style={
                      arAnchored
                        ? styles.xrAnchorBtnActive
                        : styles.xrAnchorBtnInactive
                    }
                    className="no-gesture"
                    onClick={toggleArAnchored}
                  >
                    {arAnchored ? "🔒 Đang Ghim hình" : "🔓 Đang di chuyển"}
                  </button>
                  <button
                    style={styles.xrExitBtn}
                    className="no-gesture"
                    onClick={toggleXR}
                  >
                    ✕ Thoát AR
                  </button>
                </div>

                <div style={styles.xrInstructions} className="no-gesture">
                  <div style={styles.xrInstructionsTitle}>Hướng dẫn tương tác:</div>
                  <div>• Quét camera quanh sàn/bàn để tìm bề mặt.</div>
                  {arAnchored ? (
                    <>
                      <div>• Hình đã được ghim vị trí cố định.</div>
                      <div>• Vuốt 1 ngón để <strong>xoay ngang</strong>, 2 ngón để thu phóng.</div>
                      <div>• Nhấn nút 🔓 ở trên để gỡ ghim di chuyển hình.</div>
                    </>
                  ) : (
                    <>
                      <div>• Chạm điểm ngắm màu xanh để đặt hình nhanh.</div>
                      <div>• Vuốt 1 ngón để <strong>kéo và di chuyển</strong> hình trên mặt phẳng.</div>
                      <div>• Nhấn nút 🔒 ở trên để ghim cố định hình.</div>
                    </>
                  )}
                  <div id="xr-depth-status" style={{ marginTop: "6px", color: "#ffd700", fontWeight: "bold" }}>
                    • Depth: Đang kiểm tra cảm biến...
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Meta: V, S, h ──────────────────────────────────── */}
          {mode === "custom" && geometryData?.meta && (
            <div style={styles.metaBar}>
              {geometryData.meta.volume !== undefined && (
                <MetaChip
                  label="Thể tích"
                  value={`${geometryData.meta.volume.toFixed(3)}`}
                  unit="đvtt"
                />
              )}
              {geometryData.meta.surface_area !== undefined && (
                <MetaChip
                  label="Diện tích TP"
                  value={`${geometryData.meta.surface_area.toFixed(2)}`}
                  unit="đvdt"
                />
              )}
              {geometryData.meta.height !== undefined && (
                <MetaChip
                  label="Chiều cao"
                  value={`${geometryData.meta.height}`}
                  unit="h"
                />
              )}
              {geometryData.meta.base_edge !== undefined && (
                <MetaChip
                  label="Cạnh đáy"
                  value={`${geometryData.meta.base_edge}`}
                  unit="a"
                />
              )}
            </div>
          )}
        </div>

        {/* ── BẢNG ĐIỀU KHIỂN (BÊN PHẢI) ────────────────────────── */}
        <div style={styles.controlsCol}>
          <div style={styles.controlsCard}>
            <div style={styles.panelTitle}>Điều khiển AR</div>
            <ARControls
              onToggleCamera={toggleCamera}
              cameraActive={cameraActive}
              onToggleXR={toggleXR}
              xrSessionActive={xrSessionActive}
              error={error}
            />
          </div>

          <div style={styles.helpCard}>
            <div style={styles.panelTitle}>Hand Gestures</div>
            <div style={styles.gestureList}>
              <GestureRow emoji="🖐" title="Open Palm" desc="Xoay object" />
              <GestureRow emoji="🤏" title="Pinch" desc="Di chuyển object" />
              <GestureRow
                emoji="🤏🤏"
                title="2 tay Pinch"
                desc="Phóng to / Thu nhỏ"
              />
        </div>
      </div>
    </div>
  </div>
</div>

      <style>{`
        @keyframes blink {
          0%, 100% { background-color: transparent }
          50% { background-color: #50fa7b }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small UI helpers
// ─────────────────────────────────────────────────────────────────────────────

function GestureRow({ emoji, title, desc }) {
  return (
    <div style={styles.gestureRow}>
      <div style={styles.gestureEmoji}>{emoji}</div>
      <div>
        <div style={styles.gestureTitle}>{title}</div>
        <div style={styles.gestureDesc}>{desc}</div>
      </div>
    </div>
  );
}

function MetaChip({ label, value, unit }) {
  return (
    <div style={styles.metaChip}>
      <span style={styles.metaLabel}>{label}</span>
      <span style={styles.metaValue}>
        {value}
        {unit && <span style={styles.metaUnit}> {unit}</span>}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = {
  pageContainer: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg)",
  },

  workspaceWrapper: {
    flex: 1,
    width: "100%",
    maxWidth: "1800px",
    margin: "0 auto",
    padding: "16px 20px 24px",
    display: "flex",
    flexDirection: "column",
  },

  layout: {
    display: "grid",
    gridTemplateColumns: "25fr 55fr 20fr",
    gap: "16px",
    alignItems: "stretch",
    flex: 1,
  },

  viewerCard: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minHeight: "780px",
    boxShadow: "none",
  },

  viewerHeader: {
    padding: "14px 20px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "rgba(255, 255, 255, 0.01)",
  },

  shapeName: {
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--text)",
  },

  shapeInfo: {
    fontSize: "11px",
    marginTop: "2px",
    color: "var(--text3)",
    fontFamily: "'Fira Code', monospace",
  },

  statusWrap: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },

  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    transition: "background .3s ease",
  },

  statusText: {
    fontSize: "11px",
    color: "var(--text3)",
    fontFamily: "'Inter', sans-serif",
    fontWeight: 500,
  },

  problemBanner: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "10px 16px",
    borderBottom: "1px solid var(--border)",
    background: "rgba(59, 130, 246, 0.05)",
  },

  problemIcon: { fontSize: "14px", flexShrink: 0 },

  problemText: {
    fontSize: "13px",
    color: "var(--text2)",
    lineHeight: 1.5,
  },

  canvasWrapper: {
    position: "relative",
    flex: 1,
    overflow: "hidden",
  },

  video: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    zIndex: 0,
  },

  canvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    zIndex: 1,
    background: "transparent",
  },

  labelContainer: {
    position: "absolute",
    inset: 0,
    zIndex: 3,
    pointerEvents: "none",
    overflow: "hidden",
  },

  vertexLabel: {
    position: "absolute",
    transform: "translate(-50%, -130%)",
    padding: "4px 8px",
    borderRadius: "4px",
    border: "1.5px solid rgba(255, 255, 255, 0.8)",
    fontSize: "12px",
    fontWeight: 700,
    fontFamily: "'Fira Code', monospace",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    letterSpacing: "-0.2px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.3)",
  },

  edgeLabel: {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    padding: "3px 6px",
    borderRadius: "4px",
    background: "rgba(15, 23, 42, 0.95)",
    border: "1.5px solid rgba(255, 255, 255, 0.15)",
    fontSize: "10px",
    fontFamily: "'Fira Code', monospace",
    color: "#E2E8F0",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
  },

  canvasTip: {
    position: "absolute",
    bottom: "12px",
    left: "12px",
    zIndex: 4,
    background: "rgba(15, 23, 42, 0.8)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "6px 12px",
    fontSize: "11px",
    color: "var(--text2)",
    pointerEvents: "none",
  },

  overlay: {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg)",
  },

  overlayBox: {
    textAlign: "center",
    padding: "24px",
  },

  overlayIcon: { fontSize: "36px", marginBottom: "12px" },

  overlayTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "var(--text)",
    marginBottom: "8px",
    letterSpacing: "-0.3px",
  },

  overlayDesc: {
    color: "var(--text3)",
    fontSize: "12px",
    lineHeight: 1.6,
    maxWidth: "320px",
    margin: "0 auto",
  },

  metaBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    padding: "12px 18px",
    borderTop: "1px solid var(--border)",
    background: "rgba(255,255,255,0.01)",
  },

  metaChip: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "6px",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "6px 12px",
  },

  metaLabel: {
    fontSize: "10px",
    color: "var(--text3)",
    fontFamily: "'Inter', sans-serif",
    textTransform: "uppercase",
    fontWeight: 500,
    letterSpacing: "0.5px",
  },

  metaValue: {
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--cyan)",
    fontFamily: "'Fira Code', monospace",
  },

  metaUnit: {
    fontSize: "10px",
    color: "var(--text3)",
    marginLeft: "2px",
  },

  controlsCol: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },

  controlsCard: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    overflow: "hidden",
    padding: "16px",
  },

  helpCard: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "16px",
  },

  panelTitle: {
    fontSize: "10px",
    fontWeight: 600,
    color: "var(--text3)",
    textTransform: "uppercase",
    letterSpacing: "0.8px",
    marginBottom: "12px",
    fontFamily: "'Inter', sans-serif",
  },

  gestureList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },

  gestureRow: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    background: "rgba(255,255,255,0.01)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "10px 12px",
  },

  gestureEmoji: {
    fontSize: "16px",
    width: "24px",
    textAlign: "center",
  },

  gestureTitle: {
    color: "var(--text)",
    fontSize: "12px",
    fontWeight: 600,
  },

  gestureDesc: {
    color: "var(--text2)",
    fontSize: "11px",
    marginTop: "2px",
  },

  solutionCard: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minHeight: "780px",
  },

  solutionHeader: {
    padding: "14px 20px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    background: "rgba(255, 255, 255, 0.01)",
  },

  solutionTitleIcon: {
    fontSize: "14px",
  },

  solutionTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--text)",
  },

  solutionBody: {
    padding: "16px 20px",
    flex: 1,
    overflowY: "auto",
    maxHeight: "710px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },

  problemBox: {
    background: "rgba(255,255,255,0.02)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "12px 14px",
  },

  boxLabel: {
    fontSize: "9px",
    fontWeight: 600,
    color: "var(--text3)",
    fontFamily: "'Inter', sans-serif",
    letterSpacing: "0.5px",
    marginBottom: "6px",
  },

  problemTextScanned: {
    fontSize: "13px",
    color: "var(--text)",
    lineHeight: "1.5",
  },

  solutionContentBox: {
    background: "rgba(255, 255, 255, 0.01)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "12px 14px",
  },

  noSolutionBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    color: "var(--text2)",
    padding: "32px 16px",
    background: "rgba(255,255,255,0.01)",
    border: "1px dashed var(--border)",
    borderRadius: "8px",
    flex: 1,
  },

  emptyStateBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    flex: 1,
    padding: "32px 16px",
  },

  solutionError: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "24px 16px",
    border: "1px solid rgba(239, 68, 68, 0.15)",
    background: "rgba(239, 68, 68, 0.03)",
    borderRadius: "8px",
    color: "#fca5a5",
    flex: 1,
  },

  errorIcon: {
    fontSize: "24px",
    marginBottom: "8px",
  },

  errorTitle: {
    fontWeight: 600,
    fontSize: "14px",
    marginBottom: "4px",
  },

  errorText: {
    fontSize: "12px",
    opacity: 0.85,
    lineHeight: 1.5,
  },

  stepperContainer: {
    background: "rgba(255, 255, 255, 0.01)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    padding: "20px",
    fontFamily: "'Inter', sans-serif",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    minHeight: "360px",
  },

  stepperHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid var(--border)",
    paddingBottom: "12px",
  },

  stepperHeaderTitle: {
    fontSize: "10px",
    fontWeight: 700,
    color: "var(--text3)",
    letterSpacing: "1px",
  },

  stepperHeaderProgress: {
    fontSize: "11px",
    fontWeight: 600,
    color: "var(--cyan)",
    fontFamily: "'Fira Code', monospace",
  },

  stepperList: {
    display: "flex",
    flexDirection: "column",
    gap: "18px",
  },

  stepperRow: {
    display: "flex",
    gap: "14px",
    alignItems: "flex-start",
  },

  stepperIcon: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: 700,
    flexShrink: 0,
    transition: "all 0.25s ease",
  },

  stepperContent: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },

  stepperName: {
    fontSize: "13px",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },

  stepperDesc: {
    fontSize: "11px",
    lineHeight: "1.4",
  },

  stepperSpinner: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "var(--cyan)",
    animation: "pulse 1s infinite",
  },

  xrHud: {
    position: "absolute",
    inset: 0,
    zIndex: 10,
    pointerEvents: "none",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "16px",
  },

  xrHudTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    pointerEvents: "none",
  },

  xrAnchorBtnActive: {
    padding: "8px 14px",
    borderRadius: "8px",
    background: "var(--green)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    pointerEvents: "auto",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    transition: "opacity 0.2s",
  },

  xrAnchorBtnInactive: {
    padding: "8px 14px",
    borderRadius: "8px",
    background: "var(--orange)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    pointerEvents: "auto",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    transition: "opacity 0.2s",
  },

  xrExitBtn: {
    alignSelf: "flex-end",
    padding: "8px 14px",
    borderRadius: "8px",
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    color: "var(--text)",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    pointerEvents: "auto",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    transition: "opacity 0.2s",
  },

  xrInstructions: {
    alignSelf: "center",
    background: "rgba(15, 23, 42, 0.92)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "10px 14px",
    color: "var(--text2)",
    fontSize: "11px",
    lineHeight: "1.5",
    maxWidth: "320px",
    pointerEvents: "auto",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
  },

  xrInstructionsTitle: {
    fontWeight: 600,
    color: "var(--text)",
    marginBottom: "4px",
    fontSize: "11px",
    letterSpacing: "0.2px",
  },
};
