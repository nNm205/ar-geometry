import { useRef, useState, useEffect } from "react";
import MOCK_GEOMETRY_PROBLEMS from "../../data/mockGeometryOutput";
import useViewerStore from "../../store/useViewerStore";
import { analyzeImageProblem } from "../../api/geometryApi";

export function ARControls({
  onToggleCamera,
  cameraActive,
  onToggleXR,
  xrSessionActive,
  error: cameraError
}) {
  const {
    currentShape,
    setShape,
    toggleWireframe,
    toggleAutoRotate,
    wireframe,
    autoRotate,
    setSize,
    setOpacity,
    size,
    opacity,
    mode,
    setGeometryData,
    showEdgeLengths,
    showConstraints,
    toggleEdgeLengths,
    toggleConstraints,
    isLoading,
    setIsLoading,
    apiError,
    setApiError,
    arMode,
    setArMode,
  } = useViewerStore();

  const fileInputRef = useRef(null);
  const [selectedProblemId, setSelectedProblemId] = useState("");
  const [xrSupported, setXrSupported] = useState(false);

  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
        setXrSupported(supported);
      });
    }
  }, []);

  const handleLoadProblem = (id) => {
    if (!id) return;
    setSelectedProblemId(id);
    setApiError(null);
    const found = MOCK_GEOMETRY_PROBLEMS.find((p) => p.id === id);
    if (found) setGeometryData(found);
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    setApiError(null);
    
    try {
      const data = await analyzeImageProblem(file);
      setGeometryData(data);
    } catch (err) {
      console.error(err);
      setApiError(err.message || "Lỗi không xác định khi kết nối máy chủ AI");
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div className="ar-controls">
      {/* ── CHẾ ĐỘ AR MODE SELECTOR ────────────────────────────── */}
      <div className="section">
        <div className="section-title">Chế độ AR</div>
        <div className="toggle-buttons">
          <button
            className={`toggle-btn ${arMode === "gesture" ? "active" : ""}`}
            onClick={() => {
              if (xrSessionActive) onToggleXR();
              setArMode("gesture");
            }}
          >
            Camera trước (Cử chỉ)
          </button>
          <button
            className={`toggle-btn ${arMode === "webxr" ? "active" : ""}`}
            onClick={() => {
              if (cameraActive) onToggleCamera();
              setArMode("webxr");
            }}
          >
            Camera sau (WebXR)
          </button>
        </div>
      </div>

      {/* ── CAMERA / WEBXR TRIGGER BUTTON ───────────────────────── */}
      <div className="section">
        {arMode === "gesture" ? (
          <button
            className={`camera-btn ${cameraActive ? "active" : ""}`}
            onClick={onToggleCamera}
          >
            <span>{cameraActive ? "🟢 Tắt Camera trước" : "📷 Bật Camera trước"}</span>
          </button>
        ) : (
          <button
            className={`camera-btn ${xrSessionActive ? "active" : ""}`}
            onClick={onToggleXR}
            disabled={!xrSupported}
            style={!xrSupported ? { opacity: 0.5, cursor: "not-allowed" } : {}}
          >
            <span>
              {xrSessionActive
                ? "🟢 Đang chạy WebXR AR..."
                : xrSupported
                ? "🥽 Bật quét sàn WebXR"
                : "🚫 WebXR không hỗ trợ"}
            </span>
          </button>
        )}
        {!xrSupported && arMode === "webxr" && (
          <div className="error-message" style={{ fontSize: "10px", marginTop: "2px" }}>
            * Chế độ quét sàn (WebXR) chỉ chạy trên Android Chrome có Google Play Services cho AR.
          </div>
        )}
        {cameraError && <div className="error-message">{cameraError}</div>}
      </div>

      {/* ── TAB: BÀI TOÁN (Hiển thị trực tiếp) ───────────────────────── */}
      <div className="section">
        <div className="section-title">Chọn bài toán mẫu</div>

        {/* Dropdown chọn bài */}
        <select
          className="problem-select"
          value={selectedProblemId}
          onChange={(e) => handleLoadProblem(e.target.value)}
        >
          <option value="">-- Chọn bài toán --</option>
          {MOCK_GEOMETRY_PROBLEMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        {/* Divider */}
        <div className="divider">
          <span>hoặc</span>
        </div>

        {/* Upload ảnh đề bài */}
        <button
          className="upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
        >
          <span>📷 Upload ảnh đề bài</span>
          <span className="upload-sub">OCR → LLM → Geometry Engine</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleUploadImage}
        />

        {/* Loading indicator */}
        {isLoading && (
          <div className="loading-bar">
            <div className="loading-inner" />
            <span>Đang phân tích ảnh...</span>
          </div>
        )}

        {/* Error display */}
        {apiError && (
          <div className="error-message">
            ⚠️ {apiError}
          </div>
        )}

        {/* Đang hiển thị bài toán nào */}
        {mode === "custom" && selectedProblemId && (
          <div className="active-problem">
            ✅ Đang hiển thị:{" "}
            <strong>
              {MOCK_GEOMETRY_PROBLEMS.find((p) => p.id === selectedProblemId)?.label}
            </strong>
          </div>
        )}
      </div>

      {/* ── SETTINGS ─────────────────────────────────────────────── */}
      <div className="section">
        {mode === "custom" && (
          <>
            <div className="section-title">Hiển thị toán học</div>
            <div className="toggle-buttons" style={{ marginBottom: 4 }}>
              <button
                className={`toggle-btn ${showEdgeLengths ? "active" : ""}`}
                onClick={toggleEdgeLengths}
                title="Hiện/ẩn độ dài các cạnh"
              >
                📏 Độ dài cạnh
              </button>
              <button
                className={`toggle-btn ${showConstraints ? "active" : ""}`}
                onClick={toggleConstraints}
                title="Hiện/ẩn ký hiệu góc vuông, cạnh bằng"
              >
                ∟ Ký hiệu
              </button>
            </div>
          </>
        )}

        <details className="advanced-settings">
          <summary className="advanced-summary">Tùy chỉnh hiển thị</summary>
          <div className="advanced-content" style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            <div className="control-group">
              <div className="label-row">
                <span>Kích thước</span>
                <span className="value">{size.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={size}
                onChange={(e) => setSize(parseFloat(e.target.value))}
                className="slider"
              />
            </div>

            <div className="control-group">
              <div className="label-row">
                <span>Độ trong suốt</span>
                <span className="value">{(opacity * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="slider"
              />
            </div>

            <div className="toggle-buttons">
              <button
                className={`toggle-btn ${wireframe ? "active" : ""}`}
                onClick={toggleWireframe}
              >
                Wireframe
              </button>
              <button
                className={`toggle-btn ${autoRotate ? "active" : ""}`}
                onClick={toggleAutoRotate}
              >
                Auto Rotate
              </button>
            </div>
          </div>
        </details>
      </div>

      <style>{`
        .ar-controls {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .section-title {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text3);
          font-family: 'Inter', sans-serif;
          font-weight: 600;
        }

        /* ── CAMERA BTN ─────────────────── */
        .camera-btn {
          width: 100%;
          padding: 8px 12px;
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all .2s ease;
        }

        .camera-btn:hover { background: rgba(59, 130, 246, 0.05); border-color: rgba(59, 130, 246, 0.25); }
        .camera-btn.active { background: rgba(16, 185, 129, 0.1); color: var(--green); border-color: rgba(16, 185, 129, 0.3); }

        /* ── ERROR ──────────────────────── */
        .error-message {
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #fca5a5;
          font-size: 11px;
          line-height: 1.4;
        }

        /* ── PROBLEM SELECT ─────────────── */
        .problem-select {
          width: 100%;
          padding: 8px 10px;
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-size: 12px;
          cursor: pointer;
          outline: none;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
        }

        .problem-select:focus { border-color: rgba(59, 130, 246, 0.4); }
        .problem-select option { background: var(--bg2); }

        /* ── DIVIDER ────────────────────── */
        .divider {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text3);
          font-size: 10px;
        }

        .divider::before, .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border);
        }

        /* ── UPLOAD BTN ─────────────────── */
        .upload-btn {
          width: 100%;
          padding: 8px 12px;
          background: var(--bg3);
          border: 1px dashed var(--border);
          border-radius: 8px;
          color: var(--text2);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          transition: all .2s ease;
        }

        .upload-btn:hover { border-color: rgba(59, 130, 246, 0.25); background: rgba(59, 130, 246, 0.04); }
        .upload-sub { font-size: 9px; color: var(--text3); font-family: 'Fira Code', monospace; }

        /* ── LOADING ────────────────────── */
        .loading-bar {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 10px;
          color: var(--text3);
          font-family: 'Fira Code', monospace;
        }

        .loading-inner {
          height: 2px;
          background: linear-gradient(90deg, transparent, var(--cyan), transparent);
          border-radius: 1px;
          animation: shimmer 1.2s infinite;
          background-size: 200% 100%;
        }

        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }

        /* ── ACTIVE PROBLEM ─────────────── */
        .active-problem {
          font-size: 11px;
          color: var(--text2);
          padding: 8px 10px;
          background: rgba(16, 185, 129, 0.05);
          border: 1px solid rgba(16, 185, 129, 0.15);
          border-radius: 8px;
          line-height: 1.4;
        }

        /* ── CONTROLS ───────────────────── */
        .control-group { display: flex; flex-direction: column; gap: 6px; }

        .label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: var(--text2);
        }

        .value { color: var(--cyan); font-family: 'Fira Code', monospace; font-size: 11px; }
        .slider { width: 100%; accent-color: var(--cyan); cursor: pointer; }

        .toggle-buttons { display: flex; gap: 8px; }

        .toggle-btn {
          flex: 1;
          padding: 6px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--bg3);
          color: var(--text2);
          cursor: pointer;
          font-size: 11px;
          transition: all .2s ease;
        }

        .toggle-btn:hover { background: rgba(59, 130, 246, 0.05); border-color: rgba(59, 130, 246, 0.2); }
        .toggle-btn.active { background: rgba(59, 130, 246, 0.1); color: var(--cyan); border-color: rgba(59, 130, 246, 0.3); }

        .advanced-settings {
          margin-top: 10px;
          border-top: 1px solid var(--border);
          padding-top: 10px;
        }

        .advanced-summary {
          font-size: 11px;
          font-weight: 600;
          color: var(--text2);
          cursor: pointer;
          user-select: none;
          outline: none;
          display: flex;
          align-items: center;
          justify-content: space-between;
          list-style: none;
        }

        .advanced-summary::-webkit-details-marker {
          display: none;
        }

        .advanced-summary::after {
          content: '▼';
          font-size: 8px;
          color: var(--text3);
          transition: transform 0.2s ease;
          transform: rotate(-90deg);
        }

        details[open] .advanced-summary::after {
          transform: rotate(0deg);
        }
      `}</style>
    </div>
  );
}
