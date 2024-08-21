export class StatusError extends Error {
  public statusCode: number;
  public isClientError: boolean;
  public origin?: Error;

  constructor(message: string, statusCode: number, origin?: Error) {
    super(message);
    this.name = 'StatusError';
    this.statusCode = statusCode;
    this.isClientError = this.statusCode >= 400 && this.statusCode < 500;
    this.origin = origin;
  }
}
