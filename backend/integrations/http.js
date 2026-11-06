import { config } from '../config/config.js';

export class MissingKeyError extends Error {
  constructor(source, envVar) {
    super(`Nguồn ${source} cần API key trong biến môi trường ${envVar}.`);
    this.code = 'missing_api_key';
    this.envVar = envVar;
  }
}

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.code = 'upstream_error';
    this.status = status;
  }
}

const USER_AGENT = 'BachKhoa-Encyclopedia/2.0 (educational knowledge library; local deployment)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gọi JSON với timeout, tối đa 2 lần thử lại cho 429/5xx.
 * Tôn trọng Retry-After nhưng không chờ quá 10 giây mỗi lần.
 */
export async function fetchJson(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeout = config.syncTimeoutMs,
    retries = 2,
    maxBytes = 60 * 1024 * 1024
  } = options;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
        body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow'
      });

      if (response.status === 429) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10);
        if (attempt < retries) {
          await sleep(Math.min(10000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000 * (attempt + 1)));
          continue;
        }
        throw new UpstreamError('Nguồn dữ liệu giới hạn tần suất (HTTP 429). Thử lại sau.', 429);
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new UpstreamError(`HTTP ${response.status} từ nguồn dữ liệu${text ? `: ${text.slice(0, 160)}` : ''}`, response.status);
      }
      const length = Number(response.headers.get('content-length') || 0);
      if (length && length > maxBytes) {
        throw new UpstreamError(`Phản hồi quá lớn (${length} byte), vượt giới hạn an toàn.`, 413);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error instanceof UpstreamError && error.status === 429) throw error;
      if (error instanceof MissingKeyError) throw error;
      if (attempt < retries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new UpstreamError('Nguồn dữ liệu không phản hồi trong thời gian cho phép.', 504);
      }
      throw error instanceof UpstreamError ? error : new UpstreamError(error.message || 'Lỗi gọi nguồn dữ liệu.');
    }
  }
  throw lastError || new UpstreamError('Không gọi được nguồn dữ liệu.');
}

export function requireKey(key, source) {
  if (!key) throw new MissingKeyError(source, source === 'abuse.ch' ? 'ABUSECH_AUTH_KEY' : 'API_KEY');
  return key;
}
