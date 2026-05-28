"""
GeometryEngine — constraint propagation solver.

Algorithm overview
------------------
1. Fixed-point loop: each pass tries every pending constraint handler.
   A handler returns True (made progress) or False (prerequisites missing).
2. Multi-right-angle detector: when the loop stalls, scan for patterns like
       right_angle [S, A, B]  +  right_angle [S, A, D]
   where S is unknown and A, B, D are placed.  This encodes "SA ⊥ plane(ABD)",
   the most frequent construction in Vietnamese HS geometry.
   → places S on ±normal from A, generates two candidates.
3. Candidate disambiguation: right_angle / angle / distance filters narrow
   multiple candidates; the last is broken by the z-priority heuristic.
4. Post-processing: topology (edges/faces), constraint validation, normalisation.

Supported constraint types
--------------------------
Shape anchors (place from scratch):
  square, rectangle, rhombus, trapezoid, equilateral_triangle,
  isosceles_triangle, right_triangle, regular_tetrahedron, cube,
  rectangular_prism, prism, regular_hexagon, regular_octahedron

Derived points (require prerequisites):
  midpoint, ratio_point, centroid, foot_perpendicular, foot_on_plane,
  perpendicular_to_plane, symmetric, intersection, apex/regular_pyramid/pyramid,
  truncated_pyramid

Filtering / disambiguation:
  right_angle, angle, distance, edge_length, on_line, parallel, perpendicular
"""
from __future__ import annotations

import logging
import numpy as np

from .errors import SolverError
from .handlers import (
    BaseShapeHandlers,
    ConstraintHandlers,
    DerivedPointHandlers,
    SolidShapeHandlers,
    SpecialRuleHandlers,
)
from .models import Constraint, GeometryInput, GeometryOutput, Point3D
from .topology import TopologyBuilder
from .validator import ConstraintValidator
from .normalizer import Normalizer
from .registry import get_handler
from .utils import normalize

logger = logging.getLogger(__name__)


