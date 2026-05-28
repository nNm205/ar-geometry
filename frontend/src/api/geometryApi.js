import MOCK_GEOMETRY_PROBLEMS from "../data/mockGeometryOutput";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

/**
 * Thuật toán giao điểm Tia - Tam giác (Möller–Trumbore)
 * Dùng để kiểm tra xem một tia từ Camera đến trung điểm cạnh có bị che bởi mặt nào không.
 */
function rayTriangleIntersect(origin, dir, p0, p1, p2) {
  const EPSILON = 0.0000001;
  const edge1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const edge2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  
  const h = [
    dir[1] * edge2[2] - dir[2] * edge2[1],
    dir[2] * edge2[0] - dir[0] * edge2[2],
    dir[0] * edge2[1] - dir[1] * edge2[0]
  ];
  const a = edge1[0] * h[0] + edge1[1] * h[1] + edge1[2] * h[2];
  if (a > -EPSILON && a < EPSILON) return false; // Tia song song mặt phẳng
  
  const f = 1.0 / a;
  const s = [origin[0] - p0[0], origin[1] - p0[1], origin[2] - p0[2]];
  const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
  if (u < 0.0 || u > 1.0) return false;
  
  const q = [
    s[1] * edge1[2] - s[2] * edge1[1],
    s[2] * edge1[0] - s[0] * edge1[2],
    s[0] * edge1[1] - s[1] * edge1[0]
  ];
  const v = f * (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]);
  if (v < 0.0 || u + v > 1.0) return false;
  
  // Tỷ lệ t trên tia từ origin đến target.
  // 0.05 < t < 0.95 để bỏ qua việc tự giao nhau sát đầu mút/cạnh.
  const t = f * (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]);
  if (t > 0.05 && t < 0.95) return true;
  return false;
}

/**
 * Chuyển đổi định dạng output từ Backend (GeometryOutput) về định dạng Frontend (GeometryEngineOutput).
 * Đồng thời tự động phát hiện nét đứt (hidden edges) từ góc nhìn camera tiêu chuẩn.
 */
export function adaptBackendResponse(backendData, problemText = "") {
  if (!backendData) return null;

  // 1. Ánh xạ points: backend (Z-up) -> frontend (Y-up cho Three.js)
  // x_front = x_back, y_front = z_back, z_front = y_back
  const vertices = {};
  if (backendData.points) {
    for (const [name, pt] of Object.entries(backendData.points)) {
      vertices[name] = [pt.x, pt.z, pt.y];
    }
  }

  // 2. Định hình danh sách mặt phẳng (faces)
  // Phân loại "base" (mặt đáy) nếu toàn bộ đỉnh có cao độ (y_front) nằm ở mức thấp nhất
  let minY = Infinity;
  Object.values(vertices).forEach(v => {
    if (v[1] < minY) minY = v[1];
  });

  const faces = (backendData.faces || []).map(f => {
    const isBase = f.vertices.every(v => vertices[v] && Math.abs(vertices[v][1] - minY) < 0.1);
    return {
      vertices: f.vertices,
      type: isBase ? "base" : "lateral"
    };
  });

  // 3. Tính toán nét đứt (Hidden Edges) từ góc nhìn chuẩn của sách giáo khoa
  // Vị trí camera chuẩn: góc nhìn nghiêng từ phía trước-phải-trên xuống
  const O = [2.0, 1.5, 4.0];
  const edges = (backendData.edges || []).map(e => {
    const p1name = e.p1;
    const p2name = e.p2;
    const v1 = vertices[p1name];
    const v2 = vertices[p2name];
    
    if (!v1 || !v2) return [p1name, p2name, { hidden: false }];

    // Trung điểm của cạnh làm điểm đích của tia kiểm tra
    const M = [(v1[0] + v2[0]) / 2, (v1[1] + v2[1]) / 2, (v1[2] + v2[2]) / 2];
    const dir = [M[0] - O[0], M[1] - O[1], M[2] - O[2]];

    // Quét qua các mặt, kiểm tra xem có mặt nào cản giữa camera và trung điểm M không
    let isHidden = false;
    for (const face of faces) {
      // Bỏ qua mặt phẳng nếu cạnh này thuộc chính mặt phẳng đó
      // (đã được lọc một phần bởi t < 0.95 ở thuật toán giao điểm, nhưng guard thêm để chắc chắn)
      const faceVertNames = face.vertices;
      if (faceVertNames.includes(p1name) && faceVertNames.includes(p2name)) {
        continue;
      }

      const faceVerts = faceVertNames.map(name => vertices[name]);
      if (faceVerts.some(v => !v)) continue;

      // Triangulate mặt phẳng đa giác thành các tam giác nhỏ để kiểm tra
      for (let i = 1; i < faceVerts.length - 1; i++) {
        if (rayTriangleIntersect(O, dir, faceVerts[0], faceVerts[i], faceVerts[i + 1])) {
          isHidden = true;
          break;
        }
      }
      if (isHidden) break;
    }

    return [p1name, p2name, { hidden: isHidden }];
  });

  // 4. Các thông số phụ trợ bổ sung
  return {
    id: backendData.id || `custom_${Date.now()}`,
    label: backendData.label || "Hình vẽ từ đề bài",
    problem: backendData.ocr_text || problemText,
    solution: backendData.solution || null,
    shape_type: "custom_polyhedron",
    color: "#00e5ff",
    vertices,
    edges,
    faces,
    highlights: backendData.highlights || [],
    constraints: backendData.constraints || [],
    meta: backendData.meta || {
      source: "geometry_engine_v1"
    }
  };
}

/**
 * Phân tích ảnh đề bài qua OCR → LLM → Geometry Engine thực tế.
 *
 * @param {File} imageFile - File ảnh từ input upload
 * @returns {Promise<GeometryEngineOutput>}
 */
export async function analyzeImageProblem(imageFile) {
  const formData = new FormData();
  formData.append("image", imageFile);

  const res = await fetch(`${API_BASE}/solve-image`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || "Lỗi phân tích đề toán từ máy chủ AI");
  }

  const backendData = await res.json();
  
  // OCR text có thể không đi kèm trong response thô, ta lấy tạm thời từ label hoặc để trống
  return adaptBackendResponse(backendData, "Bài toán hình học từ hình ảnh tải lên");
}

/**
 * Lấy danh sách các bài toán mẫu có sẵn.
 *
 * @returns {Promise<GeometryEngineOutput[]>}
 */
export async function fetchProblems() {
  // Trả về mock data để kiểm thử nhanh
  return MOCK_GEOMETRY_PROBLEMS;
}

/**
 * Lấy một bài toán theo ID.
 *
 * @param {string} id - ID của bài toán (e.g. "pyramid_square")
 * @returns {Promise<GeometryEngineOutput>}
 */
export async function fetchProblemById(id) {
  const found = MOCK_GEOMETRY_PROBLEMS.find((p) => p.id === id);
  if (!found) throw new Error(`Không tìm thấy bài toán với id: ${id}`);
  return found;
}

