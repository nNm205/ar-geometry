import { useState, useEffect } from "react";
import useViewerStore from "../../store/useViewerStore";

export default function Navbar({ cameraActive = false, xrSessionActive = false }) {
  const { mode, geometryData, currentShape } = useViewerStore();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const activeTitle = mode === "custom"
    ? (geometryData?.label || "Bài toán hình học")
    : (currentShape?.name || "Hình mẫu 3D");

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // Trạng thái AR hiển thị
  let statusText = "AR Ngoại tuyến";
  let statusDotColor = "var(--text3)";
  if (xrSessionActive) {
    statusText = "WebXR Quét sàn";
    statusDotColor = "var(--cyan)";
  } else if (cameraActive) {
    statusText = "Camera Cử chỉ";
    statusDotColor = "var(--green)";
  }

  return (
    <nav style={styles.nav}>
      {/* Left: Breadcrumbs */}
      <div style={styles.breadcrumbs}>
        <span style={styles.breadcrumbFolder}>Hình học Không gian</span>
        <span style={styles.breadcrumbSeparator}>/</span>
        <span style={styles.breadcrumbPage}>Giải toán & AR</span>
      </div>

      {/* Center: Active Title */}
      <div style={styles.activeTitleContainer}>
        <span style={styles.activeTitleDot}>•</span>
        <span style={styles.activeTitleText}>{activeTitle}</span>
      </div>

      {/* Right: Status & Utilities */}
      <div style={styles.rightSection}>
        <div style={styles.statusBadge}>
          <span style={{ ...styles.statusDot, background: statusDotColor }} />
          <span style={styles.statusText}>{statusText}</span>
        </div>

        <button
          onClick={toggleFullscreen}
          style={styles.utilBtn}
          title={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
        >
          {isFullscreen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
          )}
        </button>
      </div>
    </nav>
  );
}

const styles = {
  nav: {
    height: "52px",
    background: "var(--card)",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 20px",
    fontFamily: "'Inter', sans-serif",
    userSelect: "none",
  },
  breadcrumbs: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
    fontWeight: 500,
  },
  breadcrumbFolder: {
    color: "var(--text3)",
  },
  breadcrumbSeparator: {
    color: "var(--border2)",
  },
  breadcrumbPage: {
    color: "var(--text2)",
  },
  activeTitleContainer: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    background: "rgba(255, 255, 255, 0.02)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "4px 10px",
    fontSize: "12px",
    fontWeight: 600,
  },
  activeTitleDot: {
    color: "var(--cyan)",
    fontSize: "14px",
    lineHeight: "1",
  },
  activeTitleText: {
    color: "var(--text)",
  },
  rightSection: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  statusBadge: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    borderRadius: "6px",
    background: "rgba(255, 255, 255, 0.02)",
    border: "1px solid var(--border)",
  },
  statusDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    transition: "background 0.3s ease",
  },
  statusText: {
    fontSize: "11px",
    fontWeight: 500,
    color: "var(--text2)",
  },
  utilBtn: {
    background: "rgba(255, 255, 255, 0.02)",
    border: "1px solid var(--border)",
    color: "var(--text2)",
    borderRadius: "6px",
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
};
