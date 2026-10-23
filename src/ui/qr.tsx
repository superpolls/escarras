/**
 * QR: dibuixar-lo (qrcode-generator, mode alfanumèric, correcció M, com a la prova M0)
 * i llegir-lo amb la càmera: lector natiu del navegador si n'hi ha i, si no llegeix res, jsQR (com a M0).
 * jsQR va dins l'app (no es carrega a part) perquè el lector ha de funcionar sense connexió.
 */
import jsQR from "jsqr";
import qrcode from "qrcode-generator";
import { useEffect, useRef, useState } from "preact/hooks";

export function QrCode({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const qr = qrcode(0, "M");
    qr.addData(text, /^[0-9A-Z $%*+\-./:]*$/.test(text) ? "Alphanumeric" : "Byte");
    qr.make();
    const n = qr.getModuleCount();
    const cell = 8;
    const quiet = 4; // zona blanca obligatòria al voltant
    const size = (n + quiet * 2) * cell;
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
  }, [text]);
  return <canvas ref={ref} class="qr" data-code={text} role="img" aria-label="Codi QR de la partida" />;
}

/** Manté la pantalla encesa mentre es mostra un QR. */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request("screen").then(l => { lock = l; }).catch(() => { /* res */ });
    return () => { void lock?.release().catch(() => { /* res */ }); };
  }, []);
}

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }

/** Càmera amb lectura automàtica. Crida `onRead` amb el text del primer QR que llegeix. */
export function Scanner({ onRead }: { onRead: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let detector: Detector | null = null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const loop = async () => {
      if (stop || done.current) return;
      const v = video.current;
      let text: string | null = null;
      if (v && v.readyState >= 2) {
        if (detector) {
          try { const r = await detector.detect(v); if (r[0]) text = r[0].rawValue; } catch { /* res */ }
        }
        if (!text && ctx && v.videoWidth) {
          const scale = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          text = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
        }
      }
      if (text && !done.current) { done.current = true; onRead(text); return; }
      requestAnimationFrame(() => void loop());
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        const why = e instanceof Error ? ` (${e.name})` : "";
        setError(`No s'ha pogut obrir la càmera${why}. Dona permís a la càmera o enganxa el codi a sota.`);
        return;
      }
      if (stop) { stream.getTracks().forEach(t => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => { /* res */ });
      const BD = (window as unknown as { BarcodeDetector?: { new(o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
      if (BD) {
        try { if ((await BD.getSupportedFormats()).includes("qr_code")) detector = new BD({ formats: ["qr_code"] }); } catch { /* res */ }
      }
      void loop();
    })();

    return () => {
      stop = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div class="scanner">
      {error ? <p class="sub">{error}</p> : <div class="viewfinder"><video ref={video} playsInline muted /><div class="frame" /></div>}
    </div>
  );
}
