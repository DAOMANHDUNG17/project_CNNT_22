export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const productNotFound = () => new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
