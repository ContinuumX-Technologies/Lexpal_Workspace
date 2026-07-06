import jwt from "jsonwebtoken";


const protectRoute = async (req, res, next) => {
    try {

        let token;

        if (req.cookies && req.cookies.jwt) {
            token = req.cookies.jwt;
        } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
            token = req.headers.authorization.split(" ")[1];
        }

        if (!token) {
            return res.status(401).json({ messsage: "Unauthorized access - No token provided" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded) {
            return res.status(401).json({ message: "Uauthorized access - invalid token - please login" });
        }

        req.client_data = decoded;

        next();


    } catch (error) {
        console.log("⚠️ error in protectRoute middleware:" + error);
        res.status(500).json({ message: "Interenal server error" });

    }
}

export default protectRoute;