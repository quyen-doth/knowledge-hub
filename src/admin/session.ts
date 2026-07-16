import { z } from 'zod';

export const ADMIN_SESSION_COOKIE = 'knowledge_hub_session';
export const ADMIN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const sessionPayloadSchema = z.object({
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

type SessionPayload = z.infer<typeof sessionPayloadSchema>;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function secureTextEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index]! ^ rightDigest[index]!;
  }
  return difference === 0;
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyAdminPassword(
  provided: string,
  expected: string,
): Promise<boolean> {
  return secureTextEqual(provided, expected);
}

export async function createAdminSession(
  secret: string,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = {
    iat: issuedAt,
    exp: issuedAt + ADMIN_SESSION_TTL_SECONDS,
  };
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${encodedPayload}.${await sign(encodedPayload, secret)}`;
}

export async function verifyAdminSession(
  token: string | undefined,
  secret: string,
  now = new Date(),
): Promise<boolean> {
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) return false;

  const expectedSignature = await sign(encodedPayload, secret);
  if (!(await secureTextEqual(providedSignature, expectedSignature))) return false;

  try {
    const payload = sessionPayloadSchema.parse(
      JSON.parse(decoder.decode(base64UrlToBytes(encodedPayload))) as unknown,
    );
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return payload.iat <= nowSeconds && payload.exp > nowSeconds;
  } catch {
    return false;
  }
}
