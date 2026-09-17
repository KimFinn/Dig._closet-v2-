/**
 * Phase 9 (PRD §3.10) -- grounded chatbot HTTP layer.
 */

const { answerQuestion } = require('../services/chatbot.service');
const logger = require('../utils/logger');

class ChatbotController {
  static async ask(req, res, next) {
    try {
      const userId = req.user.userId;
      const result = await answerQuestion(userId, req.body.question);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Chatbot ask error', { error: error.message, userId: req.user?.userId });
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  }
}

module.exports = ChatbotController;
