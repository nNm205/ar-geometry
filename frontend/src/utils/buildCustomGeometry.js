import * as THREE from "three";

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Tính khoảng cách Euclidean 3D giữa 2 đỉnh
// ─────────────────────────────────────────────────────────────────────────────
export function edgeLength(v1, v2) {
  const dx = v2[0] - v1[0];
  const dy = v2[1] - v1[1];
  const dz = v2[2] - v1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function midpoint3D(v1, v2) {
  return [
    (v1[0] + v2[0]) / 2,
    (v1[1] + v2[1]) / 2,
    (v1[2] + v2[2]) / 2,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Fan triangulation cho convex polygon (mặt > 3 đỉnh)
// ─────────────────────────────────────────────────────────────────────────────
function fanTriangulate(count) {
  const triangles = [];
  for (let i = 1; i < count - 1; i++) {
    triangles.push([0, i, i + 1]);
  }
  return triangles;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalize tọa độ về trung tâm bounding box để hình nằm giữa scene.
// ─────────────────────────────────────────────────────────────────────────────
function computeCenter(vertices) {
  const vals = Object.values(vertices);
  const cx = vals.reduce((s, v) => s + v[0], 0) / vals.length;
  const cy = vals.reduce((s, v) => s + v[1], 0) / vals.length;
  const cz = vals.reduce((s, v) => s + v[2], 0) / vals.length;
  return [cx, cy, cz];
}

function normalizeVertices(vertices) {
  const center = computeCenter(vertices);
  const normalized = {};
  for (const [key, val] of Object.entries(vertices)) {
    normalized[key] = [
      val[0] - center[0],
      val[1] - center[1],
      val[2] - center[2],
    ];
  }
  return normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildEdgeLines: Tách thành 2 pass — nét liền và nét đứt
// Format edge: [p1, p2] hoặc [p1, p2, { hidden: true }]
// ─────────────────────────────────────────────────────────────────────────────
export function buildEdgeLines(geometryData, scaleFactor = 1) {
  const verts = normalizeVertices(geometryData.vertices);
  const solidPositions  = [];
  const dashedPositions = [];

  for (const edge of geometryData.edges) {
    const [p1name, p2name, opts] = edge;
    const isHidden = opts?.hidden === true;

    const v1 = verts[p1name];
    const v2 = verts[p2name];
    if (!v1 || !v2) continue;

    const target = isHidden ? dashedPositions : solidPositions;
    target.push(
      v1[0] * scaleFactor, v1[1] * scaleFactor, v1[2] * scaleFactor,
      v2[0] * scaleFactor, v2[1] * scaleFactor, v2[2] * scaleFactor,
    );
  }

  const group = new THREE.Group();
  group.name = "edges";

  // ── Nét liền ─────────────────────────────────────────────────────────────
  if (solidPositions.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(solidPositions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: "#1a1a1a",
      linewidth: 2,
      transparent: true,
      opacity: 0.95,
    });
    group.add(new THREE.LineSegments(geo, mat));
  }

  // ── Nét đứt ──────────────────────────────────────────────────────────────
  if (dashedPositions.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(dashedPositions, 3));
    
    const mat = new THREE.LineDashedMaterial({
      color: "#1a1a1a",
      dashSize: 0.1,
      gapSize: 0.05,
      transparent: true,
      opacity: 0.8,
    });
    const line = new THREE.LineSegments(geo, mat);
    line.computeLineDistances(); // BẮT BUỘC để LineDashedMaterial hoạt động
    group.add(line);
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildFaceMesh: Tạo THREE.Mesh fill màu trong suốt từ danh sách faces
// ─────────────────────────────────────────────────────────────────────────────
export function buildFaceMesh(geometryData, opacity = 0.15, scaleFactor = 1) {
  const verts = normalizeVertices(geometryData.vertices);
  const positionsArr = [];

  for (const face of geometryData.faces) {
    const faceVerts = face.vertices.map((name) => verts[name]);
    if (faceVerts.some((v) => !v)) continue;

    const triangles = fanTriangulate(faceVerts.length);

    for (const [i0, i1, i2] of triangles) {
      const a = new THREE.Vector3(...faceVerts[i0]);
      const b = new THREE.Vector3(...faceVerts[i1]);
      const c = new THREE.Vector3(...faceVerts[i2]);

      // Render double-sided
      for (const [va, vb, vc] of [[a, b, c], [a, c, b]]) {
        positionsArr.push(
          va.x * scaleFactor, va.y * scaleFactor, va.z * scaleFactor,
          vb.x * scaleFactor, vb.y * scaleFactor, vb.z * scaleFactor,
          vc.x * scaleFactor, vc.y * scaleFactor, vc.z * scaleFactor,
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positionsArr, 3));

  const mat = new THREE.MeshBasicMaterial({
    color: 0x4ea8de,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  return new THREE.Mesh(geo, mat);
}

// ─────────────────────────────────────────────────────────────────────────────
function createDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, 2 * Math.PI);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

export function buildVertexPoints(geometryData, scaleFactor = 1) {
  const verts = normalizeVertices(geometryData.vertices);
  const positions = [];
  const colors = [];

  const defaultColor   = new THREE.Color("#1a1a1a");
  const highlightColor = new THREE.Color("#ef4444");

  for (const [name, pos] of Object.entries(verts)) {
    positions.push(
      pos[0] * scaleFactor,
      pos[1] * scaleFactor,
      pos[2] * scaleFactor,
    );
    const isHighlighted = geometryData.highlights?.includes(name);
    const c = isHighlighted ? highlightColor : defaultColor;
    colors.push(c.r, c.g, c.b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color",    new THREE.Float32BufferAttribute(colors,    3));

  const mat = new THREE.PointsMaterial({
    size: 0.03 * scaleFactor,
    vertexColors: true,
    sizeAttenuation: true,
    map: createDotTexture(),
    transparent: true,
    alphaTest: 0.5,
  });

  return new THREE.Points(geo, mat);
}

// ─────────────────────────────────────────────────────────────────────────────
// buildConstraints: Render ký hiệu hình học
//   - right_angle : hình vuông nhỏ tại đỉnh
//   - equal_edges : dấu tick "/" trên trung điểm cạnh
// ─────────────────────────────────────────────────────────────────────────────
export function buildConstraints(geometryData, scaleFactor = 1) {
  if (!geometryData.constraints?.length) return null;

  const verts = normalizeVertices(geometryData.vertices);
  const group = new THREE.Group();
  group.name = "constraints";

  const WHITE  = 0xffffff;
  const YELLOW = 0xffd700;

  for (const c of geometryData.constraints) {
    // ── Góc vuông: hình vuông nhỏ tại đỉnh ──────────────────────────────
    if (c.type === "right_angle") {
      const vx  = verts[c.vertex];
      const vf  = verts[c.from];
      const vt  = verts[c.to];
      if (!vx || !vf || !vt) continue;

      const origin = new THREE.Vector3(...vx).multiplyScalar(scaleFactor);
      const dirF   = new THREE.Vector3(...vf).multiplyScalar(scaleFactor).sub(origin).normalize();
      const dirT   = new THREE.Vector3(...vt).multiplyScalar(scaleFactor).sub(origin).normalize();

      const sz = 0.12 * scaleFactor; // kích thước hình vuông ký hiệu

      // 4 điểm tạo hình vuông nhỏ trong góc
      const p1 = origin.clone().addScaledVector(dirF, sz);
      const p2 = origin.clone().addScaledVector(dirF, sz).addScaledVector(dirT, sz);
      const p3 = origin.clone().addScaledVector(dirT, sz);

      const positions = new Float32Array([
        p1.x, p1.y, p1.z,
        p2.x, p2.y, p2.z,
        p2.x, p2.y, p2.z,
        p3.x, p3.y, p3.z,
      ]);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

      const mat = new THREE.LineBasicMaterial({ color: WHITE, transparent: true, opacity: 0.8 });
      group.add(new THREE.LineSegments(geo, mat));
    }

    // ── Cạnh bằng nhau: dấu tick "/" trên mỗi cạnh trong nhóm ───────────
    if (c.type === "equal_edges" && c.edges?.length) {
      for (const [p1name, p2name] of c.edges) {
        const v1 = verts[p1name];
        const v2 = verts[p2name];
        if (!v1 || !v2) continue;

        const mid = new THREE.Vector3(
          ((v1[0] + v2[0]) / 2) * scaleFactor,
          ((v1[1] + v2[1]) / 2) * scaleFactor,
          ((v1[2] + v2[2]) / 2) * scaleFactor,
        );

        // Hướng theo cạnh
        const dir = new THREE.Vector3(
          (v2[0] - v1[0]) * scaleFactor,
          (v2[1] - v1[1]) * scaleFactor,
          (v2[2] - v1[2]) * scaleFactor,
        ).normalize();

        // Perp vector: cross với UP, fallback với RIGHT
        let up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(dir.dot(up)) > 0.9) up = new THREE.Vector3(1, 0, 0);
        const perp = dir.clone().cross(up).normalize();

        const tickLen = 0.08 * scaleFactor;
        const tickA = mid.clone().addScaledVector(perp,  tickLen);
        const tickB = mid.clone().addScaledVector(perp, -tickLen);

        const positions = new Float32Array([
          tickA.x, tickA.y, tickA.z,
          tickB.x, tickB.y, tickB.z,
        ]);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

        const mat = new THREE.LineBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.9 });
        group.add(new THREE.LineSegments(geo, mat));
      }
    }
  }

  return group;
}

export function build3DSpriteLabels(geometryData, scaleFactor = 1) {
  const verts = normalizeVertices(geometryData.vertices);
  const group = new THREE.Group();
  group.name = "spriteLabels";

  for (const [name, pos] of Object.entries(verts)) {
    const isHighlighted = geometryData.highlights?.includes(name);

    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 128, 128);

    // Draw solid circle background
    ctx.fillStyle = isHighlighted ? "rgba(239, 68, 68, 0.95)" : "rgba(15, 23, 42, 0.95)";
    ctx.beginPath();
    ctx.arc(64, 64, 45, 0, 2 * Math.PI);
    ctx.fill();

    // Draw crisp white border for contrast
    ctx.strokeStyle = isHighlighted ? "#fca5a5" : "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 6;
    ctx.stroke();

    // Draw text inside
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 52px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      alphaTest: 0.5,
    });

    const sprite = new THREE.Sprite(mat);
    sprite.position.set(
      pos[0] * scaleFactor,
      pos[1] * scaleFactor + 0.12 * scaleFactor, // offset slightly upward
      pos[2] * scaleFactor
    );
    sprite.scale.set(0.24 * scaleFactor, 0.24 * scaleFactor, 1);
    group.add(sprite);
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildCustomGeometry: Entry point chính — trả về group THREE.Group
// chứa mesh + edges (nét liền & đứt) + points + constraints
// ─────────────────────────────────────────────────────────────────────────────
export function buildCustomGeometry(geometryData, options = {}) {
  const {
    opacity      = 0.35,
    scaleFactor  = 1,
    showPoints   = true,
    showConstraints = true,
    show3DLabels = false,
  } = options;

  const group = new THREE.Group();

  const faceMesh = buildFaceMesh(geometryData, opacity, scaleFactor);
  faceMesh.name = "faces";
  group.add(faceMesh);

  const edgeGroup = buildEdgeLines(geometryData, scaleFactor);
  group.add(edgeGroup);

  if (showPoints) {
    const points = buildVertexPoints(geometryData, scaleFactor);
    points.name = "points";
    group.add(points);
  }

  if (showConstraints) {
    const cGroup = buildConstraints(geometryData, scaleFactor);
    if (cGroup) group.add(cGroup);
  }

  if (show3DLabels) {
    const labels = build3DSpriteLabels(geometryData, scaleFactor);
    group.add(labels);
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeLabelPositions: Tính vị trí 3D cho các label đỉnh và cạnh.
// Trả về dữ liệu để ARPage render HTML overlay.
// Độ dài cạnh được TÍNH TOÁN từ tọa độ — không phải từ label backend.
// ─────────────────────────────────────────────────────────────────────────────
export function computeLabelPositions(geometryData, scaleFactor = 1) {
  const verts = normalizeVertices(geometryData.vertices);

  // Labels đỉnh
  const vertexLabels = Object.entries(verts).map(([name, pos]) => ({
    type: "vertex",
    name,
    position: new THREE.Vector3(
      pos[0] * scaleFactor,
      pos[1] * scaleFactor,
      pos[2] * scaleFactor,
    ),
    isHighlighted: geometryData.highlights?.includes(name) || false,
  }));

  // Labels cạnh — chỉ hiện trên cạnh SOLID (không hiện trên nét đứt để tránh rối)
  const edgeLabels = geometryData.edges
    .filter(([, , opts]) => !(opts?.hidden === true))  // bỏ nét đứt
    .map(([p1name, p2name]) => {
      const v1 = verts[p1name];
      const v2 = verts[p2name];
      if (!v1 || !v2) return null;

      const len = edgeLength(v1, v2);
      const mid = midpoint3D(v1, v2);

      return {
        type:     "edge",
        name:     `${p1name}${p2name}`,
        length:   len,
        label:    len.toFixed(2),
        position: new THREE.Vector3(
          mid[0] * scaleFactor,
          mid[1] * scaleFactor,
          mid[2] * scaleFactor,
        ),
      };
    })
    .filter(Boolean);

  return { vertexLabels, edgeLabels };
}
