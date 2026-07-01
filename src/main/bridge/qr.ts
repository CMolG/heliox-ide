/**
 * qr.ts — Bridge QR Code Generator
 *
 * Responsibility:
 * - Generates QR code data URLs for mobile companion pairing.
 * - Detects the local network IP address for LAN access.
 *
 * Boundaries:
 * - Owns: QR generation, local IP detection
 * - Does NOT own: auth, server lifecycle, WebSocket relay
 */
import QRCode from 'qrcode';
import { networkInterfaces } from 'os';

/** Detect the first non-internal IPv4 address on the local network */
export function getLocalIPAddress(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (!interfaces) continue;
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Build the full URL that the mobile device will navigate to.
 *
 * The pairing token travels in the URL fragment (#), never the query string:
 * fragments are stripped by the browser before the request leaves the client,
 * so they never reach server access logs, LAN middleboxes, or `Referer`
 * headers on subsequent same-origin fetches. The served SPA (src/bridge-app)
 * reads it client-side via `location.hash` and exchanges it over a POST body.
 */
export function buildBridgeURL(host: string, port: number, pairingToken: string): string {
  const ip = host === '0.0.0.0' ? getLocalIPAddress() : host;
  return `http://${ip}:${port}/#pt=${pairingToken}`;
}

/** Generate a QR code as a data URL (PNG base64) */
export async function generateQRDataURL(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 256,
    margin: 2,
    color: {
      dark: '#e0e0e8',
      light: '#0a0a0f',
    },
    errorCorrectionLevel: 'M',
  });
}

/** Generate the full bridge QR payload: URL + data URL image */
export async function generateBridgeQR(
  port: number,
  host: string,
  pairingToken: string
): Promise<{ url: string; qrDataUrl: string; localIp: string }> {
  const localIp = host === '0.0.0.0' ? getLocalIPAddress() : host;
  const url = `http://${localIp}:${port}/#pt=${pairingToken}`;
  const qrDataUrl = await generateQRDataURL(url);
  return { url, qrDataUrl, localIp };
}
