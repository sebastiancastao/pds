"use client";

import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";

export type SignaturePadHandle = {
  clear: () => void;
  /** PNG data URL of the current drawing (transparent background). */
  toDataURL: () => string;
};

type SignaturePadProps = {
  disabled?: boolean;
  /** Fires whenever the pad flips between empty and drawn-on. */
  onEmptyChange?: (isEmpty: boolean) => void;
};

const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { disabled = false, onEmptyChange },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const emptyRef = useRef(true);
  const [isEmpty, setIsEmpty] = useState(true);

  const updateEmpty = useCallback(
    (next: boolean) => {
      if (emptyRef.current === next) return;
      emptyRef.current = next;
      setIsEmpty(next);
      onEmptyChange?.(next);
    },
    [onEmptyChange]
  );

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
    drawingRef.current = false;
    updateEmpty(true);
  }, [updateEmpty]);

  useImperativeHandle(
    ref,
    () => ({
      clear,
      toDataURL: () => (emptyRef.current ? "" : canvasRef.current?.toDataURL("image/png") ?? ""),
    }),
    [clear]
  );

  const getPos = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = getPos(canvas, e.clientX, e.clientY);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    e.preventDefault();
    const { x, y } = getPos(canvas, e.clientX, e.clientY);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e3a5f";
    ctx.lineTo(x, y);
    ctx.stroke();
    updateEmpty(false);
  };

  const endStroke = () => {
    drawingRef.current = false;
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">{isEmpty ? "Draw your signature below" : "Signature captured"}</span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || isEmpty}
          className="text-xs text-gray-500 hover:text-red-500 underline disabled:no-underline disabled:opacity-40 disabled:hover:text-gray-500"
        >
          Clear
        </button>
      </div>
      <div
        className={`border-2 rounded-lg overflow-hidden ${
          isEmpty ? "border-gray-300" : "border-blue-400"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <canvas
          ref={canvasRef}
          width={440}
          height={120}
          className={`w-full h-28 touch-none bg-gray-50 ${disabled ? "cursor-not-allowed" : "cursor-crosshair"}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
      </div>
    </div>
  );
});

export default SignaturePad;
