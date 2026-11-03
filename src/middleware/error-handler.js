import { HttpError } from '../http/errors.js';

export function logError(logger, event, error) {
  // Never log credentials, connection strings, SQL text, or full error objects.
  logger.error({ event, code: error.code || 'UNKNOWN', type: error.name || 'Error' });
}

function isDatabaseUnavailable(error) {
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH',
    '28P01', '28000', '3D000', '53300', '53400', '57P01', '57P02', '57P03', '57014']
    .includes(error.code) || error.code?.startsWith('08') ||
    /timeout|connection terminated|connection closed|pool.*end/i.test(error.message || '');
}

export function errorHandler(logger = console) {
  return (error, req, res, next) => {
    logError(logger, 'request_error', error);
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) {
      if ([429, 503].includes(error.status)) res.set('Retry-After', error.status === 503 ? '1' : res.get('Retry-After') || '900');
      return res.status(error.status).json({ error: { code: error.code, message: error.message,
        ...(error.transaction_id ? { transaction_id: error.transaction_id } : {}) } });
    }
    if (error.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_BODY', message: 'Invalid JSON body.' } });
    if (error instanceof URIError && error.status === 400) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMETER', message: 'Invalid URL encoding.' } });
    }
    const unavailable = isDatabaseUnavailable(error);
    res.status(unavailable ? 503 : 500).json({
      error: {
        code: unavailable ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_SERVER_ERROR',
        message: unavailable ? 'Database is unavailable.' : 'An internal server error occurred.',
      },
    });
  };
}
