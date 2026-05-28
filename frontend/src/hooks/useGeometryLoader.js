import { useState, useCallback } from "react";
import { fetchProblemById, analyzeImageProblem } from "../api/geometryApi";

/**
 * Hook quản lý load và parse geometry data từ Geometry Engine output.
 *
 * Status:
 *  - 'idle'    : chưa làm gì
 *  - 'loading' : đang gọi API hoặc parse
 *  - 'ready'   : có data để render
 *  - 'error'   : lỗi
 */
export function useGeometryLoader() {
  const [geometryData, setGeometryData] = useState(null);
  const [status, setStatus] = useState("idle"); // 'idle' | 'loading' | 'ready' | 'error'
  const [errorMsg, setErrorMsg] = useState(null);

  /**
   * Load bài toán mẫu theo ID
   * @param {string} id - ID từ MOCK_GEOMETRY_PROBLEMS
   */
  const loadById = useCallback(async (id) => {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const data = await fetchProblemById(id);
      setGeometryData(data);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err.message || "Lỗi load bài toán");
      setStatus("error");
    }
  }, []);

  /**
   * Phân tích ảnh đề bài qua API (OCR → LLM → Geometry Engine).
   * Hiện tại là stub, trả về mock data ngẫu nhiên.
   * @param {File} imageFile
   */
  const loadFromImage = useCallback(async (imageFile) => {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const data = await analyzeImageProblem(imageFile);
      setGeometryData(data);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err.message || "Lỗi phân tích ảnh");
      setStatus("error");
    }
  }, []);

  /**
   * Set trực tiếp geometry data (dùng khi có data từ nguồn khác)
   */
  const loadDirect = useCallback((data) => {
    setGeometryData(data);
    setStatus("ready");
    setErrorMsg(null);
  }, []);

  /**
   * Reset về trạng thái ban đầu
   */
  const reset = useCallback(() => {
    setGeometryData(null);
    setStatus("idle");
    setErrorMsg(null);
  }, []);

  return {
    geometryData,
    status,
    errorMsg,
    isLoading: status === "loading",
    isReady: status === "ready",
    loadById,
    loadFromImage,
    loadDirect,
    reset,
  };
}
