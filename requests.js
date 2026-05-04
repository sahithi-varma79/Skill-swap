const express = require("express");
const auth = require("../middleware/auth");
const User = require("../models/User");
const SwapRequest = require("../models/SwapRequest");
const { toClientRequest } = require("../utils/serializers");

const router = express.Router();

async function getCurrentUser(req) {
  return User.findById(req.user.id);
}

router.get("/", auth, async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const filter = currentUser.isAdmin
      ? {}
      : { $or: [{ fromId: currentUser.publicId }, { toId: currentUser.publicId }] };

    const requests = await SwapRequest.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ requests: requests.map(toClientRequest) });
  } catch (error) {
    return next(error);
  }
});

router.post("/", auth, async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const { toId, message = "", offerSkill = "", wantSkill = "" } = req.body;
    const targetId = Number(toId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ message: "Invalid target user id" });
    }
    if (targetId === currentUser.publicId) {
      return res.status(400).json({ message: "You can't send a request to yourself" });
    }

    const recipient = await User.findOne({ publicId: targetId });
    if (!recipient) {
      return res.status(404).json({ message: "Recipient not found" });
    }

    const existing = await SwapRequest.findOne({
      status: "pending",
      $or: [
        { fromId: currentUser.publicId, toId: targetId },
        { fromId: targetId, toId: currentUser.publicId },
      ],
    });
    if (existing) {
      return res.status(409).json({ message: "A pending request already exists with this user" });
    }

    const request = await SwapRequest.create({
      fromId: currentUser.publicId,
      toId: targetId,
      message: String(message).trim(),
      offerSkill: String(offerSkill).trim(),
      wantSkill: String(wantSkill).trim(),
      status: "pending",
    });

    return res.status(201).json({ request: toClientRequest(request) });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id/status", auth, async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const requestId = Number(req.params.id);
    const { status } = req.body;
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    if (!["accepted", "rejected", "completed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const requestDoc = await SwapRequest.findOne({ publicId: requestId });
    if (!requestDoc) {
      return res.status(404).json({ message: "Request not found" });
    }

    const isParticipant =
      requestDoc.fromId === currentUser.publicId || requestDoc.toId === currentUser.publicId;
    if (!isParticipant) {
      return res.status(403).json({ message: "Not authorized to update this request" });
    }

    if ((status === "accepted" || status === "rejected") && requestDoc.toId !== currentUser.publicId) {
      return res.status(403).json({ message: "Only the recipient can accept or decline a request" });
    }

    if (status === "accepted" || status === "rejected") {
      if (requestDoc.status !== "pending") {
        return res.status(409).json({ message: "Only pending requests can be accepted or declined" });
      }
    }

    if (status === "completed") {
      if (requestDoc.status !== "accepted") {
        return res.status(409).json({ message: "Only accepted requests can be marked completed" });
      }
    }

    requestDoc.status = status;
    await requestDoc.save();

    if (status === "completed") {
      await User.updateMany(
        { publicId: { $in: [requestDoc.fromId, requestDoc.toId] } },
        { $inc: { swaps: 1 } }
      );
    }

    return res.status(200).json({ request: toClientRequest(requestDoc) });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/review", auth, async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const requestId = Number(req.params.id);
    const stars = Number(req.body.stars);
    const text = String(req.body.text || "").trim();

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ message: "Invalid request id" });
    }
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    const requestDoc = await SwapRequest.findOne({ publicId: requestId });
    if (!requestDoc) {
      return res.status(404).json({ message: "Request not found" });
    }
    if (requestDoc.status !== "completed") {
      return res.status(409).json({ message: "You can only review completed swaps" });
    }

    const isParticipant =
      requestDoc.fromId === currentUser.publicId || requestDoc.toId === currentUser.publicId;
    if (!isParticipant) {
      return res.status(403).json({ message: "Not authorized to review this request" });
    }

    if ((requestDoc.ratedBy || []).includes(currentUser.publicId)) {
      return res.status(409).json({ message: "You already reviewed this swap" });
    }

    const targetUserId =
      requestDoc.fromId === currentUser.publicId ? requestDoc.toId : requestDoc.fromId;
    const targetUser = await User.findOne({ publicId: targetUserId });
    if (!targetUser) {
      return res.status(404).json({ message: "Swap partner not found" });
    }

    const newReviewCount = (targetUser.reviews || 0) + 1;
    const newAverage =
      ((targetUser.rating || 0) * (targetUser.reviews || 0) + stars) / newReviewCount;
    targetUser.rating = Math.round(newAverage * 10) / 10;
    targetUser.reviews = newReviewCount;
    targetUser.reviewsList.push({
      from: currentUser.name,
      stars,
      text: text || "No comment.",
      date: new Date().toISOString().slice(0, 7),
      reqId: requestDoc.publicId,
    });

    if (!currentUser.reviewedRequestIds.includes(requestDoc.publicId)) {
      currentUser.reviewedRequestIds.push(requestDoc.publicId);
    }
    requestDoc.ratedBy.push(currentUser.publicId);

    await Promise.all([targetUser.save(), currentUser.save(), requestDoc.save()]);
    return res.status(200).json({ message: "Review submitted" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
