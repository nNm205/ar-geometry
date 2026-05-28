import { useEffect, useRef } from "react";

/**
 * Hook khởi tạo MediaPipe Hands tracking.
 *
 * BUG FIX:
 * - Dùng onResultsRef để callback luôn up-to-date mà KHÔNG cần
 *   là dependency của useEffect → tránh re-init Hands mỗi render.
 * - Guard `destroyed` flag để ngăn gửi frame sau khi cleanup.
 * - Cleanup đúng thứ tự: stop camera trước → đợi 200ms → close hands
 *   (tránh BindingError: "Cannot pass deleted object as a pointer of type SolutionWasm*")
 */
export function useHandTracking(videoRef, enabled, onResults) {
  // Ref giữ callback luôn mới nhất mà không trigger re-effect
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;

  useEffect(() => {
    if (!enabled || !videoRef.current) return;

    let destroyed = false;
    let cameraInstance = null;
    let handsInstance = null;

    async function init() {
      try {
        handsInstance = new window.Hands({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        handsInstance.setOptions({
          maxNumHands: 2,
          modelComplexity: 0,          // 0 thay vì 1 → nhanh hơn đáng kể
          minDetectionConfidence: 0.65,
          minTrackingConfidence: 0.5,
        });

        handsInstance.onResults((results) => {
          // Không gửi kết quả nếu đã cleanup
          if (!destroyed) {
            onResultsRef.current(results);
          }
        });

        cameraInstance = new window.Camera(videoRef.current, {
          onFrame: async () => {
            // Guard: không gửi frame nếu đã cleanup hoặc hands đã đóng
            if (!destroyed && handsInstance && videoRef.current) {
              try {
                await handsInstance.send({ image: videoRef.current });
              } catch (err) {
                // Bỏ qua lỗi frame đơn lẻ (thường xảy ra khi đang cleanup)
                if (!destroyed) {
                  console.warn("[HandTracking] Frame error (ignored):", err?.message);
                }
              }
            }
          },
          width: 640,
          height: 480,
        });

        await cameraInstance.start();
        console.log("[HandTracking] Started (modelComplexity=0)");
      } catch (err) {
        if (!destroyed) {
          console.error("[HandTracking] Init error:", err);
        }
      }
    }

    init();

    return () => {
      destroyed = true;

      // Snapshot refs trước khi null hoá
      const cam = cameraInstance;
      const hands = handsInstance;
      cameraInstance = null;
      handsInstance = null;

      // Bước 1: Dừng camera (ngăn onFrame mới được gọi)
      if (cam) {
        try { cam.stop(); } catch (_) { }
      }

      // Bước 2: Đợi các frame in-flight kết thúc trước khi đóng WASM
      setTimeout(() => {
        if (hands) {
          try { hands.close(); } catch (_) { }
        }
      }, 250);
    };
  }, [enabled]); // Chỉ re-init khi enabled thay đổi — KHÔNG include onResults
}
