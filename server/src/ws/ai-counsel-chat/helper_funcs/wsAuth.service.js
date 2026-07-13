import { authenticateRequest } from "../../../utils/authToken.util.js";

export const authenticateWebSocketRequest = (req) => {
  const auth = authenticateRequest(req);

  if (!auth) {
    return null;
  }

  return {
    userId: auth.id,
    authPayload: auth.payload,
  };
};

