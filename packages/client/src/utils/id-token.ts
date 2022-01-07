import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey, JWTVerifyResult } from 'jose';
import * as s from 'superstruct';

import { CLOCK_TOLERANCE, EXPECTED_ALG } from '../constants';

const fullfillBase64 = (input: string) => {
  if (input.length === 2) {
    return `${input}==`;
  }

  if (input.length === 3) {
    return `${input}=`;
  }

  return input;
};

const IDTokenSchema = s.type({
  iss: s.string(),
  sub: s.string(),
  aud: s.string(),
  exp: s.number(),
  iat: s.number(),
  at_hash: s.optional(s.string()),
});

export type IDToken = s.Infer<typeof IDTokenSchema>;

/**
 * Decode IDToken from JWT, without verifying.
 * Verifying JWT requires fetching public key first, this can not
 * be done in a sync function, in some cases, verifying is not necessary.
 * @param token JWT string.
 * @returns IDToken combined with JWT Claims.
 */
export const decodeToken = (token: string): IDToken => {
  const payloadPart = token.split('.')[1];

  if (!payloadPart) {
    throw new Error('invalid token');
  }

  const payloadString = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    escape(Buffer.from(fullfillBase64(payloadString), 'base64').toString())
  );

  try {
    // Using SuperStruct to validate the json type
    const data = JSON.parse(json) as IDToken;
    s.assert(data, IDTokenSchema);
    return data;
  } catch (error: unknown) {
    if (error instanceof s.StructError) {
      throw error;
    }

    throw new Error('invalid token: JSON parse failed');
  }
};

/**
 * Create JWKS
 *
 * @param JWKSUri
 * @returns
 */
export const createJWKS = (JWKSUri: string): JWTVerifyGetKey => {
  return createRemoteJWKSet(new URL(JWKSUri));
};

/**
 * Verify IDToken
 * @param {Function} JWKS
 * @param {String} idToken
 * @param {String} audience
 * @returns
 */
export const verifyIdToken = async (
  JWKS: JWTVerifyGetKey,
  idToken: string,
  audience: string
): Promise<JWTVerifyResult> => {
  return jwtVerify(idToken, JWKS, {
    algorithms: [EXPECTED_ALG],
    clockTolerance: CLOCK_TOLERANCE,
    audience,
  });
};