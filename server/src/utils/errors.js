export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication is required.') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action.') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'The requested resource was not found.') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new ApiError(409, 'CONFLICT', message, details);

export const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
