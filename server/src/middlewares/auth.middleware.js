import { authenticateRequest } from "../utils/authToken.util.js";

const protectRoute = async (req, res, next) => {
  const auth = authenticateRequest(req);

  if (!auth) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  req.user = { id: auth.id };
  req.client_data = auth.payload;

  return next();
};

export default protectRoute;
