import { useEffect, useRef, useState, type ReactNode } from 'react';

// Cadre d'appareil de la Preview : la coque entoure l'écran sans jamais
// changer son viewport CSS. Les zones système (status bar, Dynamic Island ou
// encoche, barre d'accueil) sont dessinées par-dessus l'écran, comme sur iOS ;
// le contenu les évite grâce aux safe areas transmises au relais. Réduit
// proportionnellement seulement si la place manque, avec le zoom affiché.
export interface Device {
  id: string;
  name: string;
  width: number;
  height: number;
  // Safe areas iOS en portrait (px CSS).
  top: number;
  bottom: number;
  cutout: 'island' | 'notch' | 'none';
}
export const iPhones: Device[] = [
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, top: 20, bottom: 0, cutout: 'none' },
  { id: 'iphone-13-mini', name: 'iPhone 13 mini', width: 375, height: 812, top: 50, bottom: 34, cutout: 'notch' },
  { id: 'iphone-14', name: 'iPhone 14', width: 390, height: 844, top: 47, bottom: 34, cutout: 'notch' },
  { id: 'iphone-16', name: 'iPhone 16', width: 393, height: 852, top: 59, bottom: 34, cutout: 'island' },
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro', width: 402, height: 874, top: 62, bottom: 34, cutout: 'island' },
  { id: 'iphone-16-plus', name: 'iPhone 16 Plus', width: 430, height: 932, top: 59, bottom: 34, cutout: 'island' },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', width: 440, height: 956, top: 62, bottom: 34, cutout: 'island' },
];
// Modèle de référence : 393 × 852.
export const defaultIPhone = iPhones[3];
// Un format de la largeur d'un téléphone s'affiche dans une coque d'iPhone.
export const isPhone = (width: number) => width < 500;
export const closestIPhone = (width: number, height: number) =>
  iPhones.find((d) => d.width === width && d.height === height) ??
  iPhones.find((d) => d.width === width) ??
  defaultIPhone;

const bezel = 12;

export default function DeviceFrame({
  width,
  height,
  device,
  children,
  overlay,
}: {
  width: number;
  height: number;
  // Absent : simple cadre (tablette, desktop).
  device?: Device;
  children: ReactNode;
  // Calque posé sur l'écran (zone de dépôt), à la même échelle.
  overlay?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const outerW = width + (device ? bezel * 2 : 2);
  const outerH = height + (device ? bezel * 2 : 2);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () =>
      setScale(
        Math.min(1, (el.clientWidth - 16) / outerW, (el.clientHeight - 16) / outerH),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [outerW, outerH]);
  const s = Math.max(0.2, scale);
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="device-box" ref={box}>
      <div className="device-fit" style={{ width: outerW * s, height: outerH * s }}>
        <div
          className={device ? 'device device-phone' : 'device'}
          style={{ width: outerW, height: outerH, transform: s < 1 ? `scale(${s})` : undefined }}
        >
          <div className="device-screen" style={{ width, height }}>
            {children}
            {device && (
              <>
                <div className="device-status" style={{ height: device.top }} aria-hidden="true">
                  <span>{time}</span>
                  <span className="device-icons">
                    <i className="device-signal" />
                    <i className="device-wifi" />
                    <i className="device-battery" />
                  </span>
                </div>
                {device.cutout !== 'none' && (
                  <div className={`device-${device.cutout}`} aria-hidden="true" />
                )}
                {device.bottom > 0 && <div className="device-home" aria-hidden="true" />}
              </>
            )}
            {overlay}
          </div>
        </div>
      </div>

    </div>
  );
}
