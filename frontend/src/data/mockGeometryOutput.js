/**
 * Mock output từ Geometry Engine.
 * Sau khi backend sẵn sàng, các file này sẽ được thay bằng response thực từ API.
 *
 * Format chuẩn: GeometryEngineOutput
 * - vertices    : tọa độ tuyệt đối [x, y, z] của từng đỉnh
 * - edges       : [p1, p2, opts?]  — opts.hidden=true → nét đứt
 * - faces       : danh sách mặt (array đỉnh), dùng để fill mesh
 * - constraints : ký hiệu hình học (góc vuông, cạnh bằng, trung điểm)
 * - meta        : thông số tính toán (V, S, h...)
 * - highlights  : tên đỉnh muốn highlight màu đỏ
 */

// ─────────────────────────────────────────────
// 1. CHÓP TAM GIÁC ĐỀU  S.ABC
//    Đáy ABC là tam giác đều cạnh 2, đỉnh S thẳng đứng h=2
//    Góc nhìn chuẩn: nhìn từ phía trước-phải xuống
//    → cạnh CA bị che bởi mặt SAB và mặt đáy → nét đứt
// ─────────────────────────────────────────────
export const PYRAMID_TRIANGLE = {
  id: "pyramid_triangle",
  label: "Chóp tam giác đều S.ABC",
  problem:
    "Cho chóp S.ABC có đáy ABC là tam giác đều cạnh a = 2. Đỉnh S thẳng góc với đáy tại trọng tâm G, chiều cao h = 2.",
  shape_type: "custom_polyhedron",
  color: "#fbbf24",

  vertices: {
    A: [-1, 0, -0.577],
    B: [1, 0, -0.577],
    C: [0, 0, 1.155],
    S: [0, 2, 0],
  },

  edges: [
    ["A", "B"],                       // cạnh đáy AB — thấy được
    ["B", "C"],                       // cạnh đáy BC — thấy được
    ["C", "A", { hidden: true }],     // cạnh đáy CA — bị che → nét đứt
    ["S", "A"],                       // cạnh bên SA
    ["S", "B"],                       // cạnh bên SB
    ["S", "C"],                       // cạnh bên SC
  ],

  faces: [
    { vertices: ["A", "B", "C"], type: "base" },
    { vertices: ["S", "A", "B"], type: "lateral" },
    { vertices: ["S", "B", "C"], type: "lateral" },
    { vertices: ["S", "C", "A"], type: "lateral" },
  ],

  constraints: [
    { type: "equal_edges", edges: [["S","A"], ["S","B"], ["S","C"]], label: "SA=SB=SC" },
    { type: "equal_edges", edges: [["A","B"], ["B","C"], ["C","A"]], label: "a=2" },
  ],

  highlights: ["S"],

  meta: {
    volume: 1.155,
    surface_area: 8.39,
    height: 2.0,
    base_edge: 2.0,
    source: "geometry_engine_mock_v1",
  },
};

// ─────────────────────────────────────────────
// 2. CHÓP TỨ GIÁC ĐỀU  S.ABCD
//    Đáy ABCD là hình vuông cạnh 2, đỉnh S h=2.5
//    → cạnh CD và DA bị che → nét đứt
// ─────────────────────────────────────────────
export const PYRAMID_SQUARE = {
  id: "pyramid_square",
  label: "Chóp tứ giác đều S.ABCD",
  problem:
    "Cho chóp S.ABCD có đáy là hình vuông cạnh a = 2. SA = SB = SC = SD. Chiều cao SO = 2.5 (O là tâm đáy).",
  shape_type: "custom_polyhedron",
  color: "#00e5ff",

  vertices: {
    A: [-1, 0, -1],
    B: [1, 0, -1],
    C: [1, 0, 1],
    D: [-1, 0, 1],
    S: [0, 2.5, 0],
  },

  edges: [
    ["A", "B"],                       // cạnh đáy AB — thấy
    ["B", "C"],                       // cạnh đáy BC — thấy
    ["C", "D", { hidden: true }],     // cạnh đáy CD — bị che → nét đứt
    ["D", "A", { hidden: true }],     // cạnh đáy DA — bị che → nét đứt
    ["S", "A"],
    ["S", "B"],
    ["S", "C"],
    ["S", "D"],
  ],

  faces: [
    { vertices: ["A", "B", "C", "D"], type: "base" },
    { vertices: ["S", "A", "B"], type: "lateral" },
    { vertices: ["S", "B", "C"], type: "lateral" },
    { vertices: ["S", "C", "D"], type: "lateral" },
    { vertices: ["S", "D", "A"], type: "lateral" },
  ],

  constraints: [
    { type: "equal_edges", edges: [["S","A"], ["S","B"], ["S","C"], ["S","D"]], label: "SA=SB=SC=SD" },
    { type: "right_angle", vertex: "A", from: "B", to: "D" },
    { type: "right_angle", vertex: "B", from: "A", to: "C" },
  ],

  highlights: ["S"],

  meta: {
    volume: 3.333,
    surface_area: 17.25,
    height: 2.5,
    base_edge: 2.0,
    source: "geometry_engine_mock_v1",
  },
};

