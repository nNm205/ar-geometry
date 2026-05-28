"""
TopologyBuilder — derives structural edges and polygon faces from constraints.

Unity rendering needs:
  • edges  → LineRenderer (cạnh)
  • faces  → Mesh (mặt phẳng)

Each constraint type knows what edges and faces it contributes.
Derived points (midpoint, ratio_point, foot_perpendicular) are not structural
and produce no edges or faces.
"""
from __future__ import annotations

from .models import Constraint, Edge, Face


class TopologyBuilder:
    """
    Walk the constraint list and collect every structural edge and polygon face.

    Usage::

        builder = TopologyBuilder()
        for c in constraints:
            builder.process(c)
        edges, faces = builder.build()
    """

    def __init__(self) -> None:
        self._edge_set: set[tuple[str, str]] = set()
        self._faces: list[list[str]] = []
        self._face_keys: set[frozenset[str]] = set()  # for de-duplication
        self._constraints: list[Constraint] = []

    # ── Public ────────────────────────────────────────────────────────────────

    def process(self, constraint: Constraint) -> None:
        """Extract topology from a single constraint."""
        self._constraints.append(constraint)

    def build(self) -> tuple[list[Edge], list[Face]]:
        """Return de-duplicated edge and face lists after a two-pass topology generation."""
        structural_types = {
            "square", "rectangle", "parallelogram", "rhombus", "trapezoid",
            "equilateral_triangle", "isosceles_triangle", "right_triangle",
            "regular_tetrahedron", "cube", "rectangular_prism", "prism",
            "oblique_prism", "apex", "regular_pyramid", "pyramid",
            "regular_hexagon", "regular_octahedron", "truncated_pyramid",
            "regular_polygon", "right_prism",
        }

        # Pass 1: Structural shape constraints first
        for c in self._constraints:
            if c.type in structural_types:
                self._process_single(c)

        # Pass 2: Auxiliary and derived point constraints second
        for c in self._constraints:
            if c.type not in structural_types:
                self._process_single(c)

        edges = [Edge(p1=a, p2=b) for a, b in sorted(self._edge_set)]
        faces = [Face(vertices=f) for f in self._faces]
        return edges, faces

    def _process_single(self, constraint: Constraint) -> None:
        """Process a single constraint."""
        handler = {
            "square":                self._topo_quad,
            "rectangle":             self._topo_quad,
            "parallelogram":         self._topo_quad,
            "rhombus":               self._topo_quad,
            "trapezoid":             self._topo_quad,
            "equilateral_triangle":  self._topo_triangle,
            "isosceles_triangle":    self._topo_triangle,
            "right_triangle":        self._topo_triangle,
            "regular_tetrahedron":   self._topo_tetrahedron,
            "cube":                  self._topo_cube,
            "rectangular_prism":     self._topo_cube,
            "prism":                 self._topo_prism,
            "oblique_prism":         self._topo_prism,
            "apex":                  self._topo_pyramid,
            "regular_pyramid":       self._topo_pyramid,
            "pyramid":               self._topo_pyramid,
            "regular_hexagon":       self._topo_hexagon,
            "regular_octahedron":    self._topo_octahedron,
            "truncated_pyramid":     self._topo_truncated_pyramid,
            "regular_polygon":       self._topo_regular_polygon,
            "right_prism":           self._topo_right_prism,
            "midpoint":              self._topo_midpoint,
            "ratio_point":           self._topo_ratio_point,
            "centroid":              self._topo_centroid,
            "circumcenter":          self._topo_triangle_center,
            "orthocenter":           self._topo_triangle_center,
            "incenter":              self._topo_triangle_center,
            "equidistant":           self._topo_equidistant,
            "angle_bisector":        self._topo_angle_bisector,
            "median":                self._topo_median,
            "foot_perpendicular":    self._topo_foot_perpendicular,
            "foot_on_plane":         self._topo_foot_on_plane,
            "perpendicular_to_plane":self._topo_perpendicular_to_plane,
            "symmetric":             self._topo_symmetric,
            "intersection":          self._topo_intersection,
            "coplanar":              self._topo_regular_polygon,
        }.get(constraint.type)
        if handler:
            handler(constraint)

    # ── Topology handlers ─────────────────────────────────────────────────────

    def _topo_quad(self, c: Constraint) -> None:
        """Square / rectangle / rhombus / trapezoid: 4-gon."""
        pts = c.points or []
        if len(pts) < 4:
            return
        A, B, C, D = pts[:4]
        for p, q in [(A, B), (B, C), (C, D), (D, A)]:
            self._add_edge(p, q)
        self._add_face([A, B, C, D])

    def _topo_triangle(self, c: Constraint) -> None:
        """Equilateral / isosceles / right triangle: 3-gon."""
        pts = c.points or []
        if len(pts) < 3:
            return
        P, Q, R = pts[:3]
        for p, q in [(P, Q), (Q, R), (R, P)]:
            self._add_edge(p, q)
        self._add_face([P, Q, R])

    def _topo_tetrahedron(self, c: Constraint) -> None:
        """Regular tetrahedron: 6 edges, 4 triangular faces."""
        pts = c.points or []
        if len(pts) != 4:
            return
        A, B, C, D = pts
        # All 6 edges
        for i, p in enumerate(pts):
            for q in pts[i + 1:]:
                self._add_edge(p, q)
        # 4 triangular faces (CCW from outside)
        self._add_face([A, B, C])
        self._add_face([A, D, B])
        self._add_face([B, D, C])
        self._add_face([A, C, D])

    def _topo_cube(self, c: Constraint) -> None:
        """Cube / rectangular prism: 12 edges, 6 quad faces."""
        pts = c.points or []
        if len(pts) != 8:
            return
        A, B, C, D, E, F, G, H = pts
        # Bottom face ABCD
        for p, q in [(A, B), (B, C), (C, D), (D, A)]:
            self._add_edge(p, q)
        self._add_face([A, B, C, D])
        # Top face EFGH (E above A, F above B, …)
        for p, q in [(E, F), (F, G), (G, H), (H, E)]:
            self._add_edge(p, q)
        self._add_face([E, F, G, H])
        # Vertical edges
        for p, q in [(A, E), (B, F), (C, G), (D, H)]:
            self._add_edge(p, q)
        # 4 lateral faces
        self._add_face([A, B, F, E])
        self._add_face([B, C, G, F])
        self._add_face([C, D, H, G])
        self._add_face([D, A, E, H])

    def _topo_prism(self, c: Constraint) -> None:
        """Triangular prism: 9 edges, 5 faces (2 triangles + 3 quads)."""
        pts = c.points or []
        if len(pts) != 6:
            return
        A, B, C, D, E, F = pts
        # Base triangle ABC
        for p, q in [(A, B), (B, C), (C, A)]:
            self._add_edge(p, q)
        self._add_face([A, B, C])
        # Top triangle DEF
        for p, q in [(D, E), (E, F), (F, D)]:
            self._add_edge(p, q)
        self._add_face([D, E, F])
        # Lateral edges
        for p, q in [(A, D), (B, E), (C, F)]:
            self._add_edge(p, q)
        # Lateral quad faces
        self._add_face([A, B, E, D])
        self._add_face([B, C, F, E])
        self._add_face([C, A, D, F])

    def _topo_pyramid(self, c: Constraint) -> None:
        """
        Pyramid / apex: apex is point (if specified) or points[0], base is points[1:] (or points).
        Generates lateral edges, base polygon, and triangular lateral faces.
        """
        pts = c.points or []
        if c.point:
            apex = c.point
            base = pts
        else:
            if len(pts) < 4:
                return
            apex = pts[0]
            base = pts[1:]
        n = len(base)

        # Lateral edges (apex → each base vertex)
        for p in base:
            self._add_edge(apex, p)

        # Base polygon edges and face
        for i in range(n):
            self._add_edge(base[i], base[(i + 1) % n])
        self._add_face(base[:])

        # Triangular lateral faces
        for i in range(n):
            self._add_face([apex, base[i], base[(i + 1) % n]])

    def _topo_hexagon(self, c: Constraint) -> None:
        """Regular hexagon: 6 edges forming a ring, 1 hexagonal face."""
        pts = c.points or []
        if len(pts) != 6:
            return
        for i in range(6):
            self._add_edge(pts[i], pts[(i + 1) % 6])
        self._add_face(list(pts))

    def _topo_octahedron(self, c: Constraint) -> None:
        """Regular octahedron: 12 edges, 8 triangular faces."""
        pts = c.points or []
        if len(pts) != 6:
            return
        T, B, E1, E2, E3, E4 = pts
        equator = [E1, E2, E3, E4]
        # Equatorial ring
        for i in range(4):
            self._add_edge(equator[i], equator[(i + 1) % 4])
        # Top and bottom spokes
        for e in equator:
            self._add_edge(T, e)
            self._add_edge(B, e)
        # 8 triangular faces
        for i in range(4):
            e_cur = equator[i]
            e_nxt = equator[(i + 1) % 4]
            self._add_face([T, e_cur, e_nxt])
            self._add_face([B, e_nxt, e_cur])

    def _topo_truncated_pyramid(self, c: Constraint) -> None:
        """
        Truncated pyramid: points = [base1..baseN, top1..topN].
        Generates base polygon, top polygon, and N lateral quad faces.
        """
        pts = c.points or []
        if len(pts) < 4 or len(pts) % 2 != 0:
            return
        n = len(pts) // 2
        base = pts[:n]
        top  = pts[n:]
        # Base polygon
        for i in range(n):
            self._add_edge(base[i], base[(i + 1) % n])
        self._add_face(list(base))
        # Top polygon
        for i in range(n):
            self._add_edge(top[i], top[(i + 1) % n])
        self._add_face(list(top))
        # Lateral edges and quad faces
        for i in range(n):
            self._add_edge(base[i], top[i])
            self._add_face([base[i], base[(i + 1) % n], top[(i + 1) % n], top[i]])

    def _topo_regular_polygon(self, c: Constraint) -> None:
        """Đa giác đều n cạnh: n cạnh + 1 mặt n-giác."""
        pts = c.points or []
        n = len(pts)
        if n < 3:
            return
        for i in range(n):
            self._add_edge(pts[i], pts[(i + 1) % n])
        self._add_face(list(pts))

    def _topo_right_prism(self, c: Constraint) -> None:
        """
        Lăng trụ đứng n-giác: 3n cạnh, n+2 mặt (2 n-giác + n tứ giác).
        points = [A1..An, B1..Bn].
        """
        pts = c.points or []
        if len(pts) < 4 or len(pts) % 2 != 0:
            return
        n = len(pts) // 2
        base = pts[:n]
        top  = pts[n:]
        # Đáy dưới
        for i in range(n):
            self._add_edge(base[i], base[(i + 1) % n])
        self._add_face(list(base))
        # Đáy trên
        for i in range(n):
            self._add_edge(top[i], top[(i + 1) % n])
        self._add_face(list(top))
        # Cạnh bên + mặt bên
        for i in range(n):
            self._add_edge(base[i], top[i])
            self._add_face([base[i], base[(i + 1) % n], top[(i + 1) % n], top[i]])

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _add_edge(self, p1: str, p2: str) -> None:
        """Add an undirected edge (de-duplicated)."""
        key = (min(p1, p2), max(p1, p2))
        self._edge_set.add(key)

    def _remove_edge(self, p1: str, p2: str) -> None:
        """Remove an undirected edge if it exists."""
        key = (min(p1, p2), max(p1, p2))
        self._edge_set.discard(key)

    def _add_face(self, pts: list[str]) -> None:
        key = frozenset(pts)
        if key not in self._face_keys:
            self._face_keys.add(key)
            self._faces.append(list(pts))

    # ── Derived/Auxiliary point topology handlers ─────────────────────────────

    def _topo_midpoint(self, c: Constraint) -> None:
        J = c.point
        seg = c.segment or []
        if not J or len(seg) != 2:
            return
        P, Q = seg
        self._remove_edge(P, Q)
        self._add_edge(P, J)
        self._add_edge(J, Q)

    def _topo_ratio_point(self, c: Constraint) -> None:
        G = c.point
        seg = c.segment or []
        if not G or len(seg) != 2:
            return
        A, B = seg
        self._remove_edge(A, B)
        self._add_edge(A, G)
        self._add_edge(G, B)

    def _topo_centroid(self, c: Constraint) -> None:
        G = c.point
        ref = c.points or []
        if not G or not ref:
            return
        for p in ref:
            self._add_edge(p, G)

    def _topo_triangle_center(self, c: Constraint) -> None:
        O = c.point
        pts = c.points or []
        if not O or len(pts) != 3:
            return
        for p in pts:
            self._add_edge(p, O)

    def _topo_equidistant(self, c: Constraint) -> None:
        O = c.point
        pts = c.points or []
        if not O or not pts:
            return
        for p in pts:
            self._add_edge(p, O)

    def _topo_angle_bisector(self, c: Constraint) -> None:
        D = c.point
        pts = c.points or []
        if not D or len(pts) != 3:
            return
        A, B, C = pts
        self._remove_edge(A, C)
        self._add_edge(A, D)
        self._add_edge(D, C)
        self._add_edge(B, D)

    def _topo_median(self, c: Constraint) -> None:
        M = c.point
        pts = c.points or []
        if not M or len(pts) != 3:
            return
        A, B, C = pts
        self._remove_edge(B, C)
        self._add_edge(B, M)
        self._add_edge(M, C)
        self._add_edge(A, M)

    def _topo_foot_perpendicular(self, c: Constraint) -> None:
        H = c.point
        S = c.from_point
        seg = c.segment or []
        if not H or not S or len(seg) != 2:
            return
        A, B = seg
        self._remove_edge(A, B)
        self._add_edge(A, H)
        self._add_edge(B, H)
        self._add_edge(S, H)

    def _topo_foot_on_plane(self, c: Constraint) -> None:
        H = c.point
        S = c.from_point
        if not H or not S:
            return
        self._add_edge(S, H)

    def _topo_perpendicular_to_plane(self, c: Constraint) -> None:
        S = c.point
        A = c.from_point
        if not S or not A:
            return
        self._add_edge(S, A)

    def _topo_symmetric(self, c: Constraint) -> None:
        Pp = c.point
        P = c.from_point
        ref = c.points or []
        if not Pp or not P or not ref:
            return
        if len(ref) == 1:
            M = ref[0]
            self._add_edge(P, M)
            self._add_edge(M, Pp)
        else:
            self._add_edge(P, Pp)

    def _topo_intersection(self, c: Constraint) -> None:
        I = c.point
        seg = c.segment or []
        ref = c.points or []
        if not I or len(seg) != 2:
            return
        A, B = seg
        self._remove_edge(A, B)
        self._add_edge(A, I)
        self._add_edge(B, I)
        if len(ref) == 2:
            C, D = ref
            self._remove_edge(C, D)
            self._add_edge(C, I)
            self._add_edge(D, I)
