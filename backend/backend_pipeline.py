"""Root pipeline that connects OCR/LLM analysis to GeometryEngine.

This is the backend-facing orchestration layer:
image -> ocr_llm -> GeometryInput -> geometry_engine -> GeometryOutput.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from geometry_engine import GeometryEngine
from geometry_engine.models import GeometryOutput
from ocr_llm import analyze_image, generate_problem_solution


def solve_image(
    image_path: str | Path,
) -> GeometryOutput:
    """Analyze a problem image and return GeometryEngine output."""
    ocr_text, geometry_input = analyze_image(image_path)
    print("GEOMETRY INPUT CONSTRAINTS:")
    for c in geometry_input.constraints:
        print("  ", c.model_dump(exclude_none=True))
    output = GeometryEngine().solve(geometry_input)
    output.ocr_text = ocr_text
    try:
        output.solution = generate_problem_solution(ocr_text, geometry_input=geometry_input, solved_output=output)
    except Exception as exc:
        output.solution = f"Không thể tự động sinh lời giải chi tiết: {exc}"
    return output


def solve_image_json(
    image_path: str | Path,
    *,
    pretty: bool = False,
) -> str:
    """Analyze a problem image and serialize GeometryEngine output as JSON."""
    output = solve_image(image_path)
    return json.dumps(output.model_dump(), ensure_ascii=False, indent=2 if pretty else None)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run OCR/LLM analysis, solve with GeometryEngine, and print GeometryOutput JSON."
    )
    parser.add_argument("image", help="Path to the problem image")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    print(
        solve_image_json(
            args.image,
            pretty=args.pretty,
        )
    )


if __name__ == "__main__":
    main()
