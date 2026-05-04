const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const auth = require("../middleware/auth");
const { toClientUser } = require("../utils/serializers");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), publicId: user.publicId, email: user.email },
    process.env.JWT_SECRET || "dev-secret-change-me",
    { expiresIn: "7d" }
  );
}

router.post("/register", async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      skillsOffered = [],
      skillsWanted = [],
      bio = "",
      category = "Other",
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email, and password are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const userCount = await User.countDocuments();
    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      skillsOffered,
      skillsWanted,
      bio,
      category,
      isAdmin: userCount === 0,
    });

    const token = signToken(user);
    return res.status(201).json({ token, user: toClientUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = signToken(user);
    return res.status(200).json({ token, user: toClientUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ user: toClientUser(user) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
