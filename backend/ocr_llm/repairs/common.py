"""Common repair orchestration and schema-level cleanup for LLM payloads.

These rules are intentionally conservative: they fix field placement, numeric
normalisation, derived point syntax, and dispatch problem-family repairs without
changing the public GeometryInput schema.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any


def _repair_geometry_payload(
    payload: dict[str, Any] | str,
    problem_text: str,
) -> dict[str, Any] | str:
    """Repair common LLM field-mapping mistakes before Pydantic validation."""
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return payload
    if not isinstance(payload, dict):
        return payload

    constraints = payload.get("constraints")
    if not isinstance(constraints, list):
        return payload

    _normalize_apex_constraints(constraints)
    _repair_list_based_midpoints_and_centroids(constraints, problem_text)
    _repair_text_based_midpoints_and_centroids(constraints, problem_text)
    _remove_shape_constraints_on_derived_points(constraints)
    _repair_centroid_constraints(constraints)
    _repair_ratio_point_constraints(constraints)
    _repair_intersection_constraints(constraints, problem_text)
    _repair_perpendicular_constraints(constraints, problem_text)
    from .pyramids import _repair_dihedral_constraints, _repair_equal_side_face_angle_constraints
    from .prisms import _repair_oblique_triangular_prism_constraints, _repair_right_triangular_prism_constraints

    _repair_dihedral_constraints(constraints, problem_text)
    _normalize_numeric_fields(payload)
    _repair_right_triangle_vertex(constraints, problem_text)
    _repair_right_triangle_lengths(constraints)
    _repair_right_triangular_prism_constraints(constraints, payload, problem_text)
    _repair_equal_side_face_angle_constraints(constraints, problem_text)
    _repair_oblique_triangular_prism_constraints(constraints, payload, problem_text)

    pyramid = _extract_pyramid(problem_text)
    if pyramid:
        apex, base = pyramid
        if _mentions_parallelogram_base(problem_text) and not _has_constraint(
            constraints, "parallelogram", base
        ):
            constraints.insert(0, {"type": "parallelogram", "points": base})
        
        # Sửa hoặc điền thêm points vào các constraint apex/pyramid/regular_pyramid bị thiếu points
        repaired_apex = False
        for c in constraints:
            if not isinstance(c, dict):
                continue
            if c.get("type") in ("apex", "pyramid", "regular_pyramid"):
                if not c.get("points"):
                    c["points"] = [apex, *base]
                repaired_apex = True
                
        if not repaired_apex:
            insert_at = 1 if _has_constraint(constraints, "parallelogram", base) else 0
            constraints.insert(insert_at, {"type": "apex", "points": [apex, *base]})

    prism = _extract_prism(problem_text)
    if prism:
        base, top = prism
        for c in constraints:
            if not isinstance(c, dict):
                continue
            if c.get("type") in ("prism", "right_prism", "oblique_prism"):
                if not c.get("points"):
                    c["points"] = [*base, *top]

    _add_coplanar_constraints_for_sub_shapes(constraints, problem_text)
    payload["constraints"] = _sort_constraints(constraints)
    return payload


def _extract_prism(problem_text: str) -> tuple[list[str], list[str]] | None:
    # Lăng trụ ABC.A'B'C' hoặc lăng trụ đứng ABC.A'B'C'
    normalized = _normalize_math_text(problem_text)
    match = re.search(
        r"lăng\s+trụ\s*(?:đứng|xiên|tam\s+giác|tứ\s+giác)?\s*([A-Z]{3,8})\s*\.\s*([A-Z'’]{3,16})",
        normalized,
        re.IGNORECASE
    )
    if not match:
        return None
    base_str = match.group(1)
    top_str = match.group(2)
    top_pts = []
    i = 0
    while i < len(top_str):
        char = top_str[i]
        if i + 1 < len(top_str) and top_str[i + 1] in ("'", "’"):
            top_pts.append(char + "'")
            i += 2
        else:
            top_pts.append(char + "'")
            i += 1
    return list(base_str), top_pts




def _normalize_numeric_fields(payload: dict[str, Any]) -> None:
    for field in ("side_length",):
        if field in payload:
            val = _coerce_numeric_value(payload[field])
            if isinstance(val, (int, float)):
                payload[field] = val
            else:
                payload.pop(field, None)

    constraints = payload.get("constraints")
    if not isinstance(constraints, list):
        return
    for constraint in constraints:
        if not isinstance(constraint, dict):
            continue
        for field in ("length", "width", "height", "ratio", "degrees"):
            if field in constraint:
                val = _coerce_numeric_value(constraint[field])
                if isinstance(val, (int, float)):
                    constraint[field] = val
                else:
                    constraint.pop(field, None)




def _coerce_numeric_value(value: Any) -> Any:
    if isinstance(value, (int, float)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        if len(value) == 2:
            try:
                num = _coerce_numeric_value(value[0])
                denom = _coerce_numeric_value(value[1])
                if isinstance(num, (int, float)) and isinstance(denom, (int, float)) and abs(denom) > 1e-12:
                    return num / denom
            except Exception:
                pass
        elif len(value) == 1:
            return _coerce_numeric_value(value[0])
        return value

    if not isinstance(value, str):
        return value

    cleaned = value.strip().lower().replace(" ", "")
    cleaned = cleaned.replace("$", "")
    cleaned = cleaned.replace("{", "").replace("}", "")

    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", cleaned):
        return float(cleaned)
    if cleaned == "a":
        return 1.0

    # Support plain fractions in string format, e.g. "1/3" or "2/5"
    match = re.fullmatch(r"([+-]?\d+(?:\.\d+)?)/([+-]?\d+(?:\.\d+)?)", cleaned)
    if match:
        numerator = float(match.group(1))
        denominator = float(match.group(2))
        if abs(denominator) > 1e-12:
            return numerator / denominator

    match = re.fullmatch(r"a(?:√|sqrt)([+-]?\d+(?:\.[0-9]+)?)", cleaned)
    if match:
        return math.sqrt(float(match.group(1)))

    match = re.fullmatch(r"([+-]?\d+(?:\.[0-9]+)?)a(?:√|sqrt)([+-]?\d+(?:\.[0-9]+)?)", cleaned)
    if match:
        return float(match.group(1)) * math.sqrt(float(match.group(2)))

    match = re.fullmatch(r"([+-]?\d+(?:\.[0-9]+)?)a", cleaned)
    if match:
        return float(match.group(1))

    match = re.fullmatch(r"a/([+-]?\d+(?:\.[0-9]+)?)", cleaned)
    if match:
        denominator = float(match.group(1))
        if abs(denominator) > 1e-12:
            return 1.0 / denominator

    match = re.fullmatch(r"([+-]?\d+(?:\.[0-9]+)?)/a", cleaned)
    if match:
        return float(match.group(1))

    match = re.fullmatch(r"([+-]?\d+(?:\.[0-9]+)?)\*?a/([+-]?\d+(?:\.[0-9]+)?)", cleaned)
    if match:
        denominator = float(match.group(2))
        if abs(denominator) > 1e-12:
            return float(match.group(1)) / denominator

    return value




def _repair_right_triangle_lengths(constraints: list[dict[str, Any]]) -> None:
    right_triangle = next(
        (
            constraint
            for constraint in constraints
            if isinstance(constraint, dict) and constraint.get("type") == "right_triangle"
        ),
        None,
    )
    if right_triangle is None:
        return

    pts = right_triangle.get("points") or []
    if len(pts) != 3:
        return
    right_vertex, p_name, q_name = pts

    edge_lengths: dict[frozenset[str], float] = {}
    remaining_constraints: list[dict[str, Any]] = []
    for constraint in constraints:
        if constraint is right_triangle:
            continue
        if (
            isinstance(constraint, dict)
            and constraint.get("type") == "edge_length"
            and isinstance(constraint.get("segment"), list)
            and len(constraint["segment"]) == 2
            and isinstance(constraint.get("length"), (int, float))
        ):
            edge_lengths[frozenset(constraint["segment"])] = float(constraint["length"])
            continue
        remaining_constraints.append(constraint)

    leg1 = edge_lengths.get(frozenset({right_vertex, p_name}))
    leg2 = edge_lengths.get(frozenset({right_vertex, q_name}))
    hyp = edge_lengths.get(frozenset({p_name, q_name}))

    if leg1 is not None:
        right_triangle["length"] = leg1
    if leg2 is not None:
        right_triangle["width"] = leg2
    elif leg1 is not None and hyp is not None and hyp > leg1:
        right_triangle["width"] = float((hyp ** 2 - leg1 ** 2) ** 0.5)
    elif leg2 is None and leg1 is None and hyp is not None:
        remaining_constraints.extend(
            [
                {"type": "edge_length", "segment": [right_vertex, p_name], "length": hyp},
                {"type": "edge_length", "segment": [p_name, q_name], "length": hyp},
            ]
        )

    constraints[:] = remaining_constraints
    constraints.append(right_triangle)




def _repair_right_triangle_vertex(
    constraints: list[dict[str, Any]],
    problem_text: str,
) -> None:
    match = re.search(r"tam giác vuông tại\s*([A-Z])", _normalize_math_text(problem_text), re.IGNORECASE)
    if not match:
        return

    right_vertex = match.group(1).upper()
    for constraint in constraints:
        if not isinstance(constraint, dict) or constraint.get("type") != "right_triangle":
            continue
        points = constraint.get("points")
        if not isinstance(points, list) or len(points) != 3 or right_vertex not in points:
            continue
        if points[0] == right_vertex:
            return
        others = [name for name in points if name != right_vertex]
        constraint["points"] = [right_vertex, *others]
        return




def _repair_text_based_midpoints_and_centroids(
    constraints: list[dict[str, Any]],
    problem_text: str,
) -> None:
    normalized = _normalize_math_text(problem_text)

    # 1. Regex to find midpoints: "M là trung điểm [của] SD"
    midpoint_matches = re.findall(
        r"\b([A-Z]'?)\s+là\s+trung\s+điểm\s+(?:của\s+)?([A-Z]'?[A-Z]'?)(?!\w)",
        normalized,
        re.IGNORECASE
    )
    for pt, seg_str in midpoint_matches:
        pt = pt.upper()
        seg_pts = re.findall(r"[A-Z]'?", seg_str.upper())
        found = False
        for c in constraints:
            if not isinstance(c, dict):
                continue
            if c.get("point") == pt:
                c["type"] = "midpoint"
                c["segment"] = seg_pts
                c.pop("points", None)
                c.pop("ratio", None)
                c.pop("from_point", None)
                c.pop("length", None)
                c.pop("width", None)
                c.pop("height", None)
                c.pop("degrees", None)
                found = True
                break
        if not found:
            constraints.append({
                "type": "midpoint",
                "point": pt,
                "segment": seg_pts
            })

    # 2. Regex to find centroids: "N là trọng tâm tam giác SAB"
    centroid_matches = re.findall(
        r"\b([A-Z]'?)\s+là\s+trọng\s+tâm\s+(?:của\s+)?(?:tam\s+giác\s+)?([A-Z]'?[A-Z]'?[A-Z]'?)(?!\w)",
        normalized,
        re.IGNORECASE
    )
    for pt, tri_str in centroid_matches:
        pt = pt.upper()
        tri_pts = re.findall(r"[A-Z]'?", tri_str.upper())
        found = False
        for c in constraints:
            if not isinstance(c, dict):
                continue
            if c.get("point") == pt:
                c["type"] = "centroid"
                c["points"] = tri_pts
                c.pop("segment", None)
                c.pop("ratio", None)
                c.pop("from_point", None)
                c.pop("length", None)
                c.pop("width", None)
                c.pop("height", None)
                c.pop("degrees", None)
                found = True
                break
        if not found:
            constraints.append({
                "type": "centroid",
                "point": pt,
                "points": tri_pts
            })

    # 3. Regex to find intersection: "MN cắt mặt phẳng (SBC) tại điểm I"
    inter_match = re.search(
        r"\b([A-Z]'?[A-Z]'?)\s+cắt\s+(?:mặt\s+phẳng\s+)?\(?([A-Z'’]{3,8})\)?\s+(?:tại|ở)\s+(?:điểm\s+)?([A-Z]'?)(?!\w)",
        normalized,
        re.IGNORECASE
    )
    if inter_match:
        line_str, plane_str, pt = inter_match.groups()
        pt = pt.upper()
        line_pts = re.findall(r"[A-Z]'?", line_str.upper())
        plane_pts = re.findall(r"[A-Z]'?", plane_str.upper())
        found = False
        for c in constraints:
            if not isinstance(c, dict):
                continue
            if c.get("point") == pt or c.get("type") == "intersection":
                c["type"] = "intersection"
                c["point"] = pt
                c["segment"] = line_pts
                c["points"] = plane_pts
                found = True
                break
        if not found:
            constraints.append({
                "type": "intersection",
                "point": pt,
                "segment": line_pts,
                "points": plane_pts
            })


def _repair_centroid_constraints(constraints: list[dict[str, Any]]) -> None:
    for constraint in constraints:
        if not isinstance(constraint, dict):
            continue
        if constraint.get("type") == "midpoint":
            seg = constraint.get("segment") or []
            pts = constraint.get("points") or []
            if len(seg) == 3 or len(pts) == 3:
                constraint["type"] = "centroid"

        if (
            constraint.get("type") == "centroid"
            and not constraint.get("points")
            and isinstance(constraint.get("segment"), list)
        ):
            constraint["points"] = constraint["segment"]
            constraint.pop("segment", None)




def _repair_intersection_constraints(
    constraints: list[dict[str, Any]],
    problem_text: str,
) -> None:
    for constraint in constraints:
        if not isinstance(constraint, dict):
            continue
        if constraint.get("type") == "intersection" and not constraint.get("points"):
            plane_points = _extract_plane_points(problem_text)
            if plane_points:
                constraint["points"] = plane_points




def _repair_perpendicular_constraints(
    constraints: list[dict[str, Any]],
    problem_text: str,
) -> None:
    match = re.search(r"([A-Z])([A-Z])\s*(?:\\perp|⊥)\s*\(?\$?([A-Z]{3,8})\$?\)?", problem_text)
    if not match:
        return
    p1, p2, plane = match.groups()
    plane_points = list(plane)

    if p1 in plane_points and p2 not in plane_points:
        foot, apex = p1, p2
    elif p2 in plane_points and p1 not in plane_points:
        foot, apex = p2, p1
    else:
        return

    repaired = False
    for constraint in constraints:
        if not isinstance(constraint, dict):
            continue
        if constraint.get("type") != "perpendicular_to_plane":
            continue
        if constraint.get("point") in (None, apex):
            constraint["point"] = apex
        if not constraint.get("from_point"):
            constraint["from_point"] = foot
        if not constraint.get("points"):
            constraint["points"] = plane_points
        repaired = True

    if not repaired:
        constraints.append(
            {
                "type": "perpendicular_to_plane",
                "point": apex,
                "from_point": foot,
                "points": plane_points,
            }
        )




def _extract_pyramid(problem_text: str) -> tuple[str, list[str]] | None:
    normalized = _normalize_math_text(problem_text)
    match = re.search(r"hình\s+chóp\s+([A-Z])\s*\.\s*([A-Z]{3,8})", normalized, re.IGNORECASE)
    if not match:
        return None
    return match.group(1), list(match.group(2))




def _extract_plane_points(problem_text: str) -> list[str] | None:
    matches = re.findall(r"mặt\s+phẳng\s*\(?\$?([A-Z]{3,8})\$?\)?", problem_text)
    if not matches:
        matches = re.findall(r"\(\s*([A-Z]{3,8})\s*\)", problem_text)
    if not matches:
        return None
    return list(matches[-1])




def _normalize_math_text(problem_text: str) -> str:
    text = problem_text
    text = text.replace("$", "")
    text = text.replace("{", "").replace("}", "")
    text = text.replace("\\(", "(").replace("\\)", ")")
    text = re.sub(r"\\(?:circ|degree|degrees?)", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\^0", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()




def _has_explicit_perpendicular_symbol(problem_text: str) -> bool:
    # Explicit symbolic forms: SA ⟂ (ABCD) or SA \perp (ABCD)
    if re.search(r"([A-Z])([A-Z])\s*(?:\\perp|⊥)\s*\(?\$?[A-Z]{3,8}\$?\)?", problem_text):
        return True
    # Explicit textual form: SA vuông góc (ABCD) / SA vuông góc với mặt phẳng (ABCD)
    normalized = _normalize_math_text(problem_text).lower()
    if re.search(r"[a-z]\s*[a-z]\s+vuông\s+góc(?:\s+với\s+mặt\s+phẳng)?\s*\(?[a-z]{3,8}\)?", normalized):
        return True
    return False




def _mentions_parallelogram_base(problem_text: str) -> bool:
    return "hình bình hành" in problem_text.lower()




def _choose_side_and_base_plane(plane1: str, plane2: str) -> tuple[str | None, str | None]:
    p1_pts = re.findall(r"[A-Z]'?", plane1)
    p2_pts = re.findall(r"[A-Z]'?", plane2)
    if len(p1_pts) == 3 and len(p2_pts) >= 3:
        return plane1, plane2
    if len(p2_pts) == 3 and len(p1_pts) >= 3:
        return plane2, plane1
    return None, None




def _find_perpendicular_foot(
    constraints: list[dict[str, Any]],
    apex: str | None,
) -> str | None:
    if apex is None:
        return None
    for constraint in constraints:
        if (
            isinstance(constraint, dict)
            and constraint.get("type") == "perpendicular_to_plane"
            and constraint.get("point") == apex
            and constraint.get("from_point")
        ):
            return str(constraint["from_point"])
    return None




def _has_constraint(
    constraints: list[Any],
    constraint_type: str,
    points: list[str],
) -> bool:
    return any(
        isinstance(constraint, dict)
        and constraint.get("type") == constraint_type
        and constraint.get("points") == points
        for constraint in constraints
    )




def _has_any_constraint(constraints: list[Any], constraint_types: set[str]) -> bool:
    return any(
        isinstance(constraint, dict) and constraint.get("type") in constraint_types
        for constraint in constraints
    )




def _sort_constraints(constraints: list[dict[str, Any]]) -> list[dict[str, Any]]:
    priority = {
        "square": 0,
        "rectangle": 0,
        "parallelogram": 0,
        "rhombus": 0,
        "trapezoid": 0,
        "right_triangle": 0,
        "oblique_prism": 0,
        "right_prism": 1,
        "perpendicular_to_plane": 1,
        "dihedral_angle": 2,
        "equal_side_face_angle": 2,
        "apex": 3,
        "regular_pyramid": 3,
        "pyramid": 3,
        "midpoint": 4,
        "centroid": 4,
        "intersection": 4,
    }
    return sorted(constraints, key=lambda constraint: priority.get(constraint.get("type", ""), 10))


def _repair_ratio_point_constraints(constraints: list[dict[str, Any]]) -> None:
    for constraint in constraints:
        if not isinstance(constraint, dict):
            continue
        if constraint.get("type") == "ratio_point":
            pts = constraint.get("points")
            if isinstance(pts, list) and len(pts) == 3:
                # points = [P1, R, P2] -> point = R, segment = [P1, P2]
                constraint["point"] = pts[1]
                constraint["segment"] = [pts[0], pts[2]]
                constraint.pop("points", None)


def _normalize_apex_constraints(constraints: list[dict[str, Any]]) -> None:
    for c in constraints:
        if not isinstance(c, dict):
            continue
        if c.get("type") in ("apex", "pyramid", "regular_pyramid"):
            pt = c.get("point")
            pts = c.get("points")
            if pt and pts:
                if pt in pts:
                    pts = [p for p in pts if p != pt]
                c["points"] = [pt, *pts]
                c.pop("point", None)


def _add_coplanar_constraints_for_sub_shapes(
    constraints: list[dict[str, Any]],
    problem_text: str,
) -> None:
    normalized = _normalize_math_text(problem_text)
    
    # 1. Tìm các mặt phẳng trong ngoặc đơn, ví dụ (A'AC), (SBD), (SBC)
    plane_matches = re.findall(r"\(\s*([A-Z'’]{3,8})\s*\)", problem_text)
    
    # 2. Tìm các đáy hình chóp phụ, ví dụ S.ADNM
    pyramid_matches = re.findall(r"\b[A-Z]'?\s*\.\s*([A-Z'’]{3,8})\b", normalized)
    
    candidates = set()
    for s in plane_matches + pyramid_matches:
        pts = tuple(re.findall(r"[A-Z]'?", s))
        if len(pts) >= 3:
            candidates.add(pts)
            
    # Lọc bỏ các mặt cấu trúc chính của chóp và lăng trụ
    structural_faces = set()
    
    pyramid = _extract_pyramid(problem_text)
    if pyramid:
        apex, base = pyramid
        n = len(base)
        structural_faces.add(frozenset(base))
        for i in range(n):
            structural_faces.add(frozenset([apex, base[i], base[(i + 1) % n]]))
            
    prism = _extract_prism(problem_text)
    if prism:
        base, top = prism
        n = len(base)
        structural_faces.add(frozenset(base))
        structural_faces.add(frozenset(top))
        for i in range(n):
            structural_faces.add(frozenset([base[i], base[(i + 1) % n], top[(i + 1) % n], top[i]]))
                
    for pts in candidates:
        cand_set = frozenset(pts)
        if any(cand_set.issubset(sf) for sf in structural_faces):
            continue
        # Tránh trùng lặp
        exists = any(
            isinstance(c, dict) 
            and c.get("type") == "coplanar" 
            and frozenset(c.get("points") or []) == frozenset(pts)
            for c in constraints
        )
        if not exists:
            constraints.append({
                "type": "coplanar",
                "points": list(pts)
            })


def _repair_list_based_midpoints_and_centroids(
    constraints: list[dict[str, Any]],
    problem_text: str,
) -> None:
    normalized = _normalize_math_text(problem_text)
    # Split by common sentence delimiters
    clauses = re.split(r"[.;\n]", normalized)
    for clause in clauses:
        clause = clause.strip()
        if "trung điểm" in clause.lower():
            parts = re.split(r"trung\s+điểm", clause, flags=re.IGNORECASE)
            if len(parts) == 2:
                left, right = parts
                pts = re.findall(r"\b([A-Z]'?)(?!\w)", left)
                segs = re.findall(r"\b([A-Z]'?[A-Z]'?)(?!\w)", right)
                if len(pts) == len(segs) and len(pts) >= 1:
                    for pt, seg_str in zip(pts, segs):
                        seg_pts = re.findall(r"[A-Z]'?", seg_str)
                        found = False
                        for c in constraints:
                            if not isinstance(c, dict):
                                continue
                            if c.get("point") == pt:
                                c["type"] = "midpoint"
                                c["segment"] = seg_pts
                                c.pop("points", None)
                                c.pop("ratio", None)
                                c.pop("from_point", None)
                                c.pop("length", None)
                                c.pop("width", None)
                                c.pop("height", None)
                                c.pop("degrees", None)
                                found = True
                                break
                        if not found:
                            constraints.append({
                                "type": "midpoint",
                                "point": pt,
                                "segment": seg_pts
                            })
        elif "trọng tâm" in clause.lower():
            parts = re.split(r"trọng\s+tâm", clause, flags=re.IGNORECASE)
            if len(parts) == 2:
                left, right = parts
                pts = re.findall(r"\b([A-Z]'?)(?!\w)", left)
                tris = re.findall(r"\b([A-Z]'?[A-Z]'?[A-Z]'?)(?!\w)", right)
                if len(pts) == len(tris) and len(pts) >= 1:
                    for pt, tri_str in zip(pts, tris):
                        tri_pts = re.findall(r"[A-Z]'?", tri_str)
                        found = False
                        for c in constraints:
                            if not isinstance(c, dict):
                                continue
                            if c.get("point") == pt:
                                c["type"] = "centroid"
                                c["points"] = tri_pts
                                c.pop("segment", None)
                                c.pop("ratio", None)
                                c.pop("from_point", None)
                                c.pop("length", None)
                                c.pop("width", None)
                                c.pop("height", None)
                                c.pop("degrees", None)
                                found = True
                                break
                        if not found:
                            constraints.append({
                                "type": "centroid",
                                "point": pt,
                                "points": tri_pts
                            })


def _remove_shape_constraints_on_derived_points(constraints: list[dict[str, Any]]) -> None:
    derived_types = {
        "midpoint", "ratio_point", "centroid", "intersection",
        "foot_perpendicular", "foot_on_plane", "symmetric",
        "median", "angle_bisector", "circumcenter", "incenter",
        "orthocenter", "equidistant"
    }
    derived_pts = set()
    for c in constraints:
        if isinstance(c, dict) and c.get("type") in derived_types:
            pt = c.get("point")
            if pt:
                derived_pts.add(pt)

    structural_types = {
        "square", "rectangle", "parallelogram", "rhombus", "trapezoid",
        "equilateral_triangle", "isosceles_triangle", "right_triangle",
        "regular_tetrahedron", "cube", "rectangular_prism", "prism",
        "oblique_prism", "apex", "regular_pyramid", "pyramid",
        "regular_hexagon", "regular_octahedron", "truncated_pyramid",
        "regular_polygon", "right_prism",
    }

    kept = []
    for c in constraints:
        if not isinstance(c, dict):
            kept.append(c)
            continue
        ctype = c.get("type")
        if ctype in structural_types:
            pts = c.get("points") or []
            if any(p in derived_pts for p in pts):
                continue
        kept.append(c)
    constraints[:] = kept


# Dùng GeometryInput để validate lại JSON từ LLM, đảm bảo đúng schema và kiểu dữ liệu
