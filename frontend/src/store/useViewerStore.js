import { create } from "zustand";
import SHAPES from "../data/shapes";
import MOCK_GEOMETRY_PROBLEMS from "../data/mockGeometryOutput";

const useViewerStore = create((set) => ({
  // ── Chế độ hiển thị ──────────────────────────────────────────
  // 'preset' : Chọn từ danh sách SHAPES có sẵn (cube, sphere...)
  // 'custom' : Render từ Geometry Engine output (JSON tọa độ tuyệt đối)
  mode: "custom",
  setMode: (mode) => set({ mode }),

  // arMode: 'gesture' (Camera trước + Cử chỉ tay) | 'webxr' (Camera sau + WebXR quét sàn)
  arMode: "gesture",
  setArMode: (arMode) => set({ arMode }),

  // ── Preset mode ──────────────────────────────────────────────
  currentShape: SHAPES[0],
  setShape: (shape) =>
    set({
      currentShape: shape,
      mode: "preset",
      geometryData: null,
      size: 1.0,
      opacity: 1.0,
    }),

  // ── Custom mode (Geometry Engine output) ─────────────────────
  geometryData: MOCK_GEOMETRY_PROBLEMS[0],
  setGeometryData: (data) =>
    set({
      geometryData: data,
      mode: "custom",
      size: 1.0,
      opacity: 0.35, // Custom mesh dùng opacity thấp hơn để thấy cạnh
    }),

  isLoading: false,
  apiError: null,
  setIsLoading: (isLoading) => set({ isLoading }),
  setApiError: (apiError) => set({ apiError }),

  // ── Shared settings ───────────────────────────────────────────
  wireframe: false,
  autoRotate: true,
  size: 1.0,
  opacity: 0.35,

  toggleWireframe:   () => set((s) => ({ wireframe:   !s.wireframe   })),
  toggleAutoRotate:  () => set((s) => ({ autoRotate:  !s.autoRotate  })),

  // ── Custom mode display options ────────────────────────────────
  showEdgeLengths:   false,  // hiện nhãn độ dài cạnh trên hình
  showConstraints:   true,   // hiện ký hiệu góc vuông, cạnh bằng

  toggleEdgeLengths:  () => set((s) => ({ showEdgeLengths:  !s.showEdgeLengths  })),
  toggleConstraints:  () => set((s) => ({ showConstraints:  !s.showConstraints  })),

  setSize:    (v) => set({ size:    v }),
  setOpacity: (v) => set({ opacity: v }),

  // ── WebXR Anchoring ───────────────────────────────────────────
  arAnchored: true, // mặc định ghim
  toggleArAnchored: () => set((s) => ({ arAnchored: !s.arAnchored })),
}));

export default useViewerStore;
