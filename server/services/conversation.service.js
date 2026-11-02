const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const Message = require("../models/Message");
const Notification = require("../models/Notification");
const AppError = require("../utils/AppError");

async function getUserConversations(userId) {
  return Conversation.find({ participants: userId })
    .populate("participants", "name email publicKey")
    .sort({ updatedAt: -1 });
}

async function getConversationById(conversationId, userId) {
  const conversation = await Conversation.findById(conversationId).populate(
    "participants",
    "name email publicKey",
  );

  if (!conversation) {
    throw new AppError("Conversation not found", 404);
  }

  const isParticipant = conversation.participants.some((p) =>
    p._id.equals(userId),
  );
  if (!isParticipant) {
    throw new AppError("Not authorized to view this conversation", 403);
  }

  return conversation;
}

async function findOrCreateConversation(userId, otherUserId) {
  if (userId.toString() === otherUserId.toString()) {
    throw new AppError("Cannot start a conversation with yourself", 400);
  }

  // Sort so [A, B] and [B, A] always produce the same stored order —
  // this is what makes the unique index in the model actually work.
  const participants = [userId, otherUserId]
    .map((id) => new mongoose.Types.ObjectId(id))
    .sort((a, b) => a.toString().localeCompare(b.toString()));

  let conversation = await Conversation.findOne({
    participants,
    isGroup: false,
  });

  if (!conversation) {
    conversation = await Conversation.create({ participants, isGroup: false });
  }

  return Conversation.populate(conversation, {
    path: "participants",
    select: "name email publicKey",
  });
}

async function createGroupConversation(ownerId, name, participantIds = []) {
  const participants = [
    ...new Set([
      ownerId.toString(),
      ...participantIds.map((id) => id.toString()),
    ]),
  ];

  if (participants.length < 2) {
    throw new AppError("A group requires at least two members", 400);
  }

  // Every member must be a real, enabled user.
  const validCount = await User.countDocuments({
    _id: { $in: participants },
    accountDisabled: false,
  });
  if (validCount !== participants.length) {
    throw new AppError("One or more selected members are invalid", 400);
  }

  const group = await Conversation.create({
    name: name?.trim() || "New Group",
    participants,
    isGroup: true,
  });

  return group.populate("participants", "name email publicKey");
}

// Admin: every group, regardless of membership.
async function getAllGroups() {
  return Conversation.find({ isGroup: true })
    .populate("participants", "name email publicKey")
    .sort({ updatedAt: -1 });
}

async function renameGroup(groupId, name) {
  const group = await Conversation.findOneAndUpdate(
    { _id: groupId, isGroup: true },
    { name: name.trim() },
    { returnDocument: "after", runValidators: true },
  ).populate("participants", "name email publicKey");

  if (!group) {
    throw new AppError("Group not found", 404);
  }

  return group;
}

async function deleteGroup(groupId) {
  const group = await Conversation.findOneAndDelete({
    _id: groupId,
    isGroup: true,
  });

  if (!group) {
    throw new AppError("Group not found", 404);
  }

  // Conversation is gone first; children are cleaned up after so a crash
  // can only leave harmless orphans, never a group without its history.
  await Promise.all([
    Message.deleteMany({ conversation: groupId }),
    Notification.deleteMany({ conversation: groupId }),
  ]);

  return { conversationId: group._id.toString(), participantIds: group.participants.map(String) };
}

module.exports = {
  getUserConversations,
  getConversationById,
  findOrCreateConversation,
  createGroupConversation,
  getAllGroups,
  renameGroup,
  deleteGroup,
};
