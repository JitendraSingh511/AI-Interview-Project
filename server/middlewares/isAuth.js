import jwt from "jsonwebtoken";

const isAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.token;

    if (!token && req.headers.authorization){
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token){
      return res.status(401).json({ message: "User does not have a token" });
    }

    const verifyToken = jwt.verify(token, process.env.JWT_SECRET);

    if (!verifyToken){
      return res.status(401).json({ message: "User does not have a valid token" });
    }

    req.userId = verifyToken.userId;
    next();
  } catch (error) {
    return res.status(500).json({ message: `isauth error ${error}` });
  }
};

export default isAuth;