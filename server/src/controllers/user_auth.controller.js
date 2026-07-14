// controllers/lawyerAuth.controller.js

import User from "../models/User.model";
import { hashPassword, comparePassword, generateToken } from "../utils/auth.util.js";

export const UserSignup = async (req, res) => {
    try {
        const {
            first_name,
            last_name,
            email,
            password
        } = req.body;

        // Check if User exists
        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(400).json({ message: "Email already registered" });
        }

        // Hash password
        const hashed = await hashPassword(password);

        // Create User
        const user = await User.create({
            first_name,
            last_name,
            email,
            password_hash: hashed
        });

        if (user) {
            const token = generateToken(user._id);

            res.cookie("jwt", token, {
                maxAge: 7 * 24 * 60 * 60 * 1000,
                httpOnly: true,
                sameSite: "None",
                domain: ".lexpal.in",
                secure: process.env.NODE_ENV != "development"
            });
        }

        return res.status(201).json({
            message: "Lawyer signup successful",
            token,
            User: {
                _id: user._id,
                name: user.first_name,
                email: user.email,

            }
        });

    } catch (error) {
        res.status(500).json({ message: "Server error", error });
    }
};





export const UserLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "Invalid email or password" });

        const isMatch = await comparePassword(password, user.password_hash);
        if (!isMatch) return res.status(400).json({ message: "Invalid email or password" });

        const token = generateToken(user._id);

        res.cookie("jwt", token, {
            maxAge: 7 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: "None",
                domain: ".lexpal.in",
            secure: process.env.NODE_ENV != "development"
        });

        return res.json({
            message: "Login successful",
            token,
            User: {
                _id: user._id,
                name: user.first_name,
                email: user.email
            }
        });

    } catch (error) {
        res.status(500).json({ message: "Server error", error });
        console.log(error);
    }
};