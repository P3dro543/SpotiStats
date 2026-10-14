export const API_PREFIX = "/api/v1" as const;

export type ApiError = {
  error: { code: string; message: string; requestId?: string };
};

export type ApiSuccess<T> = { data: T };
