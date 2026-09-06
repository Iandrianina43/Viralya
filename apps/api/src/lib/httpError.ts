// Erreur HTTP typée : le gestionnaire d'erreurs global (server.ts) lit `status`.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what = "Ressource"): HttpError => new HttpError(404, `${what} introuvable`);
export const badRequest = (message: string): HttpError => new HttpError(400, message);
export const forbidden = (message = "Accès refusé"): HttpError => new HttpError(403, message);