// ─────────────────────────────────────────────
// 3. HÌNH HỘP CHỮ NHẬT  ABCD.A'B'C'D'
//    a=2, b=1.5, c=1.2
//    Nhìn chuẩn: A gần-trái-dưới → A', D', C' bị che
// ─────────────────────────────────────────────
export const RECTANGULAR_BOX = {
  id: "rectangular_box",
  label: "Hình hộp chữ nhật ABCD.A'B'C'D'",
  problem:
    "Cho hình hộp chữ nhật ABCD.A'B'C'D' có AB = 2, AD = 1.5, AA' = 1.2.",
  shape_type: "custom_polyhedron",
  color: "#10ffa0",

  vertices: {
    A:  [0,   0,   0  ],
    B:  [2,   0,   0  ],
    C:  [2,   0,   1.5],
    D:  [0,   0,   1.5],
    "A'": [0,   1.2, 0  ],
    "B'": [2,   1.2, 0  ],
    "C'": [2,   1.2, 1.5],
    "D'": [0,   1.2, 1.5],
  },

  edges: [
    // Đáy dưới
    ["A",  "B" ],
    ["B",  "C" ],
    ["C",  "D",  { hidden: true }],   // bị che
    ["D",  "A",  { hidden: true }],   // bị che
    // Đáy trên
    ["A'", "B'"],
    ["B'", "C'"],
    ["C'", "D'"],
    ["D'", "A'"],
    // Cạnh đứng
    ["A",  "A'"],
    ["B",  "B'"],
    ["C",  "C'"],
    ["D",  "D'", { hidden: true }],   // bị che
  ],

  faces: [
    { vertices: ["A",  "B",  "C",  "D" ], type: "base"    },
    { vertices: ["A'", "B'", "C'", "D'"], type: "top"     },
    { vertices: ["A",  "B",  "B'", "A'"], type: "lateral" },
    { vertices: ["B",  "C",  "C'", "B'"], type: "lateral" },
    { vertices: ["C",  "D",  "D'", "C'"], type: "lateral" },
    { vertices: ["D",  "A",  "A'", "D'"], type: "lateral" },
  ],

  constraints: [
    { type: "right_angle", vertex: "A",  from: "B",  to: "D"  },
    { type: "right_angle", vertex: "A",  from: "B",  to: "A'" },
    { type: "equal_edges", edges: [["A","B"], ["D","C"], ["A'","B'"], ["D'","C'"]], label: "AB=2" },
    { type: "equal_edges", edges: [["A","D"], ["B","C"], ["A'","D'"], ["B'","C'"]], label: "AD=1.5" },
    { type: "equal_edges", edges: [["A","A'"],["B","B'"],["C","C'"],["D","D'"]], label: "AA'=1.2" },
  ],

  highlights: [],

  meta: {
    volume: 3.6,
    surface_area: 16.2,
    height: 1.2,
    diagonal: 2.79,
    source: "geometry_engine_mock_v1",
  },
};

