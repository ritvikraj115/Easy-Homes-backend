const { createZohoCrmLead, isZohoCrmStrictMode } = require('../services/zohoCrmService');
const { createZohoAppointment, getZohoAvailableSlots } = require('../services/zohoBookingsService');

function inferDownloadLeadStatus(rawValue) {
  const text = String(rawValue || '').trim().toLowerCase();
  if (!text) return '';
  if (text.includes('brochure')) return 'Downloaded Brochure';
  if (text.includes('layout')) return 'Downloaded Layout';
  return '';
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || undefined;
}

function buildWebsiteEnquiryNotes({ placement }) {
  const noteLines = ['Lead event: Website enquiry / callback request'];
  if (placement) {
    noteLines.push(`Form placement: ${placement}`);
  }
  return noteLines.join('\n');
}

function resolveWebsiteEnquiryLeadStatus(rawValue) {
  return normalizeText(rawValue) || 'Callback Requested';
}

exports.captureWebsiteEnquiryLead = async (req, res, next) => {
  try {
    const {
      project = 'General Inquiry',
      name,
      phone,
      email,
      requirements,
      placement,
      platformSource,
      platform_source,
      leadStatus,
      googleAdsAttribution,
    } = req.body || {};
    const source = 'Website';

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'name and phone are required',
      });
    }

    try {
      await createZohoCrmLead({
        project,
        source,
        platformSource: normalizeText(platformSource) || normalizeText(platform_source) || 'Website',
        leadStatus: resolveWebsiteEnquiryLeadStatus(leadStatus),
        name,
        phone,
        email: normalizeText(email),
        requirements: normalizeText(requirements),
        googleAdsAttribution,
        notes: buildWebsiteEnquiryNotes({
          placement: normalizeText(placement),
        }),
      });
    } catch (crmError) {
      console.error('[lead] crm.sync.failed', crmError.message);
      if (isZohoCrmStrictMode()) {
        throw crmError;
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Lead captured successfully',
    });
  } catch (err) {
    return next(err);
  }
};

exports.captureLayoutDownloadLead = async (req, res, next) => {
  try {
    const {
      project = 'Kalpavruksha',
      source: rawSource,
      platformSource,
      platform_source,
      leadStatus,
      name,
      phone,
      email,
      notes,
      googleAdsAttribution,
    } = req.body || {};
    const source = 'Website';

    const resolvedLeadStatus =
      String(leadStatus || '').trim() ||
      inferDownloadLeadStatus(rawSource);

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'name and phone are required',
      });
    }

    // =========================================================================
    // STRICT 10-DIGIT PHONE VALIDATION
    // =========================================================================
    const phoneStr = String(phone).trim();
    const phoneRegex = /^\d{10}$/; // Matches exactly 10 digits
    if (!phoneRegex.test(phoneStr)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number must be strictly 10 digits.' 
      });
    }
    // =========================================================================

    try {
      await createZohoCrmLead({
        project,
        source,
        platformSource: normalizeText(platformSource) || normalizeText(platform_source) || 'Website',
        leadStatus: resolvedLeadStatus || undefined,
        name,
        phone: phoneStr, // <--- Send the clean, validated string to Zoho
        email,
        googleAdsAttribution,
        notes,
      });
    } catch (crmError) {
      console.error('[lead] crm.sync.failed', crmError.message);
      if (isZohoCrmStrictMode()) {
        throw crmError;
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Lead captured successfully',
    });
  } catch (err) {
    return next(err);
  }
};