class GeometryEngine(
    BaseShapeHandlers,
    SolidShapeHandlers,
    DerivedPointHandlers,
    SpecialRuleHandlers,
    ConstraintHandlers,
):

    def __init__(self) -> None:
        self.coords: dict[str, np.ndarray] = {}
        self._candidates: dict[str, list[np.ndarray]] = {}
        self._side_length: float = 1.0

    # ── Public API ────────────────────────────────────────────────────────────

    def solve(self, input_data: GeometryInput) -> GeometryOutput:
        self.coords = {}
        self._candidates = {}
        self._side_length = input_data.side_length

        pending = list(input_data.constraints)
        max_iter = len(pending) * 4 + 30

        for _ in range(max_iter):
            if not pending:
                break
            progress, pending = self._one_pass(pending)
            if not progress:
                # Try the perpendicular-system solver first
                if self._try_perpendicular_system(input_data.constraints):
                    continue
                if self._try_equilateral_right_angle_system(input_data.constraints):
                    continue
                if not self._commit_one_candidate():
                    break

        if pending:
            logger.warning("Unresolved constraints: %s", [c.type for c in pending])

        self._commit_all_candidates()

        # Topology
        builder = TopologyBuilder()
        for c in input_data.constraints:
            builder.process(c)
        edges, faces = builder.build()

        # Validation
        violations: list[str] = []
        if input_data.validate_constraints:
            violations = ConstraintValidator(self.coords).validate(input_data.constraints)
            for v in violations:
                logger.warning("Violation: %s", v)

        unresolved = [p for p in input_data.points if p not in self.coords]
        result_points: dict[str, Point3D] = {
            name: Point3D(
                x=round(float(self.coords[name][0]), 10),
                y=round(float(self.coords[name][1]), 10),
                z=round(float(self.coords[name][2]), 10),
            )
            for name in input_data.points
            if name in self.coords
        }

        # Tính toán các thông số meta (chiều cao, diện tích toàn phần, thể tích)
        z_coords = [float(self.coords[name][2]) for name in self.coords]
        height = max(z_coords) - min(z_coords) if z_coords else 0.0

        # Lọc riêng các mặt thuộc hình thể cấu trúc chính để tính thể tích/diện tích mặt ngoài (tránh mặt phẳng cắt phụ trợ)
        struct_builder = TopologyBuilder()
        structural_types = {
            "square", "rectangle", "parallelogram", "rhombus", "trapezoid",
            "equilateral_triangle", "isosceles_triangle", "right_triangle",
            "regular_tetrahedron", "cube", "rectangular_prism", "prism",
            "oblique_prism", "apex", "regular_pyramid", "pyramid",
            "regular_hexagon", "regular_octahedron", "truncated_pyramid",
            "regular_polygon", "right_prism",
        }
        for c in input_data.constraints:
            if c.type in structural_types:
                struct_builder.process(c)
        _, struct_faces = struct_builder.build()

        volume = 0.0
        surface_area = 0.0
        for f in struct_faces:
            face_vertices = f.vertices
            if len(face_vertices) < 3:
                continue
            if any(v not in self.coords for v in face_vertices):
                continue
            try:
                # Diện tích mặt đa giác
                area_vec = np.zeros(3)
                n = len(face_vertices)
                for i in range(n):
                    p1 = self.coords[face_vertices[i]]
                    p2 = self.coords[face_vertices[(i + 1) % n]]
                    area_vec += np.cross(p1, p2)
                surface_area += float(0.5 * np.linalg.norm(area_vec))
                
                # Thể tích hình chóp/lăng trụ (phép tích phân khối diện tích mặt của đa diện đóng)
                v0 = self.coords[face_vertices[0]]
                for i in range(1, len(face_vertices) - 1):
                    v1 = self.coords[face_vertices[i]]
                    v2 = self.coords[face_vertices[i + 1]]
                    volume += np.dot(v0, np.cross(v1, v2)) / 6.0
            except Exception:
                pass

        volume = abs(volume)
        meta_dict = {
            "volume": round(volume, 4),
            "surface_area": round(surface_area, 4),
            "height": round(height, 4),
        }

        output = GeometryOutput(
            points=result_points,
            edges=edges,
            faces=faces,
            unresolved_points=unresolved,
            violations=violations,
            meta=meta_dict,
        )
        if input_data.normalize:
            output = Normalizer().normalize(output)
            # Giữ nguyên meta gốc (trước khi tọa độ bị normalize về đoạn [-1, 1])
            output.meta = meta_dict
        return output

    def solve_json(self, json_str: str) -> dict:
        data = GeometryInput.model_validate_json(json_str)
        return self.solve(data).model_dump()

    # ── Constraint propagation ────────────────────────────────────────────────

    def _one_pass(
        self, pending: list[Constraint]
    ) -> tuple[bool, list[Constraint]]:
        progress = False
        still: list[Constraint] = []
        for c in pending:
            try:
                if self._get_handler(c.type)(c):
                    progress = True
                else:
                    still.append(c)
            except SolverError as exc:
                logger.error("SolverError '%s': %s", c.type, exc)
                still.append(c)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Error '%s': %s", c.type, exc)
                still.append(c)
        return progress, still

    def _get_handler(self, ctype: str):
        return get_handler(self, ctype)

    # ── Candidate management ─────────────────────────────────────────────────

    def _commit_one_candidate(self) -> bool:
        for name, candidates in list(self._candidates.items()):
            if name not in self.coords:
                self.coords[name] = self._best_candidate(candidates)
                del self._candidates[name]
                return True
        return False

    def _commit_all_candidates(self) -> None:
        for name, candidates in list(self._candidates.items()):
            if name not in self.coords:
                self.coords[name] = self._best_candidate(candidates)
        self._candidates.clear()

    @staticmethod
    def _best_candidate(candidates: list[np.ndarray]) -> np.ndarray:
        """Prefer highest z, then y, then x → apex above base."""
        return max(
            candidates,
            key=lambda c: (round(c[2], 8), round(c[1], 8), round(c[0], 8)),
        )

    # ═══════════════════════════════════════════════════════════════════════
    # UTILITIES
    # ═══════════════════════════════════════════════════════════════════════

    @staticmethod
    def _planar_perp(direction: np.ndarray) -> np.ndarray:
        """Unit vector ⊥ direction that stays in XY plane when possible."""
        d = normalize(direction)
        cross = np.cross(d, np.array([0., 0., 1.]))
        if float(np.linalg.norm(cross)) > 1e-8:
            return normalize(cross)
        return np.array([0., 1., 0.])