// ─────────────────────────────────────────────
// 4. LĂNG TRỤ TAM GIÁC ĐỀU  ABC.A'B'C'
//    Đáy tam giác đều cạnh 2, chiều cao h=2
//    → cạnh CA và C'A' bị che, cạnh CC' bị che
// ─────────────────────────────────────────────
export const PRISM_TRIANGLE = {
  id: "prism_triangle",
  label: "Lăng trụ tam giác đều ABC.A'B'C'",
  problem:
    "Cho lăng trụ tam giác đều ABC.A'B'C' có cạnh đáy a = 2 và chiều cao h = 2.",
  shape_type: "custom_polyhedron",
  color: "#a855f7",

  vertices: {
    A:  [-1, 0, -0.577],
    B:  [1,  0, -0.577],
    C:  [0,  0,  1.155],
    "A'": [-1, 2, -0.577],
    "B'": [1,  2, -0.577],
    "C'": [0,  2,  1.155],
  },

  edges: [
    // Đáy dưới
    ["A",  "B" ],
    ["B",  "C",  { hidden: true }],   // bị che
    ["C",  "A",  { hidden: true }],   // bị che
    // Đáy trên
    ["A'", "B'"],
    ["B'", "C'"],
    ["C'", "A'"],
    // Cạnh đứng
    ["A",  "A'"],
    ["B",  "B'"],
    ["C",  "C'", { hidden: true }],   // bị che
  ],

  faces: [
    { vertices: ["A",  "B",  "C" ],         type: "base"    },
    { vertices: ["A'", "B'", "C'"],         type: "top"     },
    { vertices: ["A",  "B",  "B'", "A'"],   type: "lateral" },
    { vertices: ["B",  "C",  "C'", "B'"],   type: "lateral" },
    { vertices: ["C",  "A",  "A'", "C'"],   type: "lateral" },
  ],

  constraints: [
    { type: "equal_edges", edges: [["A","B"], ["B","C"], ["C","A"]], label: "a=2" },
    { type: "equal_edges", edges: [["A","A'"],["B","B'"],["C","C'"]], label: "h=2" },
    { type: "right_angle", vertex: "A", from: "B", to: "A'" },
  ],

  highlights: [],

  meta: {
    volume: 3.464,
    surface_area: 15.46,
    height: 2.0,
    base_edge: 2.0,
    source: "geometry_engine_mock_v1",
  },
};

// ─────────────────────────────────────────────
// 5. TỨ DIỆN ĐỀU  ABCD
//    Cạnh a=2
//    → cạnh AB, BC, CA là đáy; D ở đỉnh
//    → cạnh BC bị che → nét đứt
// ─────────────────────────────────────────────
export const TETRAHEDRON = {
  id: "tetrahedron",
  label: "Tứ diện đều ABCD",
  problem: "Cho tứ diện đều ABCD có tất cả các cạnh bằng nhau, a = 2.",
  shape_type: "custom_polyhedron",
  color: "#ff6b35",

  vertices: {
    A: [1,   0,    -0.707],
    B: [-1,  0,    -0.707],
    C: [0,   0,     1.0  ],
    D: [0,   1.633, 0    ],
  },

  edges: [
    ["A", "B"],
    ["B", "C", { hidden: true }],   // cạnh đáy BC bị che → nét đứt
    ["C", "A"],
    ["D", "A"],
    ["D", "B"],
    ["D", "C"],
  ],

  faces: [
    { vertices: ["A", "B", "C"], type: "base"    },
    { vertices: ["D", "A", "B"], type: "lateral" },
    { vertices: ["D", "B", "C"], type: "lateral" },
    { vertices: ["D", "C", "A"], type: "lateral" },
  ],

  constraints: [
    {
      type: "equal_edges",
      edges: [["A","B"],["B","C"],["C","A"],["D","A"],["D","B"],["D","C"]],
      label: "a=2",
    },
  ],

  highlights: [],

  meta: {
    volume: 0.943,
    surface_area: 6.928,
    edge: 2.0,
    source: "geometry_engine_mock_v1",
  },
};

// ─────────────────────────────────────────────
// Export danh sách toàn bộ
// ─────────────────────────────────────────────
export const MOCK_GEOMETRY_PROBLEMS = [
  PYRAMID_TRIANGLE,
  PYRAMID_SQUARE,
  RECTANGULAR_BOX,
  PRISM_TRIANGLE,
  TETRAHEDRON,
];

export default MOCK_GEOMETRY_PROBLEMS;
