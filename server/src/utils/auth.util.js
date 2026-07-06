// utils/auth.utils.js

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// const JWT_SECRET = process.env.JWT_SECRET ; 
const JWT_EXPIRES = "7d";

//password hashing function
export const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};


//compare password
export const comparePassword = async (password, hashed) => {
  return bcrypt.compare(password, hashed);
};


//jwt token generation
export const generateToken = (userId) => {
  return jwt.sign(
    { id: userId }, 
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
};