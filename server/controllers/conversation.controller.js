const asyncHandler = require("../utils/asyncHandler");
const conversationService = require("../services/conversation.service");
const broadcast = require("../websocket/broadcast");

const getConversations = asyncHandler(async (req, res) => {
  const conversations = await conversationService.getUserConversations(
    req.user._id,
  );
  res.status(200).json({ success: true, data: conversations });
});

const getConversation = asyncHandler(async (req, res) => {
  const conversation = await conversationService.getConversationById(
    req.params.conversationId,
    req.user._id,
  );
  res.status(200).json({ success: true, data: conversation });
});

const createConversation = asyncHandler(async (req, res) => {
  const conversation = await conversationService.findOrCreateConversation(
    req.user._id,
    req.body.participantId,
  );
  res.status(200).json({ success: true, data: conversation });
});

const createGroup = asyncHandler(async (req, res) => {
  const { name, participantIds } = req.body;

  const conversation = await conversationService.createGroupConversation(
    req.user._id,
    name,
    participantIds,
  );

  await broadcast.groupCreated(conversation);

  res.status(201).json({ success: true, data: conversation });
});

const updateGroup = asyncHandler(async (req, res) => {
  const group = await conversationService.renameGroup(
    req.params.conversationId,
    req.body.name,
  );

  await broadcast.groupUpdated(group);

  res.status(200).json({ success: true, data: group });
});

const deleteGroup = asyncHandler(async (req, res) => {
  const result = await conversationService.deleteGroup(
    req.params.conversationId,
  );

  await broadcast.groupDeleted(result);

  res.status(200).json({ success: true, message: "Group deleted" });
});

module.exports = {
  getConversations,
  getConversation,
  createConversation,
  createGroup,
  updateGroup,
  deleteGroup,
};
