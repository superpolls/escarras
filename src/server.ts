/**
 * Adreces fixes de l'app, compartides entre el codi del navegador i la configuració de Vite
 * (que en treu la política de seguretat). No depèn del navegador.
 */

/** Base de dades de Firebase (Realtime Database). No és secreta: la protegeixen les regles i el xifratge. */
export const FIREBASE_URL = "https://escarras-5668f-default-rtdb.europe-west1.firebasedatabase.app";

/** Única adreça oficial de l'app. Una còpia publicada en una altra adreça no és la versió oficial. */
export const OFFICIAL_URL = "https://superpolls.github.io/escarras/app/";

/** Adreça del servidor segons la variable de compilació VITE_RTDB_URL: buida = Firebase; "none" = només QR. */
export function serverFrom(env: string | undefined): string | null {
  return env === "none" ? null : env || FIREBASE_URL;
}
