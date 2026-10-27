export class AppError extends Error {
  constructor(code, message, status = 500, details) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export class BadRequestError extends AppError {
  constructor(message, details) {
    super("bad_request", message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Falta una API key válida.") {
    super("unauthorized", message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado.", details) {
    super("not_found", message, 404, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Límite de peticiones excedido.", details) {
    super("rate_limited", message, 429, details);
  }
}

export class UpstreamError extends AppError {
  constructor(message, status = 502, details) {
    super("upstream_error", message, status, details);
  }
}
