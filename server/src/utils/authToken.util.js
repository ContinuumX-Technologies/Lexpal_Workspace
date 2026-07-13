import jwt from "jsonwebtoken";

const COOKIE_SEPARATOR = ";";

const parseCookieHeader = (cookieHeader = "") => {
  const cookieMap = {};

  cookieHeader
    .split(COOKIE_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const separatorIndex = pair.indexOf("=");

      if (separatorIndex <= 0) {
        return;
      }

      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();

      if (!key) {
        return;
      }

      cookieMap[key] = decodeURIComponent(value);
    });

  return cookieMap;
};

const extractBearerToken = (authorizationHeader) => {
  if (typeof authorizationHeader !== "string") {
    return null;
  }

  const normalized = authorizationHeader.trim();

  if (!normalized.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = normalized.slice(7).trim();
  return token || null;
};

export const extractAuthTokenFromRequest = (req) => {
  const cookieToken = parseCookieHeader(req?.headers?.cookie || "").jwt;

  if (cookieToken) {
    return cookieToken;
  }

  return extractBearerToken(req?.headers?.authorization || null);
};

export const verifyAuthToken = (token) => {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || typeof decoded !== "object") {
      return null;
    }

    const decodedRecord = decoded;
    const userId = decodedRecord.id;

    if (typeof userId !== "string" || !userId.trim()) {
      return null;
    }

    return {
      id: userId,
      payload: decodedRecord,
    };
  } catch {
    return null;
  }
};

export const authenticateRequest = (req) => {
  const token = extractAuthTokenFromRequest(req);

  if (!token) {
    return null;
  }

  return verifyAuthToken(token);
};

