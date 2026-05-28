"""OCR + LLM analysis for geometry problems.

This module only turns an image or problem text into GeometryInput. It does
not call GeometryEngine; orchestration belongs in root-level backend files.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from geometry_engine.models import GeometryInput, GeometryOutput
from ocr_llm.problem_types import ProblemType, detect_problem_type
from ocr_llm.prompts import BASE_PROMPT_TEMPLATE, constraints_for, prompt_context_for
from ocr_llm.repairs import _repair_geometry_payload


DEFAULT_ANALYZER_MODEL = "llama-3.1-8b-instant"
DEFAULT_OCR_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
logger = logging.getLogger(__name__)

SUPPORTED_CONSTRAINTS = (
    "square, rectangle, parallelogram, rhombus, trapezoid, "
    "equilateral_triangle, isosceles_triangle, right_triangle, "
    "regular_tetrahedron, cube, rectangular_prism, prism, right_prism, "
    "regular_hexagon, regular_octahedron, regular_polygon, midpoint, "
    "ratio_point, centroid, circumcenter, orthocenter, incenter, equidistant, "
    "angle_bisector, median, foot_perpendicular, foot_on_plane, "
    "perpendicular_to_plane, symmetric, intersection, apex, regular_pyramid, "
    "pyramid, truncated_pyramid, right_angle, angle, distance, edge_length, "
    "on_line, collinear, parallel, perpendicular, coplanar"
)

# Dùng model OCR trên ảnh để lấy văn bản đề bài
def run_ocr(
    image_path: str | Path,
    *,
    model_name: str = DEFAULT_OCR_MODEL,
) -> str:
    """Read the problem statement from an image using a Groq vision model."""
    ChatGroq = _import_chat_groq()
    image_b64 = image_to_base64(image_path)
    llm_ocr = ChatGroq(
        model_name=model_name,
        temperature=0.1,
        groq_api_key=_resolve_groq_api_key(),
    )
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Hãy đọc chính xác toàn bộ nội dung đề toán trong ảnh. "
                        "Chỉ đọc, không giải và trả về chính xác văn bản của đề bài."
                    ),
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                },
            ],
        }
    ]
    return llm_ocr.invoke(messages).content


# Xây dựng chuỗi phân tích LLM với prompt và parser (trả về raw message để tiền xử lý chuỗi)
def _build_analysis_chain(*, model_name: str, problem_type: ProblemType):
    ChatGroq = _import_chat_groq()
    ChatPromptTemplate, JsonOutputParser = _import_langchain_core()

    parser = JsonOutputParser(pydantic_object=GeometryInput)
    prompt = ChatPromptTemplate.from_template(
        BASE_PROMPT_TEMPLATE,
        partial_variables={"format_instructions": parser.get_format_instructions()},
    )
    llm = ChatGroq(
        model_name=model_name,
        temperature=0.1,
        groq_api_key=_resolve_groq_api_key(),
    )
    return prompt | llm


def _pre_repair_json_string(raw_str: str) -> str:
    """Sửa lỗi định dạng chuỗi JSON thô từ LLM trước khi gọi json.loads."""
    # Trích xuất khối JSON nằm giữa ```json và ``` hoặc tìm cặp dấu ngoặc {} ngoài cùng
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_str, re.DOTALL | re.IGNORECASE)
    if match:
        raw_str = match.group(1)
    else:
        start = raw_str.find("{")
        end = raw_str.rfind("}")
        if start != -1 and end != -1:
            raw_str = raw_str[start:end+1]

    # Sửa lỗi phân số không bọc nháy kép trong JSON (ví dụ "ratio": 1/4 hoặc "ratio": 1 / 4)
    def eval_fraction(m: re.Match) -> str:
        num = float(m.group(1))
        denom = float(m.group(2))
        if abs(denom) > 1e-10:
            return f": {num / denom}"
        return f": 0.0"

    raw_str = re.sub(r':\s*([0-9]+(?:\.[0-9]+)?)\s*/\s*([0-9]+(?:\.[0-9]+)?)\b', eval_fraction, raw_str)
    return raw_str


# Phân tích đề bài đã được OCR thành GeometryInput
def analyze_problem_text(
    problem_text: str,
    *,
    model_name: str = DEFAULT_ANALYZER_MODEL,
) -> GeometryInput:
    """Analyze OCR/plain text and return validated GeometryInput."""
    problem_type = detect_problem_type(problem_text)
    chain = _build_analysis_chain(model_name=model_name, problem_type=problem_type)
    result = chain.invoke(
        {
            "problem_text": problem_text,
            **prompt_context_for(problem_type),
        }
    )
    
    if isinstance(result, dict):
        parsed_dict = result
    else:
        raw_str = result.content if hasattr(result, "content") else str(result)
        repaired_json = _pre_repair_json_string(raw_str)
        try:
            parsed_dict = json.loads(repaired_json)
        except Exception:
            # Fallback về bộ phân tích cú pháp của LangChain để báo lỗi chuẩn
            ChatPromptTemplate, JsonOutputParser = _import_langchain_core()
            parser = JsonOutputParser()
            parsed_dict = parser.parse(raw_str)
        
    def _to_raw_dict(obj: Any) -> Any:
        if hasattr(obj, "model_dump"):
            return _to_raw_dict(obj.model_dump())
        if hasattr(obj, "dict"):
            return _to_raw_dict(obj.dict())
        if isinstance(obj, dict):
            return {k: _to_raw_dict(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_to_raw_dict(v) for v in obj]
        return obj

    parsed_dict = _to_raw_dict(parsed_dict)

    payload = _repair_geometry_payload(parsed_dict, problem_text)
    return _validate_geometry_input(payload)


def generate_problem_solution(
    problem_text: str,
    *,
    geometry_input: GeometryInput | None = None,
    solved_output: GeometryOutput | None = None,
) -> str:
    """Generate a step-by-step mathematical solution to the problem text using ChatGroq with fallback."""
    ChatGroq = _import_chat_groq()
    
    # 1. Trích xuất thêm context từ geometry_input và solved_output
    context_lines = []
    if geometry_input:
        context_lines.append("\n[Ràng buộc hình học đã trích xuất từ đề bài]:")
        for c in geometry_input.constraints:
            props = []
            if c.points: props.append(f"points={c.points}")
            if c.point: props.append(f"point={c.point}")
            if c.segment: props.append(f"segment={c.segment}")
            if c.length is not None: props.append(f"length={c.length}")
            if c.height is not None: props.append(f"height={c.height}")
            if c.ratio is not None: props.append(f"ratio={c.ratio}")
            if c.degrees is not None: props.append(f"degrees={c.degrees}")
            context_lines.append(f"- {c.type}: {', '.join(props)}")
            
    if solved_output:
        if solved_output.meta:
            context_lines.append("\n[Thông số hình học tính toán từ mô hình 3D (với a = 1.0)]:")
            for key, val in solved_output.meta.items():
                name_vi = {"volume": "Thể tích", "surface_area": "Diện tích toàn phần", "height": "Chiều cao"}.get(key, key)
                context_lines.append(f"- {name_vi}: {val}")
        if solved_output.points:
            context_lines.append("\n[Tọa độ 3D tham khảo giải bởi Geometry Engine (hệ đơn vị a=1)]: ")
            for name, pt in solved_output.points.items():
                context_lines.append(f"- Điểm {name}: ({pt.x:.4f}, {pt.y:.4f}, {pt.z:.4f})")
            
    context_str = "\n".join(context_lines)
    
    # 2. Xây dựng prompt
    system_prompt = (
        "Bạn là một giáo viên chuyên ngành Toán học phổ thông (đặc biệt là hình học không gian).\n"
        "Hãy giải bài toán được yêu cầu một cách chính xác, ngắn gọn, súc tích, đi thẳng vào bản chất và luôn cho ra kết quả cuối cùng.\n"
        "Quy tắc quan trọng:\n"
        "1. Tuyệt đối KHÔNG được lặp lại các bước giải, các câu viết hoặc các kết quả đã có. Tránh mọi hình thức lặp từ hay lặp chuỗi văn bản (loop).\n"
        "2. Sử dụng tiếng Việt chuẩn, văn phong khoa học sư phạm rõ ràng, mạch lạc. Không rườm rà dài dòng.\n"
        "3. BẮT BUỘC: Tất cả công thức toán học, ký hiệu điểm (M, N, S, A, B, C, D, v.v.), ký hiệu góc (như \\angle IMS), ký hiệu vuông góc (\\perp), ký hiệu song song (\\parallel), phân số (\\frac), độ (\\circ), độ dài, biểu thức số học đều PHẢI được đặt trong cặp dấu đô-la $, ví dụ: $S.ABCD$, $a\\sqrt{3}$, $60^\\circ$, $M$, $N$, $\\angle IMS = 90^\\circ$, $SA \\perp (ABCD)$. Tuyệt đối không viết thô các ký tự gạch chéo ngược \\ như \\angle hay \\frac ngoài dấu $.\n"
        "4. Không giải thích theo phương pháp tọa độ hóa trừ khi đề bài yêu cầu. Hãy giải theo hình học thuần túy (xác định đường cao, tính diện tích đáy, dùng hệ thức lượng, tỉ số thể tích Simson, v.v.).\n"
        "5. Dựa vào thông số hình học tính toán (như Thể tích, Chiều cao) ở phần thông tin bổ sung để đưa ra đáp số dạng biểu thức đúng đắn và chính xác nhất (ví dụ nếu thể tích là 0.1531 thì đáp án là $a^3\\sqrt{6}/16$).\n"
        "6. Luôn kết luận đáp án cuối cùng rõ ràng ở dòng cuối cùng."
    )
    
    user_content = f"Hãy giải chi tiết đề toán sau:\n{problem_text}\n"
    if context_str:
        user_content += f"\nThông tin bổ sung từ hệ thống để tham khảo:\n{context_str}\n"
        
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content}
    ]
    
    # 3. Thử với model 70B trước (thông minh hơn nhiều), nếu bị rate limit hoặc lỗi 429 thì fallback về 8B
    models_to_try = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
    last_exc = None
    
    for model_name in models_to_try:
        try:
            llm = ChatGroq(
                model_name=model_name,
                temperature=0.1,
                groq_api_key=_resolve_groq_api_key(),
            )
            response = llm.invoke(messages)
            return response.content
        except Exception as exc:
            last_exc = exc
            exc_str = str(exc).lower()
            if "rate limit" in exc_str or "429" in exc_str:
                # Bị giới hạn băng thông, thử model tiếp theo
                continue
            raise exc
            
    # Nếu thử tất cả đều lỗi
    raise last_exc


# Gộp hai bước trên: OCR ảnh rồi phân tích văn bản thành GeometryInput
def analyze_image(
    image_path: str | Path,
    *,
    analyzer_model: str = DEFAULT_ANALYZER_MODEL,
    ocr_model: str = DEFAULT_OCR_MODEL,
) -> tuple[str, GeometryInput]:
    """Run OCR on an image and analyze the text into GeometryInput."""
    ocr_text = run_ocr(image_path, model_name=ocr_model)
    geometry_input = analyze_problem_text(
        ocr_text,
        model_name=analyzer_model,
    )
    if logger.isEnabledFor(logging.INFO):
        logger.info("OCR text:\n%s\nGeometryInput:\n%s", ocr_text, geometry_input)
    return ocr_text, geometry_input


# Chuyển đổi ảnh thành base64 để gửi qua API
def image_to_base64(image_path: str | Path) -> str:
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image file not found: {path}")
    return base64.b64encode(path.read_bytes()).decode("utf-8")

def _to_plain_payload(result: Any) -> dict[str, Any] | str:
    if isinstance(result, dict | str):
        return result
    # chuyển đổi các object có model_dump (như GeometryInput) thành dict để validate
    if hasattr(result, "model_dump"):
        return result.model_dump()
    raise TypeError(f"Unsupported LLM parser result type: {type(result)!r}")


def _validate_geometry_input(payload: dict[str, Any] | str) -> GeometryInput:
    # nếu payload đã là JSON string hoặc dict thì parse thẳng
    if isinstance(payload, str):
        return GeometryInput.model_validate_json(payload)
    # nếu là GeometryInput đã được parser rồi thì chỉ cần validate lại
    return GeometryInput.model_validate(payload)


# kiểm tra xem có biến môi trường GROQ_API_KEY không
def _resolve_groq_api_key() -> str:
    _load_dotenv()
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError(
            "Missing Groq API key. Add GROQ_API_KEY to your .env file."
        )
    return key


# kiểm tra xem có cài đặt python-dotenv không và load .env nếu có
def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError as exc:
        raise RuntimeError(
            "Missing dependency python-dotenv. Run: pip install -r requirements.txt"
        ) from exc
    load_dotenv()


# kiểm tra xem có cài đặt langchain-groq trước khi import
def _import_chat_groq():
    try:
        from langchain_groq import ChatGroq
    except ImportError as exc:
        raise RuntimeError(
            "Missing dependency langchain-groq. Run: pip install -r requirements.txt"
        ) from exc
    return ChatGroq


# kiểm tra xem có cài đặt langchain-core trước khi import
def _import_langchain_core():
    try:
        from langchain_core.output_parsers import JsonOutputParser
        from langchain_core.prompts import ChatPromptTemplate
    except ImportError as exc:
        raise RuntimeError(
            "Missing LangChain dependencies. Run: pip install -r requirements.txt"
        ) from exc
    return ChatPromptTemplate, JsonOutputParser
