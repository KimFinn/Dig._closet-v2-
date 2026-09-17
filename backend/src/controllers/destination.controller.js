/**
 * Destination intelligence HTTP layer -- Phase 7 (PRD §3.15). Read-only
 * over destinationCulture.service.js (curated, stable) and
 * destinationAdvisory.service.js (dynamic, ingested, no LLM).
 */

const { getCultureForCountry } = require('../services/destinationCulture.service');
const { getAdvisoryForCountry, ingestAdvisoryForCountry } = require('../services/destinationAdvisory.service');
const logger = require('../utils/logger');

class DestinationController {
  static async getCulture(req, res, next) {
    try {
      const result = await getCultureForCountry(req.params.country);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Get destination culture error', { error: error.message, country: req.params?.country });
      next(error);
    }
  }

  static async getAdvisory(req, res, next) {
    try {
      const result = await getAdvisoryForCountry(req.params.country);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Get destination advisory error', { error: error.message, country: req.params?.country });
      next(error);
    }
  }

  /**
   * On-demand ingestion for one country -- lets a trip's creation flow
   * (or an impatient user) trigger a fetch immediately rather than
   * waiting for the next scheduled run.
   */
  static async refreshAdvisory(req, res, next) {
    try {
      const result = await ingestAdvisoryForCountry(req.params.country);
      const advisory = await getAdvisoryForCountry(req.params.country);
      res.status(200).json({ success: true, data: { ingestion: result, advisory } });
    } catch (error) {
      logger.error('Refresh destination advisory error', { error: error.message, country: req.params?.country });
      next(error);
    }
  }
}

module.exports = DestinationController;
