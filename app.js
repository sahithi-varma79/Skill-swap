const express = require("express");
const auth = require("../middleware/auth");
const User = require("../models/User");
const SwapRequest = require("../models/SwapRequest");
const Message = require("../models/Message");
const {
  conversationKey,
  toClientMessage,
  toClientRequest,
  toClientUser,
} = require("../utils/serializers");

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

router.get("/bootstrap", auth, async (req, res, next) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const [users, requests, messages] = await Promise.all([
      User.find({})
        .select(USER_LIST_PROJECTION)
        .sort({ createdAt: 1 })
        .lean(),
      SwapRequest.find(
        currentUser.isAdmin
          ? {}
          : {
              $or: [{ fromId: currentUser.publicId }, { toId: currentUser.publicId }],
            }
      ).sort({ createdAt: -1 }),
      Message.find({
        $or: [{ fromId: currentUser.publicId }, { toId: currentUser.publicId }],
      }).sort({ createdAt: 1 }),
    ]);

    const messageMap = {};
    for (const message of messages) {
      const key = conversationKey(message.fromId, message.toId);
      if (!messageMap[key]) {
        messageMap[key] = [];
      }
      messageMap[key].push(toClientMessage(message));
    }

    return res.status(200).json({
      currentUser: toClientUser(currentUser),
      users: users.map((user) =>
        toClientUser(user, {
          includeReviewsList: false,
          includeReviewedRequestIds: false,
        })
      ),
      requests: requests.map(toClientRequest),
      messages: messageMap,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
