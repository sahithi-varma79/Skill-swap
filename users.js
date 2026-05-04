const express = require("express");
const auth = require("../middleware/auth");
const User = require("../models/User");
const SwapRequest = require("../models/SwapRequest");
const Message = require("../models/Message");
const { toClientUser } = require("../utils/serializers");

const router = express.Router();
const USER_LIST_PROJECTION = [
  "publicId",
  "name",
  "email",
  "bio",
  "skillsOffered",
  "skillsWanted",
  "category",
  "rating",
  "reviews",
  "swaps",
  "isAdmin",
  "isBot",
  "createdAt",
].join(" ");

router.get("/public", async (req, res, next) => {
  try {
    const users = await User.find({})
      .select(USER_LIST_PROJECTION)
      .sort({ reviews: -1, createdAt: 1 })
      .lean()
      .limit(12);

    return res.status(200).json({
      users: users.map((user) =>
        toClientUser(user, {
          includeReviewsList: false,
          includeReviewedRequestIds: false,
        })
      ),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/", auth, async (req, res, next) => {
  try {
    const users = await User.find({})
      .select(USER_LIST_PROJECTION)
      .sort({ createdAt: 1 })
      .lean();
    return res.status(200).json({
      users: users.map((user) =>
        toClientUser(user, {
          includeReviewsList: false,
          includeReviewedRequestIds: false,
        })
      ),
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/me", auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { name, bio, skillsOffered, skillsWanted, category } = req.body;

    if (typeof name === "string" && name.trim()) {
      user.name = name.trim();
    }
    if (typeof bio === "string") {
      user.bio = bio.trim();
    }
    if (Array.isArray(skillsOffered)) {
      user.skillsOffered = skillsOffered.map((skill) => String(skill).trim()).filter(Boolean);
    }
    if (Array.isArray(skillsWanted)) {
      user.skillsWanted = skillsWanted.map((skill) => String(skill).trim()).filter(Boolean);
    }
    if (typeof category === "string" && category.trim()) {
      user.category = category.trim();
    }

    await user.save();
    return res.status(200).json({ user: toClientUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", auth, async (req, res, next) => {
  try {
    const requestingUser = await User.findById(req.user.id);
    if (!requestingUser || !requestingUser.isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (requestingUser.publicId === targetId) {
      return res.status(400).json({ message: "Can't remove yourself" });
    }

    const target = await User.findOne({ publicId: targetId });
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    const relatedRequests = await SwapRequest.find({
      $or: [{ fromId: targetId }, { toId: targetId }],
    }).select("publicId");
    const relatedRequestIds = relatedRequests.map((request) => request.publicId);

    await SwapRequest.deleteMany({ $or: [{ fromId: targetId }, { toId: targetId }] });
    await Message.deleteMany({ $or: [{ fromId: targetId }, { toId: targetId }] });
    await User.deleteOne({ publicId: targetId });

    if (relatedRequestIds.length > 0) {
      await User.updateMany(
        {},
        { $pull: { reviewedRequestIds: { $in: relatedRequestIds } } }
      );
    }

    return res.status(200).json({ message: "User removed" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
